from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile
from typing import Any
from urllib import error, request

import yaml

from src.agent.tool_assembly import ToolAssemblyService
from src.agent.tool_providers.base import GlobalRuntimeServices
from src.agent.types import AgentTimingRecorder
from src.ai.config import AIConfig
from src.ai.gateway import AIGateway
from src.ai.profiles import LLMProfileStore
from src.connection_registry import ConnectionRegistry, DEFAULT_CONNECTION_ID
from src.mcp.config_loader import MCPConfigLoader
from src.mcp.config_models import MCPServerConfig, MCPSettings, MCPTransportType
from src.mcp.manager import mcp_manager
from src.mcp.mcp_client import format_mcp_error
from src.mcp.registry import MCPRegistry
from src.semantic_startup import SEMANTIC_SERVER_TYPE, semantic_startup

logger = logging.getLogger("data_agent.config_manager")

DATABASE_CONFIG_KEYS = ("host", "port", "user", "password", "database")
LLM_WARMUP_DISABLED_VALUES = {"0", "false", "no", "off"}
DEFAULT_LLM_WARMUP_TIMEOUT_SECONDS = 10.0
SEMANTIC_LLM_API_KEY_ENV = "DATA_AGENT_KTX_LLM_API_KEY"
SEMANTIC_LLM_BASE_URL_ENV = "DATA_AGENT_KTX_LLM_BASE_URL"
SEMANTIC_LLM_MODEL_ENV = "DATA_AGENT_KTX_LLM_MODEL"


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
        self.user_config_dir = Path(
            os.getenv("DATA_AGENT_CONFIG_DIR") or self.project_root / ".data_agent"
        )
        self.user_config_dir.mkdir(parents=True, exist_ok=True)
        self.runtime_config_path = self.user_config_dir / "runtime.json"
        self.semantic_project_dir = Path(
            os.getenv("DATA_AGENT_SEMANTIC_PROJECT_DIR") or self.user_config_dir / "semantic-context"
        ).expanduser().resolve()
        self.ai_config: AIConfig = AIConfig.from_env()
        self._base_database_config = self._current_database_config()
        self.llm_profiles = LLMProfileStore(self.user_config_dir / "llm_profiles.json", self.ai_config)
        self.connection_registry = ConnectionRegistry(self.user_config_dir / "connections.json")
        self._initialize_connection_registry()
        self.gateway: AIGateway | None = None
        self.tool_assembly = ToolAssemblyService(self.project_root)
        self._initialized = True

    # ── 生命周期 ──────────────────────────────────────────────────────────────

    async def startup(self) -> None:
        logger.info("[ConfigManager] 正在启动...")
        self.llm_profiles.apply_default_to(self.ai_config)
        self._sync_semantic_project()
        self.gateway = AIGateway(self.ai_config)
        settings = self.get_mcp_settings()
        await mcp_manager.start(settings)
        semantic_startup.configure(self.semantic_project_dir)
        await semantic_startup.start()
        await self._warmup_llm_gateway()
        logger.info("[ConfigManager] 启动完成。")

    async def shutdown(self) -> None:
        logger.info("[ConfigManager] 正在关闭...")
        await semantic_startup.stop()
        await mcp_manager.stop()
        if self.gateway is not None:
            await self.gateway.aclose()
        logger.info("[ConfigManager] 关闭完成。")

    # ── 配置热更新 ────────────────────────────────────────────────────────────

    async def _warmup_llm_gateway(self) -> None:
        if self.gateway is None:
            return
        enabled = os.getenv("DATA_AGENT_LLM_WARMUP", "1").strip().lower()
        if enabled in LLM_WARMUP_DISABLED_VALUES:
            logger.info("[ConfigManager] LLM warmup disabled")
            return
        timeout = DEFAULT_LLM_WARMUP_TIMEOUT_SECONDS
        raw_timeout = os.getenv("DATA_AGENT_LLM_WARMUP_TIMEOUT_SECONDS", "").strip()
        if raw_timeout:
            try:
                timeout = max(0.1, float(raw_timeout))
            except ValueError:
                logger.warning(
                    "[ConfigManager] Invalid DATA_AGENT_LLM_WARMUP_TIMEOUT_SECONDS=%r",
                    raw_timeout,
                )
        await self.gateway.warmup(timeout=timeout)

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
        normalized_base_url = base_url.strip() if isinstance(base_url, str) else ""

        if "model" in new_config and new_config["model"]:
            current = self.llm_profiles.default_profile()
            self.llm_profiles.upsert_profile(
                {
                    **current.to_dict(),
                    "name": str(new_config["model"]),
                    "provider": provider,
                    "model": str(new_config["model"]),
                    "base_url": normalized_base_url if provider != "anthropic" else "",
                },
                make_default=True,
            )
        elif normalized_base_url and provider != "anthropic":
            current = self.llm_profiles.default_profile()
            self.llm_profiles.upsert_profile(
                {
                    **current.to_dict(),
                    "provider": provider,
                    "base_url": normalized_base_url,
                },
                make_default=True,
            )
        self.llm_profiles.apply_default_to(self.ai_config)
        self.gateway = AIGateway(self.ai_config)
        self._sync_semantic_project()
        await self._reload_mcp()

    def list_llm_profiles(self) -> dict[str, Any]:
        default_profile = self.llm_profiles.default_profile()
        return {
            "default_profile_id": default_profile.id,
            "profiles": [
                self._serialize_llm_profile(profile)
                for profile in self.llm_profiles.list_profiles()
            ],
        }

    async def save_llm_profile(self, data: dict[str, Any]) -> dict[str, Any]:
        profile = self.llm_profiles.upsert_profile(data, make_default=bool(data.get("is_default")))
        if profile.is_default:
            self.llm_profiles.apply_default_to(self.ai_config)
            self.gateway = AIGateway(self.ai_config)
            self._sync_semantic_project()
            await self._reload_mcp()
        return self._serialize_llm_profile(profile)

    async def set_default_llm_profile(self, profile_id: str) -> dict[str, Any]:
        profile = self.llm_profiles.set_default(profile_id)
        self.llm_profiles.apply_default_to(self.ai_config)
        self.gateway = AIGateway(self.ai_config)
        self._sync_semantic_project()
        await self._reload_mcp()
        return self._serialize_llm_profile(profile)

    async def delete_llm_profile(self, profile_id: str) -> None:
        self.llm_profiles.delete_profile(profile_id)
        self.llm_profiles.apply_default_to(self.ai_config)
        self.gateway = AIGateway(self.ai_config)
        self._sync_semantic_project()
        await self._reload_mcp()

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
        logger.info("[ConfigManager] Updating default database connection: %s", list(new_config.keys()))
        existing = self.connection_registry.get(DEFAULT_CONNECTION_ID)
        base = existing or {
            "name": "Default MySQL",
            "driver": "mysql",
            **self._current_database_config(),
            "semantic_enabled": True,
        }
        values = {**base, **new_config}
        if not new_config.get("password") and existing is None:
            values["password"] = base.get("password", "")
        await self.save_database_connection(DEFAULT_CONNECTION_ID, values)

    def list_database_connections(self) -> dict[str, Any]:
        return self.connection_registry.api_snapshot()

    async def save_database_connection(
        self,
        connection_id: str,
        values: dict[str, Any],
    ) -> dict[str, Any]:
        logger.info("[ConfigManager] Updating database connection: %s", connection_id)
        self.connection_registry.upsert(connection_id, values)
        self._apply_default_registry_connection()
        self._sync_semantic_project()
        await self._reload_mcp()
        return self.connection_registry.api_snapshot()

    async def delete_database_connection(self, connection_id: str) -> dict[str, Any]:
        self.connection_registry.delete(connection_id)
        self._apply_default_registry_connection()
        self._sync_semantic_project()
        await self._reload_mcp()
        return self.connection_registry.api_snapshot()

    async def set_default_database_connection(self, connection_id: str) -> dict[str, Any]:
        self.connection_registry.set_default(connection_id)
        self._apply_default_registry_connection()
        await self._reload_mcp()
        return self.connection_registry.api_snapshot()

    async def _reload_mcp(self) -> None:
        await semantic_startup.stop()
        settings = self.get_mcp_settings()
        await mcp_manager.reconcile(settings)
        semantic_startup.configure(self.semantic_project_dir)
        await semantic_startup.retry()

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

        persisted_settings = MCPSettings(
            servers=[
                server
                for server in new_settings.servers
                if server.name != "semantic" and server.server_type != SEMANTIC_SERVER_TYPE
            ]
        )
        MCPConfigLoader.save_project_settings(self.project_root, persisted_settings)
        effective_settings = self._with_bundled_semantic_server(persisted_settings)
        await mcp_manager.reconcile(effective_settings)
        return self.serialize_mcp_settings(effective_settings)

    async def set_mcp_server_enabled(self, name: str, enabled: bool) -> dict[str, Any]:
        settings = self.get_mcp_settings()
        server = settings.get_server(name)
        if server is None:
            raise KeyError(name)
        if server.server_type == SEMANTIC_SERVER_TYPE:
            raise ValueError("The bundled semantic MCP is host-managed")

        if server.enabled == enabled:
            return self.serialize_mcp_server(settings=settings, name=name)

        server.enabled = enabled
        MCPConfigLoader.save_project_settings(self.project_root, settings)
        effective_settings = self._with_bundled_semantic_server(settings)
        await mcp_manager.reconcile(effective_settings)
        return self.serialize_mcp_server(settings=effective_settings, name=name)

    async def restart_mcp_server(self, name: str) -> dict[str, Any]:
        settings = self.get_mcp_settings()
        server = settings.get_server(name)
        if server is None:
            raise KeyError(name)
        if server.server_type == SEMANTIC_SERVER_TYPE:
            raise ValueError("The bundled semantic MCP is host-managed")
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
        effective_overrides["python_runtime"] = self.get_python_runtime_config()

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
        settings = MCPConfigLoader.load_effective_settings(self.project_root, self.ai_config)
        return self._with_bundled_semantic_server(settings)

    def configure_semantic_project_dir(self, project_dir: str | Path) -> None:
        self.semantic_project_dir = Path(project_dir).expanduser().resolve()

    def _with_bundled_semantic_server(self, settings: MCPSettings) -> MCPSettings:
        servers = [
            server
            for server in settings.servers
            if server.name != "semantic" and server.server_type != SEMANTIC_SERVER_TYPE
        ]
        has_project = (self.semantic_project_dir / "ktx.yaml").is_file()

        runtime_root_value = os.getenv("DATA_AGENT_KTX_SEMANTIC_RUNTIME_DIR", "").strip()
        # The managed Python daemon receives JSON over stdin/stdout. Windows
        # hosts may default to a legacy code page, which corrupts Chinese
        # semantic descriptions and can make sl_query fail while validation
        # appears healthy. Force UTF-8 for the host-owned KTX process tree.
        semantic_env = {
            "KTX_PROJECT_DIR": str(self.semantic_project_dir),
            "PYTHONUTF8": "1",
        }
        semantic_env.update(self.connection_registry.semantic_environment())
        semantic_env.update(self._semantic_llm_environment())
        if runtime_root_value:
            runtime_root = Path(runtime_root_value).expanduser().resolve()
            node_name = "node.exe" if os.name == "nt" else "node"
            command = str(runtime_root / "node" / node_name)
            script = str(runtime_root / "app" / "semantic-context" / "stdio-launcher.js")
            semantic_env["KTX_RUNTIME_ROOT"] = str(runtime_root / "python-runtime")
        else:
            command = os.getenv("DATA_AGENT_NODE_COMMAND") or shutil.which("node") or "node"
            script = str(
                self.project_root / "ktx" / "packages" / "cli" / "dist" / "semantic-context" / "stdio-launcher.js"
            )
            development_runtime_root = os.getenv("KTX_RUNTIME_ROOT", "").strip()
            if development_runtime_root:
                semantic_env["KTX_RUNTIME_ROOT"] = str(Path(development_runtime_root).expanduser().resolve())

        return MCPSettings(
            servers=[
                *servers,
                MCPServerConfig(
                    name="semantic",
                    transport=MCPTransportType.STDIO,
                    enabled=has_project,
                    command=command,
                    script=script,
                    args=["--project-dir", str(self.semantic_project_dir)],
                    env=semantic_env,
                    description=(
                        "Bundled ktx semantic context MCP"
                        if has_project
                        else "Bundled ktx semantic context MCP (configure ktx.yaml to enable)"
                    ),
                    tool_prefix="semantic_",
                    server_type=SEMANTIC_SERVER_TYPE,
                    tags=["semantic", "host-only-ingest"],
                ),
            ]
        )

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

        connection_id = str(conf.get("id") or "").strip()
        existing = self.connection_registry.get(connection_id) if connection_id else None
        database_config = self._merged_database_config(conf, base=existing)
        try:
            self._validate_database_config(database_config)
        except ValueError as exc:
            return {"success": False, "message": str(exc)}

        env = self.ai_config.get_mcp_env()
        env["MYSQL_HOST"] = database_config["host"]
        env["MYSQL_PORT"] = str(database_config["port"])
        env["MYSQL_USER"] = database_config["user"]
        env["MYSQL_PASSWORD"] = database_config["password"]
        env["MYSQL_DATABASE"] = database_config["database"]
        legacy_server.env = env

        registry = MCPRegistry()
        registry.configure(MCPSettings(servers=[legacy_server]))
        try:
            await registry.connect_all_enabled()
            tools = registry.list_tools()
            return {"success": True, "message": "连接成功", "details": tools}
        except Exception as e:
            return {"success": False, "message": f"连接失败: {format_mcp_error(e)}"}
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
        self.llm_profiles.apply_default_to(self.ai_config)
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
            "connections": self.list_database_connections(),
            "mcp_config": self.serialize_mcp_settings(settings),
            "python_runtime": self.get_python_runtime_config(),
            "llm_profiles": self.list_llm_profiles(),
        }

    def get_python_runtime_config(self) -> dict[str, Any]:
        data = self._read_runtime_config().get("python_runtime", {})
        mode = str(data.get("mode") or "bundled").lower()
        if mode not in {"bundled", "external"}:
            mode = "bundled"
        executable = str(data.get("executable") or "").strip()
        return {
            "mode": mode,
            "executable": executable,
            "label": self._python_runtime_label(mode, executable),
        }

    async def update_python_runtime_config(self, data: dict[str, Any]) -> dict[str, Any]:
        mode = str(data.get("mode") or "bundled").lower()
        if mode not in {"bundled", "external"}:
            raise ValueError("Invalid Python runtime mode")
        executable = str(data.get("executable") or "").strip()
        if mode == "external" and not executable:
            raise ValueError("External Python executable is required")
        if mode == "external":
            path = Path(executable).expanduser()
            if not path.is_absolute():
                path = (self.project_root / path).resolve()
            if not path.exists() or not path.is_file():
                raise ValueError("Python executable does not exist")
            executable = str(path)

        config = self._read_runtime_config()
        config["python_runtime"] = {
            "mode": mode,
            "executable": executable if mode == "external" else "",
        }
        self._write_runtime_config(config)
        return self.get_python_runtime_config()

    async def test_python_runtime_config(self, data: dict[str, Any]) -> dict[str, Any]:
        runtime = {
            "mode": str(data.get("mode") or "bundled").lower(),
            "executable": str(data.get("executable") or "").strip(),
        }
        if runtime["mode"] not in {"bundled", "external"}:
            return {"success": False, "message": "Invalid Python runtime mode"}
        if runtime["mode"] == "external":
            executable = Path(runtime["executable"]).expanduser()
            if not executable.is_absolute():
                executable = (self.project_root / executable).resolve()
            runtime["executable"] = str(executable)
            if not executable.exists() or not executable.is_file():
                return {"success": False, "message": "Python executable does not exist"}

        script = None
        try:
            with tempfile.NamedTemporaryFile(
                "w",
                suffix=".py",
                encoding="utf-8",
                delete=False,
                dir=self.user_config_dir,
            ) as handle:
                script = Path(handle.name)
                handle.write(
                    "import json, sys\n"
                    "print(json.dumps({'executable': sys.executable, 'version': sys.version.split()[0]}, ensure_ascii=False))\n"
                )
            cmd = self._python_runtime_command(runtime, script)
            result = await asyncio.to_thread(
                subprocess.run,
                cmd,
                cwd=str(self.project_root),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=15,
            )
            if result.returncode != 0:
                return {
                    "success": False,
                    "message": (result.stderr or result.stdout or "Python runtime test failed").strip(),
                }
            details = json.loads(result.stdout.strip().splitlines()[-1])
            return {"success": True, "message": "Python runtime verified", "details": details}
        except Exception as exc:
            return {"success": False, "message": str(exc)}
        finally:
            if script is not None:
                try:
                    script.unlink(missing_ok=True)
                except Exception:
                    pass

    def _read_runtime_config(self) -> dict[str, Any]:
        if not self.runtime_config_path.exists():
            return {}
        try:
            data = json.loads(self.runtime_config_path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception as exc:
            logger.warning("[ConfigManager] Failed to read runtime config: %s", exc)
            return {}

    def _write_runtime_config(self, config: dict[str, Any]) -> None:
        self.runtime_config_path.write_text(
            json.dumps(config, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _current_database_config(self) -> dict[str, Any]:
        return {
            "host": self.ai_config.mysql_host,
            "port": self.ai_config.mysql_port,
            "user": self.ai_config.mysql_user,
            "password": self.ai_config.mysql_password,
            "database": self.ai_config.mysql_database,
        }

    def _merged_database_config(
        self,
        new_config: dict[str, Any],
        *,
        base: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        database_config = {
            key: (base or self._current_database_config()).get(key)
            for key in DATABASE_CONFIG_KEYS
        }
        for key in DATABASE_CONFIG_KEYS:
            if key not in new_config:
                continue
            value = new_config[key]
            if key == "password" and (value is None or str(value) == ""):
                continue
            database_config[key] = value
        database_config["port"] = int(database_config["port"])
        for key in ("host", "user", "password", "database"):
            database_config[key] = "" if database_config[key] is None else str(database_config[key]).strip()
        return database_config

    def _validate_database_config(self, database_config: dict[str, Any]) -> None:
        if not database_config["host"]:
            raise ValueError("Database host is required")
        if not database_config["user"]:
            raise ValueError("Database user is required")
        if not database_config["database"]:
            raise ValueError("Database name is required")
        port = int(database_config["port"])
        if port < 1 or port > 65535:
            raise ValueError("Database port must be between 1 and 65535")

    def _apply_database_config(self, database_config: dict[str, Any]) -> None:
        self.ai_config.mysql_host = database_config["host"]
        self.ai_config.mysql_port = int(database_config["port"])
        self.ai_config.mysql_user = database_config["user"]
        self.ai_config.mysql_password = database_config["password"]
        self.ai_config.mysql_database = database_config["database"]

    def _initialize_connection_registry(self) -> None:
        runtime = self._read_runtime_config()
        persisted = runtime.get("database", {})
        legacy = persisted if isinstance(persisted, dict) and persisted else self._base_database_config
        try:
            database_config = self._merged_database_config(legacy)
            self._validate_database_config(database_config)
        except Exception as exc:
            logger.info("[ConfigManager] No legacy database connection to migrate: %s", exc)
        else:
            self.connection_registry.migrate_legacy(database_config)

        if "database" in runtime and self.connection_registry.snapshot()["connections"]:
            runtime.pop("database", None)
            self._write_runtime_config(runtime)

        self._apply_default_registry_connection()
        try:
            self._sync_semantic_project()
        except (OSError, ValueError, yaml.YAMLError) as exc:
            logger.warning("[ConfigManager] Failed to sync semantic project config: %s", exc)

    def _apply_default_registry_connection(self) -> None:
        default_connection = self.connection_registry.default_connection()
        if default_connection is None:
            self._apply_database_config(self._base_database_config)
            return
        _, connection = default_connection
        self._apply_database_config(connection)

    def _sync_semantic_project(self) -> None:
        self.connection_registry.sync_ktx_project(self.semantic_project_dir)
        config_path = self.semantic_project_dir / "ktx.yaml"
        if not config_path.is_file():
            return

        loaded = yaml.safe_load(config_path.read_text(encoding="utf-8"))
        if not isinstance(loaded, dict):
            raise ValueError("ktx.yaml must contain a YAML object")

        # These are the host-owned semantic scan policy fields.  Only the
        # policy knobs are projected; all other KTX user configuration remains
        # untouched.  The embedding block itself is host-owned and is reduced
        # to backend:none so stale model/provider fields cannot start a daemon.
        # `none` is intentional: embeddings are optional enrichment signals and
        # must not start a daemon or block an enriched scan.
        ingest = loaded.get("ingest")
        if ingest is None:
            ingest = {}
        if not isinstance(ingest, dict):
            raise ValueError("ktx.yaml ingest must contain a YAML object")
        embeddings = ingest.get("embeddings")
        if embeddings is None:
            embeddings = {}
        if not isinstance(embeddings, dict):
            raise ValueError("ktx.yaml ingest.embeddings must contain a YAML object")
        embeddings.clear()
        embeddings["backend"] = "none"
        ingest["embeddings"] = embeddings
        loaded["ingest"] = ingest

        scan = loaded.get("scan")
        if scan is None:
            scan = {}
        if not isinstance(scan, dict):
            raise ValueError("ktx.yaml scan must contain a YAML object")
        enrichment = scan.get("enrichment")
        if enrichment is None:
            enrichment = {}
        if not isinstance(enrichment, dict):
            raise ValueError("ktx.yaml scan.enrichment must contain a YAML object")
        enrichment.clear()
        enrichment["mode"] = "llm"
        scan["enrichment"] = enrichment
        relationships = scan.get("relationships")
        if relationships is None:
            relationships = {}
        if not isinstance(relationships, dict):
            raise ValueError("ktx.yaml scan.relationships must contain a YAML object")
        relationships["enabled"] = True
        relationships["llmProposals"] = True
        relationships["validationRequiredForManifest"] = True
        scan["relationships"] = relationships
        loaded["scan"] = scan

        profile = self.llm_profiles.default_profile()
        if profile.provider == "anthropic":
            provider_config: dict[str, Any] = {
                "backend": "anthropic",
                "anthropic": {"api_key": f"env:{SEMANTIC_LLM_API_KEY_ENV}"},
            }
            if profile.base_url:
                provider_config["anthropic"]["base_url"] = f"env:{SEMANTIC_LLM_BASE_URL_ENV}"
        else:
            provider_config = {
                "backend": "openai-compatible",
                "openai": {
                    "api_key": f"env:{SEMANTIC_LLM_API_KEY_ENV}",
                    "base_url": f"env:{SEMANTIC_LLM_BASE_URL_ENV}",
                },
            }

        llm = loaded.get("llm")
        if llm is None:
            llm = {}
        if not isinstance(llm, dict):
            raise ValueError("ktx.yaml llm must contain a YAML object")
        models = llm.get("models")
        if models is None:
            models = {}
        if not isinstance(models, dict):
            raise ValueError("ktx.yaml llm.models must contain a YAML object")
        models["default"] = f"env:{SEMANTIC_LLM_MODEL_ENV}"
        llm["provider"] = provider_config
        llm["models"] = models
        if profile.provider != "anthropic":
            llm["promptCaching"] = {"enabled": False}
        loaded["llm"] = llm

        serialized = yaml.safe_dump(
            loaded,
            allow_unicode=True,
            sort_keys=False,
            default_flow_style=False,
        )
        temporary_path = config_path.with_name(f".{config_path.name}.{os.getpid()}.tmp")
        temporary_path.write_text(serialized, encoding="utf-8")
        os.replace(temporary_path, config_path)

    def _semantic_llm_environment(self) -> dict[str, str]:
        profile = self.llm_profiles.default_profile()
        if profile.provider == "anthropic":
            api_key = self.ai_config.anthropic_api_key
            base_url = profile.base_url
        else:
            api_key = self.ai_config.openai_api_key
            base_url = profile.base_url or self.ai_config.openai_base_url or "https://api.openai.com/v1"
        environment = {
            SEMANTIC_LLM_MODEL_ENV: profile.model,
        }
        if api_key:
            environment[SEMANTIC_LLM_API_KEY_ENV] = api_key
        if base_url:
            environment[SEMANTIC_LLM_BASE_URL_ENV] = base_url
        return environment

    def _python_runtime_command(self, runtime: dict[str, Any], script_path: Path) -> list[str]:
        mode = str(runtime.get("mode") or "bundled").lower()
        executable = str(runtime.get("executable") or "").strip()
        if mode == "external" and executable:
            cmd = [executable]
            if sys.platform == "win32":
                cmd.extend(["-X", "utf8"])
            cmd.append(str(script_path))
            return cmd
        if getattr(sys, "frozen", False):
            return [sys.executable, "--data-agent-run-python-script", str(script_path)]
        cmd = [sys.executable]
        if sys.platform == "win32":
            cmd.extend(["-X", "utf8"])
        cmd.append(str(script_path))
        return cmd

    def _python_runtime_label(self, mode: str, executable: str) -> str:
        if mode == "external" and executable:
            return executable
        if getattr(sys, "frozen", False):
            return "Bundled Data Agent Python"
        return sys.executable

    def serialize_mcp_settings(self, settings: MCPSettings | None = None) -> dict[str, Any]:
        settings = settings or self.get_mcp_settings()
        return {
            "servers": [
                self._serialize_mcp_server_config(s)
                for s in settings.servers
                if s.server_type != SEMANTIC_SERVER_TYPE
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
            "args": list(server.args),
            "url": server.url,
            "headers": self._summarize_mapping(server.headers),
            "env": self._summarize_mapping(server.env),
            "description": server.description,
            "tool_prefix": server.tool_prefix,
            "server_type": server.server_type,
            "tags": list(server.tags),
            "host_managed": server.server_type == SEMANTIC_SERVER_TYPE,
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

    def _serialize_llm_profile(self, profile) -> dict[str, Any]:
        data = profile.to_dict()
        if profile.provider == "anthropic":
            data["api_key_configured"] = bool(self.ai_config.anthropic_api_key)
        else:
            data["api_key_configured"] = bool(self.ai_config.openai_api_key)
        return data

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
