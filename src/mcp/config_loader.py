from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from src.ai.config import AIConfig
from src.mcp.config_models import MCPServerConfig, MCPSettings, MCPTransportType


class MCPConfigLoader:
    PROJECT_CONFIG_RELATIVE_PATH = Path(".data_agent") / "mcp.json"
    USER_CONFIG_PATH = Path.home() / ".data_agent" / "mcp.json"

    @classmethod
    def project_config_path(cls, project_root: Path) -> Path:
        return project_root / cls.PROJECT_CONFIG_RELATIVE_PATH

    @classmethod
    def _read_json_file(cls, path: Path) -> dict[str, Any]:
        if not path.exists():
            return {}
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    @classmethod
    def load_effective_settings(
        cls,
        project_root: Path,
        ai_config: AIConfig,
        runtime_override: dict[str, Any] | None = None,
    ) -> MCPSettings:
        cls.ensure_user_settings_migrated(project_root)
        user_data = cls._read_json_file(cls.USER_CONFIG_PATH)
        override_data = runtime_override or {}

        merged = cls._merge_dicts(user_data, override_data)

        settings = MCPSettings.from_dict(merged)
        legacy_server = cls.from_legacy_ai_config(ai_config)

        if legacy_server:
            cls._upsert_legacy_database_server(settings, legacy_server)

        return settings

    @classmethod
    def save_project_settings(cls, project_root: Path, settings: MCPSettings) -> Path:
        path = cls.USER_CONFIG_PATH
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(settings.to_dict(), f, ensure_ascii=False, indent=2)
        return path

    @classmethod
    def ensure_user_settings_migrated(cls, project_root: Path) -> Path:
        user_path = cls.USER_CONFIG_PATH
        if user_path.exists():
            return user_path

        legacy_project_path = cls.project_config_path(project_root)
        legacy_data = cls._read_json_file(legacy_project_path)
        if not legacy_data:
            return user_path

        user_path.parent.mkdir(parents=True, exist_ok=True)
        with open(user_path, "w", encoding="utf-8") as f:
            json.dump(legacy_data, f, ensure_ascii=False, indent=2)
        return user_path

    @classmethod
    def from_legacy_ai_config(cls, ai_config: AIConfig) -> MCPServerConfig | None:
        if not ai_config.mcp_server_script:
            return None
        return MCPServerConfig(
            name="database",
            transport=MCPTransportType.STDIO,
            enabled=True,
            command=ai_config.mcp_server_command,
            script=ai_config.mcp_server_script,
            env=ai_config.get_mcp_env(),
            description="Legacy database MCP server",
            tool_prefix="db_",
            server_type="database",
            tags=["database", "legacy"],
        )

    @classmethod
    def _upsert_legacy_database_server(
        cls,
        settings: MCPSettings,
        legacy_server: MCPServerConfig,
    ) -> None:
        """
        Keep the legacy database MCP server sourced from AIConfig.

        Older mcp.json files may contain a full environment snapshot for the
        "database" server. Treat that as stale metadata: runtime database
        credentials belong to AIConfig/runtime config, while mcp.json owns only
        the server list and enabled state.
        """
        existing = settings.get_server(legacy_server.name)
        if existing is None:
            settings.servers.insert(0, legacy_server)
            return

        existing.transport = legacy_server.transport
        existing.command = legacy_server.command
        existing.script = legacy_server.script
        existing.args = list(legacy_server.args)
        existing.url = legacy_server.url
        existing.headers = dict(legacy_server.headers)
        existing.env = dict(legacy_server.env)
        existing.description = legacy_server.description
        existing.tool_prefix = legacy_server.tool_prefix
        existing.server_type = legacy_server.server_type
        existing.tags = list(legacy_server.tags)

    @classmethod
    def _merge_dicts(cls, base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
        if not base:
            return dict(override)
        if not override:
            return dict(base)

        result = dict(base)
        for key, value in override.items():
            if isinstance(value, dict) and isinstance(result.get(key), dict):
                result[key] = cls._merge_dicts(result[key], value)
            else:
                result[key] = value
        return result
