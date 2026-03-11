from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from src.agent.tool_assembly import ToolAssemblyService
from src.agent.tool_providers.base import GlobalRuntimeServices
from src.ai.config import AIConfig
from src.ai.gateway import AIGateway
from src.mcp.config_loader import MCPConfigLoader
from src.mcp.config_models import MCPSettings
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
        self.global_runtime_services = GlobalRuntimeServices()

        self._initialized = True

    @property
    def mcp_registry(self) -> MCPRegistry | None:
        return self.global_runtime_services.metadata.get("mcp_registry")

    @property
    def mcp_client(self):
        registry = self.mcp_registry
        if registry is None:
            return None
        connected = registry.find_server_by_type("database")
        return connected.client if connected else None

    async def startup(self):
        """服务器启动时调用"""
        logger.info("[ConfigManager] 正在启动...")
        self.gateway = AIGateway(self.ai_config)
        await self.reload_runtime_services()
        logger.info("[ConfigManager] 启动完成。")

    async def shutdown(self):
        """服务器关闭时调用"""
        logger.info("[ConfigManager] 正在关闭...")
        registry = self.mcp_registry
        if registry is not None:
            try:
                await registry.shutdown()
            except Exception as e:
                logger.error(f"Error closing MCP registry: {e}")
        self.global_runtime_services = GlobalRuntimeServices()
        logger.info("[ConfigManager] 关闭完成。")

    def get_config(self) -> dict[str, Any]:
        """获取当前配置快照"""
        settings = self.global_runtime_services.metadata.get("mcp_settings")
        return {
            "default_model": self.ai_config.default_model,
            "openai_api_key": "[configured]" if self.ai_config.openai_api_key else "",
            "openai_base_url": self.ai_config.openai_base_url,
            "mcp_server_script": self.ai_config.mcp_server_script,
            "mysql_host": self.ai_config.mysql_host,
            "mysql_port": self.ai_config.mysql_port,
            "mysql_user": self.ai_config.mysql_user,
            "mysql_database": self.ai_config.mysql_database,
            "mcp_config": self.serialize_mcp_settings(settings) if settings else {"servers": []},
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

        self.gateway = AIGateway(self.ai_config)

    async def update_db_config(self, new_config: dict[str, Any]) -> None:
        """热更新数据库配置，并重连 MCP"""
        logger.info(f"[ConfigManager] 热更新数据库配置: {new_config.keys()}")

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

        await self.reload_runtime_services()

    async def reload_runtime_services(
        self,
        runtime_overrides: dict[str, Any] | None = None,
        enabled_mcp_servers: list[str] | None = None,
    ) -> GlobalRuntimeServices:
        self.global_runtime_services = await self.tool_assembly.build_global_runtime_services(
            self.ai_config,
            runtime_overrides=runtime_overrides or {},
            enabled_mcp_servers=enabled_mcp_servers,
        )
        return self.global_runtime_services

    async def build_session_tools(
        self,
        session_id: str,
        workspace,
        runtime_overrides: dict[str, Any] | None = None,
        enabled_mcp_servers: list[str] | None = None,
    ):
        session_runtime_services = await self.tool_assembly.build_connected_runtime_services(
            self.ai_config,
            runtime_overrides=runtime_overrides or {},
            enabled_mcp_servers=enabled_mcp_servers,
        )
        tools = await self.tool_assembly.build_session_tools(
            session_id=session_id,
            workspace=workspace,
            global_services=session_runtime_services,
            runtime_overrides=runtime_overrides or {},
        )
        return tools, session_runtime_services

    async def test_db_connection(self, conf: dict[str, Any]) -> dict[str, Any]:
        """测试数据库连接（临时连接）"""
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
            return {
                "success": True,
                "message": "连接成功",
                "details": tools,
            }
        except Exception as e:
            return {"success": False, "message": f"连接失败: {str(e)}"}
        finally:
            await registry.shutdown()

    def get_mcp_settings(self) -> MCPSettings:
        settings = self.global_runtime_services.metadata.get("mcp_settings")
        if settings:
            return settings
        return MCPConfigLoader.load_effective_settings(self.project_root, self.ai_config)

    def serialize_mcp_settings(self, settings: MCPSettings | None = None) -> dict[str, Any]:
        settings = settings or self.get_mcp_settings()
        sanitized_servers = []
        for server in settings.servers:
            sanitized_servers.append(
                {
                    "name": server.name,
                    "transport": server.transport.value,
                    "enabled": server.enabled,
                    "command": server.command,
                    "script": server.script,
                    "url": server.url,
                    "headers": self._summarize_mapping(server.headers),
                    "env": self._summarize_mapping(server.env),
                    "description": server.description,
                    "tool_prefix": server.tool_prefix,
                    "server_type": server.server_type,
                    "tags": list(server.tags),
                }
            )
        return {"servers": sanitized_servers}

    def _summarize_mapping(self, values: dict[str, str]) -> dict[str, Any]:
        if not values:
            return {"configured": False, "count": 0}
        safe_keys = []
        for key in values.keys():
            upper_key = key.upper()
            if self._is_secret_key(key):
                continue
            if upper_key.startswith(("OPENAI_", "ANTHROPIC_", "GEMINI_", "MYSQL_")):
                continue
            if upper_key in {"PATH", "PYTHONPATH", "PWD", "HOME", "USERPROFILE"}:
                continue
            safe_keys.append(key)
        return {
            "configured": True,
            "count": len(values),
            "safe_keys": sorted(safe_keys)[:20],
        }

    def _is_secret_key(self, key: str) -> bool:
        upper_key = key.upper()
        return any(token in upper_key for token in ["KEY", "TOKEN", "SECRET", "PASSWORD", "PASSWD", "PWD", "AUTH"])

    def _mask_secret(self, value: str | None) -> str:
        if not value:
            return ""
        if len(value) <= 8:
            return "*" * len(value)
        return f"{value[:4]}***{value[-4:]}"

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
        await self.reload_runtime_services()
        return self.serialize_mcp_settings(new_settings)

    async def list_mcp_servers(self) -> list[dict[str, Any]]:
        runtime_services = await self.tool_assembly.build_connected_runtime_services(self.ai_config)
        registry = runtime_services.metadata.get("mcp_registry")
        try:
            return registry.list_servers() if registry is not None else []
        finally:
            if registry is not None:
                await registry.shutdown()

    async def list_mcp_tools(self) -> list[dict[str, Any]]:
        runtime_services = await self.tool_assembly.build_connected_runtime_services(self.ai_config)
        registry = runtime_services.metadata.get("mcp_registry")
        try:
            return registry.list_tools() if registry is not None else []
        finally:
            if registry is not None:
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


config_manager = ConfigManager()
