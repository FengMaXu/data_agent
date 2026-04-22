from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from src.agent.tool_assembly import ToolAssemblyService
from src.agent.tool_providers.base import GlobalRuntimeServices
from src.agent.types import AgentTimingRecorder
from src.ai.config import AIConfig
from src.ai.gateway import AIGateway
from src.mcp.config_loader import MCPConfigLoader
from src.mcp.config_models import MCPSettings
from src.mcp.manager import mcp_manager
from src.mcp.registry import MCPRegistry

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
        self.project_root = Path(__file__).resolve().parent.parent
        self.ai_config: AIConfig = AIConfig.from_env()
        self.gateway: AIGateway | None = None
        self.tool_assembly = ToolAssemblyService(self.project_root)
        self._initialized = True

    # ── 生命周期 ──────────────────────────────────────────────────────────────

    async def startup(self) -> None:
        logger.info("[ConfigManager] 正在启动...")
        self.gateway = AIGateway(self.ai_config)
        settings = MCPConfigLoader.load_effective_settings(self.project_root, self.ai_config)
        await mcp_manager.start(settings)
        logger.info("[ConfigManager] 启动完成。")

    async def shutdown(self) -> None:
        logger.info("[ConfigManager] 正在关闭...")
        await mcp_manager.stop()
        logger.info("[ConfigManager] 关闭完成。")

    # ── 配置热更新 ────────────────────────────────────────────────────────────

    async def update_llm_config(self, new_config: dict[str, Any]) -> None:
        logger.info("[ConfigManager] 热更新 LLM 配置: %s", list(new_config.keys()))
        if "api_key" in new_config:
            self.ai_config.openai_api_key = new_config["api_key"]
        if "base_url" in new_config:
            self.ai_config.openai_base_url = new_config["base_url"]
        if "model" in new_config:
            self.ai_config.default_model = new_config["model"]
        self.gateway = AIGateway(self.ai_config)

    async def update_db_config(self, new_config: dict[str, Any]) -> None:
        logger.info("[ConfigManager] 热更新数据库配置: %s", list(new_config.keys()))
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
        await self._reload_mcp()

    async def _reload_mcp(self) -> None:
        settings = MCPConfigLoader.load_effective_settings(self.project_root, self.ai_config)
        await mcp_manager.restart(settings)

    async def save_mcp_settings(self, data: dict[str, Any]) -> dict[str, Any]:
        new_settings = MCPSettings.from_dict(data)
        old_settings = self.get_mcp_settings()

        for new_server in new_settings.servers:
            old_server = old_settings.get_server(new_server.name)
            if old_server:
                if not new_server.env:
                    new_server.env = dict(old_server.env)
                if not new_server.headers:
                    new_server.headers = dict(old_server.headers)

        MCPConfigLoader.save_project_settings(self.project_root, new_settings)
        await mcp_manager.restart(new_settings)
        return self.serialize_mcp_settings(new_settings)

    # ── 工具装配（每次 chat 调用）────────────────────────────────────────────

    async def build_session_tools(
        self,
        session_id: str,
        workspace: Any,
        runtime_overrides: dict[str, Any] | None = None,
        enabled_mcp_servers: list[str] | None = None,
        timing: AgentTimingRecorder | None = None,
    ):
        if timing is not None:
            timing.mark_once("session_tools_start")

        # runtime_overrides 中的 enabled_mcp_servers 注入到 overrides，供 MCPToolProvider 读取
        effective_overrides = dict(runtime_overrides or {})
        if enabled_mcp_servers is not None:
            effective_overrides["enabled_mcp_servers"] = enabled_mcp_servers

        global_services = self.tool_assembly.build_global_runtime_services(timing=timing)
        tools = await self.tool_assembly.build_session_tools(
            session_id=session_id,
            workspace=workspace,
            global_services=global_services,
            runtime_overrides=effective_overrides,
            timing=timing,
        )
        if timing is not None:
            timing.mark_once("session_tools_ready", tool_count=len(tools))
        return tools, global_services

    # ── MCP 状态查询 ──────────────────────────────────────────────────────────

    def get_mcp_settings(self) -> MCPSettings:
        return MCPConfigLoader.load_effective_settings(self.project_root, self.ai_config)

    async def list_mcp_servers(self) -> list[dict[str, Any]]:
        return mcp_manager.list_servers()

    async def list_mcp_tools(self) -> list[dict[str, Any]]:
        return mcp_manager.list_tools()

    # ── 临时连接（测试用，不走连接池）────────────────────────────────────────

    async def test_db_connection(self, conf: dict[str, Any]) -> dict[str, Any]:
        legacy_server = MCPConfigLoader.from_legacy_ai_config(self.ai_config)
        if legacy_server is None:
            return {"success": False, "message": "未配置 MCP_SERVER_SCRIPT 路径"}

        env = self.ai_config.get_mcp_env()
        env["MYSQL_HOST"] = conf.get("host", self.ai_config.mysql_host)
        env["MYSQL_PORT"] = str(conf.get("port", self.ai_config.mysql_port))
        env["MYSQL_USER"] = conf.get("user", self.ai_config.mysql_user)
        env["MYSQL_PASSWORD"] = conf.get("password", self.ai_config.mysql_password)
        env["MYSQL_DATABASE"] = conf.get("database", self.ai_config.mysql_database)
        legacy_server.env = env

        registry = MCPRegistry()
        registry.configure(MCPSettings(servers=[legacy_server]))
        try:
            await registry.connect_all_enabled()
            tools = registry.list_tools()
            return {"success": True, "message": "连接成功", "details": tools}
        except Exception as e:
            return {"success": False, "message": f"连接失败: {str(e)}"}
        finally:
            await registry.shutdown()

    async def test_mcp_server(self, data: dict[str, Any]) -> dict[str, Any]:
        settings = MCPSettings.from_dict({"servers": [data]})
        if not settings.servers:
            return {"success": False, "message": "无效的 MCP server 配置"}

        new_server = settings.servers[0]
        old_settings = self.get_mcp_settings()
        old_server = old_settings.get_server(new_server.name)
        if old_server:
            if not new_server.env:
                new_server.env = dict(old_server.env)
            if not new_server.headers:
                new_server.headers = dict(old_server.headers)

        registry = MCPRegistry()
        result = await registry.test_server(settings.servers[0])
        result["server"] = self.serialize_mcp_settings(settings).get("servers", [])[0]
        return result

    # ── 配置序列化 ────────────────────────────────────────────────────────────

    def get_config(self) -> dict[str, Any]:
        settings = self.get_mcp_settings()
        return {
            "default_model": self.ai_config.default_model,
            "openai_api_key": "[configured]" if self.ai_config.openai_api_key else "",
            "openai_base_url": self.ai_config.openai_base_url,
            "mcp_server_script": self.ai_config.mcp_server_script,
            "mysql_host": self.ai_config.mysql_host,
            "mysql_port": self.ai_config.mysql_port,
            "mysql_user": self.ai_config.mysql_user,
            "mysql_database": self.ai_config.mysql_database,
            "mcp_config": self.serialize_mcp_settings(settings),
        }

    def serialize_mcp_settings(self, settings: MCPSettings | None = None) -> dict[str, Any]:
        settings = settings or self.get_mcp_settings()
        return {
            "servers": [
                {
                    "name": s.name,
                    "transport": s.transport.value,
                    "enabled": s.enabled,
                    "command": s.command,
                    "script": s.script,
                    "url": s.url,
                    "headers": self._summarize_mapping(s.headers),
                    "env": self._summarize_mapping(s.env),
                    "description": s.description,
                    "tool_prefix": s.tool_prefix,
                    "server_type": s.server_type,
                    "tags": list(s.tags),
                }
                for s in settings.servers
            ]
        }

    def _summarize_mapping(self, values: dict[str, str]) -> dict[str, Any]:
        if not values:
            return {"configured": False, "count": 0}
        safe_keys = [
            k for k in values
            if not self._is_secret_key(k)
            and not k.upper().startswith(("OPENAI_", "ANTHROPIC_", "GEMINI_", "MYSQL_"))
            and k.upper() not in {"PATH", "PYTHONPATH", "PWD", "HOME", "USERPROFILE"}
        ]
        return {"configured": True, "count": len(values), "safe_keys": sorted(safe_keys)[:20]}

    def _is_secret_key(self, key: str) -> bool:
        upper = key.upper()
        return any(t in upper for t in ["KEY", "TOKEN", "SECRET", "PASSWORD", "PASSWD", "PWD", "AUTH"])


config_manager = ConfigManager()
