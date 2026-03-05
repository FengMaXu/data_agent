import asyncio
import logging
from typing import Any
from contextlib import AsyncExitStack

from src.ai.config import AIConfig
from src.ai.gateway import AIGateway
from src.mcp.mcp_client import MCPClient
from src.mcp.db_tools import create_db_tools
from src.mcp.sql_guard import SQLGuard
from src.context.metadata_store import MetadataStore
from src.context.annotations import AnnotationStore
from src.context.query_patterns import QueryPatternStore
from src.interaction.clarification import create_clarification_tool
from src.interaction.sql_evaluator import SQLEvaluator
from src.interaction.skill_registry import SkillRegistry, register_builtin_skills
from src.learning.learning_store import LearningStore
from src.learning.feedback import FeedbackCollector
from src.workspace.workspace_manager import WorkspaceManager
from src.workspace.file_tools import create_file_tools
from src.workspace.code_executor import CodeExecutor, create_code_tools
from src.ecosystem.mcp_registry import MCPRegistry
from src.ecosystem.http_hooks import HttpHookRegistry, create_http_tools
from src.agent.types import AgentTool

logger = logging.getLogger("data_agent.config_manager")


class ConfigManager:
    """
    配置管理器单例
    管理全局状态，处理配置热重载（重新建立 Gateway、重连 MCP）
    """

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(ConfigManager, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        self.ai_config: AIConfig = AIConfig.from_env()
        self.gateway: AIGateway | None = None

        # MCP 相关
        self.exit_stack: AsyncExitStack | None = None
        self.mcp_client: MCPClient | None = None
        self.tools: list[AgentTool] = []

        self._initialized = True

    async def startup(self):
        """服务器启动时调用"""
        logger.info("[ConfigManager] 正在启动...")
        self.gateway = AIGateway(self.ai_config)
        await self._init_mcp_and_tools()
        logger.info("[ConfigManager] 启动完成。")

    async def shutdown(self):
        """服务器关闭时调用"""
        logger.info("[ConfigManager] 正在关闭...")
        if getattr(self, "exit_stack", None):
            try:
                await self.exit_stack.aclose()
            except Exception as e:
                logger.error(f"Error closing MCP client stack: {e}")
            self.exit_stack = None
        self.mcp_client = None
        logger.info("[ConfigManager] 关闭完成。")

    def get_config(self) -> dict[str, Any]:
        """获取当前配置快照"""
        return {
            "default_model": self.ai_config.default_model,
            "openai_api_key": self.ai_config.openai_api_key,
            "openai_base_url": self.ai_config.openai_base_url,
            "mcp_server_script": self.ai_config.mcp_server_script,
            "mysql_host": self.ai_config.mysql_host,
            "mysql_port": self.ai_config.mysql_port,
            "mysql_user": self.ai_config.mysql_user,
            "mysql_database": self.ai_config.mysql_database,
        }

    async def update_llm_config(self, new_config: dict[str, Any]) -> None:
        """热更新 LLM 配置"""
        logger.info(f"[ConfigManager] 热更新 LLM 配置: {new_config.keys()}")
        if "api_key" in new_config:
            self.ai_config.openai_api_key = new_config["api_key"]
        if "base_url" in new_config:
            self.ai_config.openai_base_url = new_config["base_url"]
        if "model" in new_config:
            self.ai_config.default_model = new_config["model"]

        # 重建 Gateway
        self.gateway = AIGateway(self.ai_config)

    async def update_db_config(self, new_config: dict[str, Any]) -> None:
        """热更新数据库配置，并重连 MCP"""
        logger.info(f"[ConfigManager] 热更新数据库配置: {new_config.keys()}")

        # 1. 关闭旧连接
        await self.shutdown()

        # 2. 更新配置
        if "host" in new_config:
            self.ai_config.mysql_host = new_config["host"]
        if "port" in new_config:
            self.ai_config.mysql_port = int(new_config["port"])
        if "user" in new_config:
            self.ai_config.mysql_user = new_config["user"]
        if "password" in new_config:
            self.ai_config.mysql_password = new_config["password"]
        if "database" in new_config:
            self.ai_config.mysql_database = new_config["database"]

        # 3. 重连 MCP 并重建工具
        await self._init_mcp_and_tools()

    async def test_db_connection(self, conf: dict[str, Any]) -> dict[str, Any]:
        """测试数据库连接（临时连接）"""
        env = self.ai_config.get_mcp_env()
        # 覆盖临时变量
        env["MYSQL_HOST"] = conf.get("host", self.ai_config.mysql_host)
        env["MYSQL_PORT"] = str(conf.get("port", self.ai_config.mysql_port))
        env["MYSQL_USER"] = conf.get("user", self.ai_config.mysql_user)
        env["MYSQL_PASSWORD"] = conf.get("password", self.ai_config.mysql_password)
        env["MYSQL_DATABASE"] = conf.get("database", self.ai_config.mysql_database)

        script = self.ai_config.mcp_server_script
        if not script:
            return {"success": False, "message": "未配置 MCP_SERVER_SCRIPT 路径"}

        try:
            # 使用 async with 临时连一下测试
            async with MCPClient.connect(
                command=self.ai_config.mcp_server_command,
                script=script,
                env=env,
            ) as mcp_client:
                # 调用一个简单的方法看是否成功 (比如 MCP Server 的 list_tables)
                result = await mcp_client.call_tool("list_tables", {})
                if "error" in result.lower():
                    return {"success": False, "message": result}
                return {"success": True, "message": "连接成功", "details": result[:200]}
        except Exception as e:
            return {"success": False, "message": f"连接失败: {str(e)}"}

    async def _init_mcp_and_tools(self):
        """初始化 MCP 并创建所有工具"""
        self.tools = []
        script = self.ai_config.mcp_server_script

        if script:
            logger.info(f"[ConfigManager] 初始化 MCP 工具集: {script}")

            self.exit_stack = AsyncExitStack()

            # 使用标准的 AsyncExitStack 维持长连接的生命周期
            self.mcp_client = await self.exit_stack.enter_async_context(
                MCPClient.connect(
                    command=self.ai_config.mcp_server_command,
                    script=script,
                    env=self.ai_config.get_mcp_env(),
                )
            )

            # 创建 MCP 工具
            guard = SQLGuard(strict=True)
            db_tools = create_db_tools(self.mcp_client, guard)

            # 替换为带验证的 evaluate_sql
            evaluator = SQLEvaluator(self.mcp_client, guard)
            self.tools = [t for t in db_tools if t.name != "execute_sql"]
            self.tools.append(evaluator.create_validated_execute_tool())

            # 元数据工具
            metadata_store = MetadataStore(self.mcp_client)
            self.tools.extend(metadata_store.create_tools())
        else:
            logger.info("[ConfigManager] 未配置 MCP，使用纯对话模式")

        # 注册非 MCP 依赖的工具（上下文、技能、沙盒等）
        annotation_store = AnnotationStore()
        annotation_store.load()
        self.tools.extend(annotation_store.create_tools())

        query_store = QueryPatternStore()
        query_store.load()
        self.tools.extend(query_store.create_tools())

        skill_registry = SkillRegistry()
        register_builtin_skills(skill_registry)
        self.tools.extend(skill_registry.create_tools())

        learning_store = LearningStore()
        self.tools.extend(learning_store.create_tools())
        feedback_collector = FeedbackCollector(learning_store)
        self.tools.extend(feedback_collector.create_tools())

        workspace = WorkspaceManager()
        self.tools.extend(create_file_tools(workspace))
        code_executor = CodeExecutor(workspace)
        self.tools.extend(create_code_tools(code_executor))

        http_registry = HttpHookRegistry()
        self.tools.extend(create_http_tools(http_registry))

        logger.info(f"[ConfigManager] 工具初始化完成，共 {len(self.tools)} 个工具")


# 全局单例
config_manager = ConfigManager()
