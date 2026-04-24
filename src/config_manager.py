from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any
from urllib import error, request

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
        model = str(new_config.get("model") or self.ai_config.default_model or "")
        provider = self._infer_llm_provider(new_config, model)

        api_key = new_config.get("api_key")
        if isinstance(api_key, str) and api_key.strip():
            if provider == "anthropic":
                self.ai_config.anthropic_api_key = api_key.strip()
            else:
                self.ai_config.openai_api_key = api_key.strip()

        openai_api_key = new_config.get("openai_api_key")
        if isinstance(openai_api_key, str) and openai_api_key.strip():
            self.ai_config.openai_api_key = openai_api_key.strip()

        anthropic_api_key = new_config.get("anthropic_api_key")
        if isinstance(anthropic_api_key, str) and anthropic_api_key.strip():
            self.ai_config.anthropic_api_key = anthropic_api_key.strip()

        base_url = new_config.get("base_url") or new_config.get("openai_base_url")
        if isinstance(base_url, str) and base_url.strip() and provider != "anthropic":
            self.ai_config.openai_base_url = base_url.strip()

        if "model" in new_config and new_config["model"]:
            self.ai_config.default_model = str(new_config["model"])
        self.gateway = AIGateway(self.ai_config)

    async def test_llm_config(self, new_config: dict[str, Any]) -> dict[str, Any]:
        model = str(new_config.get("model") or self.ai_config.default_model or "")
        provider = self._infer_llm_provider(new_config, model)
        api_key = self._resolve_test_api_key(new_config, provider)
        if not api_key:
            return {"success": False, "message": "API key is required"}

        try:
            result = await asyncio.to_thread(
                self._request_model_list,
                provider,
                api_key,
                str(new_config.get("base_url") or new_config.get("openai_base_url") or ""),
            )
            return {"success": True, "message": "LLM connection verified", "details": result}
        except Exception as exc:
            logger.warning("[ConfigManager] LLM config test failed: %s", exc)
            return {"success": False, "message": str(exc)}

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
        await mcp_manager.reconcile(settings)

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
        await mcp_manager.reconcile(new_settings)
        return self.serialize_mcp_settings(new_settings)

    async def set_mcp_server_enabled(self, name: str, enabled: bool) -> dict[str, Any]:
        settings = self.get_mcp_settings()
        server = settings.get_server(name)
        if server is None:
            raise KeyError(name)

        if server.enabled == enabled:
            return self.serialize_mcp_server(settings=settings, name=name)

        server.enabled = enabled
        MCPConfigLoader.save_project_settings(self.project_root, settings)
        await mcp_manager.reconcile(settings)
        return self.serialize_mcp_server(settings=settings, name=name)

    async def restart_mcp_server(self, name: str) -> dict[str, Any]:
        settings = self.get_mcp_settings()
        server = settings.get_server(name)
        if server is None:
            raise KeyError(name)
        if not server.enabled:
            raise ValueError(f"MCP server is disabled: {name}")

        await mcp_manager.restart_server(name, settings)
        return self.serialize_mcp_server(settings=settings, name=name)

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
        settings = self.get_mcp_settings()
        return [
            self.serialize_mcp_server(name=server.name, settings=settings)
            for server in settings.servers
        ]

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
            "anthropic_api_key": "[configured]" if self.ai_config.anthropic_api_key else "",
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
                self._serialize_mcp_server_config(s)
                for s in settings.servers
            ]
        }

    def serialize_mcp_server(
        self,
        *,
        name: str,
        settings: MCPSettings | None = None,
    ) -> dict[str, Any]:
        settings = settings or self.get_mcp_settings()
        server = settings.get_server(name)
        if server is None:
            raise KeyError(name)

        data = self._serialize_mcp_server_config(server)
        managed = mcp_manager.get_server(name)
        runtime = managed.status() if managed is not None else {
            "name": server.name,
            "enabled": server.enabled,
            "status": "disabled" if not server.enabled else "disconnected",
            "server_type": server.server_type,
            "transport": server.transport.value,
            "connected": False,
            "generation": 0,
            "tool_count": 0,
            "description": server.description,
            "tool_prefix": server.resolved_tool_prefix(),
            "tags": list(server.tags),
        }
        return {**data, **runtime, "enabled": server.enabled}

    def _serialize_mcp_server_config(self, server: Any) -> dict[str, Any]:
        return {
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

    def _infer_llm_provider(self, data: dict[str, Any], model: str) -> str:
        provider = str(data.get("provider") or "").lower().strip()
        if provider in {"openai", "anthropic"}:
            return provider

        base_url = str(data.get("base_url") or data.get("openai_base_url") or "").lower()
        if model.lower().startswith("claude-") or "anthropic" in base_url:
            return "anthropic"
        return "openai"

    def _resolve_test_api_key(self, data: dict[str, Any], provider: str) -> str:
        explicit_key = data.get(f"{provider}_api_key")
        if isinstance(explicit_key, str) and explicit_key.strip():
            return explicit_key.strip()

        generic_key = data.get("api_key")
        if isinstance(generic_key, str) and generic_key.strip():
            return generic_key.strip()

        if provider == "anthropic":
            return self.ai_config.anthropic_api_key
        return self.ai_config.openai_api_key

    def _request_model_list(self, provider: str, api_key: str, base_url: str) -> dict[str, Any]:
        if provider == "anthropic":
            url = "https://api.anthropic.com/v1/models"
            headers = {
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
            }
        else:
            endpoint = (base_url or self.ai_config.openai_base_url or "https://api.openai.com/v1").rstrip("/")
            url = f"{endpoint}/models"
            headers = {"Authorization": f"Bearer {api_key}"}

        req = request.Request(url, headers=headers, method="GET")
        try:
            with request.urlopen(req, timeout=10) as response:
                body = response.read(256_000).decode("utf-8", errors="replace")
        except error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Model list request failed with HTTP {exc.code}: {body[:300]}") from exc
        except error.URLError as exc:
            raise RuntimeError(f"Model list request failed: {exc.reason}") from exc

        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            payload = {"raw": body[:1000]}

        data = payload.get("data") if isinstance(payload, dict) else None
        if isinstance(data, list):
            sample_ids = [
                item.get("id")
                for item in data[:5]
                if isinstance(item, dict) and item.get("id")
            ]
            return {"model_count": len(data), "sample_models": sample_ids}
        return {"response": payload}


config_manager = ConfigManager()
