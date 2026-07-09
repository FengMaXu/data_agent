import pytest
import json
from types import SimpleNamespace

import src.api.mcp as mcp_api_module
import src.config_manager as config_manager_module
import src.mcp.manager as manager_module
from src.agent.tool_search import ToolSearchCatalog
from src.ai.config import AIConfig
from src.mcp.config_models import MCPServerConfig, MCPSettings, MCPTransportType
from fastapi import HTTPException


def _server(
    name: str,
    *,
    enabled: bool = True,
    url: str = "",
    command: str = "python",
    script: str = "",
    server_type: str = "service",
) -> MCPServerConfig:
    transport = MCPTransportType.STREAMABLE_HTTP if url else MCPTransportType.STDIO
    return MCPServerConfig(
        name=name,
        enabled=enabled,
        transport=transport,
        url=url,
        command=command,
        script=script,
        server_type=server_type,
    )


@pytest.mark.asyncio
async def test_reconcile_only_restarts_changed_servers(monkeypatch):
    events: list[tuple[str, str, str]] = []

    class FakeManagedServer:
        def __init__(self, config: MCPServerConfig, max_concurrent: int = 3) -> None:
            self._config = config
            self._ready = SimpleNamespace(is_set=lambda: True)

        @property
        def config(self) -> MCPServerConfig:
            return self._config

        async def start(self) -> None:
            events.append(("start", self._config.name, self._config.url))

        async def stop(self) -> None:
            events.append(("stop", self._config.name, self._config.url))

    monkeypatch.setattr(manager_module, "_ManagedServer", FakeManagedServer)

    manager = manager_module.MCPManager()
    initial = MCPSettings(servers=[
        _server("database", command="python", script="db.py", server_type="database"),
        _server("qcc-company", url="https://a.example.com/mcp"),
        _server("qcc-risk", enabled=False, url="https://risk.example.com/mcp"),
    ])
    await manager.start(initial)
    assert events == [
        ("start", "database", ""),
        ("start", "qcc-company", "https://a.example.com/mcp"),
    ]

    events.clear()
    updated = MCPSettings(servers=[
        _server("database", command="python", script="db.py", server_type="database"),
        _server("qcc-company", url="https://b.example.com/mcp"),
        _server("qcc-risk", enabled=True, url="https://risk.example.com/mcp"),
    ])
    await manager.reconcile(updated)

    assert events == [
        ("stop", "qcc-company", "https://a.example.com/mcp"),
        ("start", "qcc-company", "https://b.example.com/mcp"),
        ("start", "qcc-risk", "https://risk.example.com/mcp"),
    ]
    assert set(manager._servers) == {"database", "qcc-company", "qcc-risk"}
    assert manager.get_server("database").config.script == "db.py"
    assert manager.get_server("qcc-company").config.url == "https://b.example.com/mcp"

    events.clear()
    disabled = MCPSettings(servers=[
        _server("database", command="python", script="db.py", server_type="database"),
        _server("qcc-company", enabled=False, url="https://b.example.com/mcp"),
        _server("qcc-risk", enabled=True, url="https://risk.example.com/mcp"),
    ])
    await manager.reconcile(disabled)

    assert events == [
        ("stop", "qcc-company", "https://b.example.com/mcp"),
    ]
    assert set(manager._servers) == {"database", "qcc-risk"}


@pytest.mark.asyncio
async def test_runtime_fingerprint_changes_after_restart(monkeypatch):
    class FakeManagedServer:
        counter = 0

        def __init__(self, config: MCPServerConfig, max_concurrent: int = 3) -> None:
            FakeManagedServer.counter += 1
            self._config = config
            self._ready = SimpleNamespace(is_set=lambda: True)
            self._generation = FakeManagedServer.counter
            self.tools = [{"name": "execute_sql"}]

        @property
        def config(self) -> MCPServerConfig:
            return self._config

        async def start(self) -> None:
            pass

        async def stop(self) -> None:
            pass

    monkeypatch.setattr(manager_module, "_ManagedServer", FakeManagedServer)

    manager = manager_module.MCPManager()
    settings = MCPSettings(servers=[
        _server("database", command="python", script="db.py", server_type="database"),
    ])
    await manager.start(settings)
    before = manager.runtime_fingerprint(["database"])

    await manager.restart_server("database", settings)
    after = manager.runtime_fingerprint(["database"])

    assert before != after
    assert after[0]["name"] == "database"


@pytest.mark.asyncio
async def test_bridged_mcp_tools_are_searchable_by_mcp_source_terms():
    class FakeManagedServer:
        def __init__(self) -> None:
            self._config = MCPServerConfig(
                name="qcc-company",
                description="Company profile service",
                tags=["qcc"],
            )
            self.tools = [
                {
                    "name": "get_company_by_query",
                    "description": "Find company by keyword",
                    "parameters": {
                        "type": "object",
                        "properties": {"keyword": {"type": "string"}},
                    },
                }
            ]

        @property
        def config(self) -> MCPServerConfig:
            return self._config

        async def call_tool(self, name: str, arguments: dict):
            return "{}"

    manager = manager_module.MCPManager()
    manager._servers = {"qcc-company": FakeManagedServer()}

    catalog = ToolSearchCatalog(manager.bridge_tools())
    result = await catalog.execute("call_1", {"query": "mcp"})

    assert result.details["matches"] == ["qcc-company_get_company_by_query"]


@pytest.mark.asyncio
async def test_restart_server_only_restarts_target(monkeypatch):
    events: list[tuple[str, str, str]] = []

    class FakeManagedServer:
        def __init__(self, config: MCPServerConfig, max_concurrent: int = 3) -> None:
            self._config = config
            self._ready = SimpleNamespace(is_set=lambda: True)

        @property
        def config(self) -> MCPServerConfig:
            return self._config

        async def start(self) -> None:
            events.append(("start", self._config.name, self._config.url))

        async def stop(self) -> None:
            events.append(("stop", self._config.name, self._config.url))

    monkeypatch.setattr(manager_module, "_ManagedServer", FakeManagedServer)

    manager = manager_module.MCPManager()
    settings = MCPSettings(servers=[
        _server("database", command="python", script="db.py", server_type="database"),
        _server("qcc-company", url="https://company.example.com/mcp"),
    ])
    await manager.start(settings)

    events.clear()
    await manager.restart_server("qcc-company", settings)

    assert events == [
        ("stop", "qcc-company", "https://company.example.com/mcp"),
        ("start", "qcc-company", "https://company.example.com/mcp"),
    ]
    assert set(manager._servers) == {"database", "qcc-company"}


@pytest.mark.asyncio
async def test_save_mcp_settings_uses_reconcile(monkeypatch):
    config_manager = config_manager_module.ConfigManager()
    old_settings = MCPSettings(servers=[
        MCPServerConfig(
            name="database",
            enabled=True,
            transport=MCPTransportType.STDIO,
            command="python",
            script="db.py",
            env={"MYSQL_HOST": "127.0.0.1"},
            headers={"Authorization": "Bearer old"},
            server_type="database",
        )
    ])

    reconcile_calls: list[MCPSettings] = []
    saved_settings: list[MCPSettings] = []

    class DummyMCPManager:
        async def reconcile(self, settings: MCPSettings) -> None:
            reconcile_calls.append(settings)

        async def restart(self, settings: MCPSettings) -> None:
            raise AssertionError("save_mcp_settings should not call restart()")

    monkeypatch.setattr(config_manager, "get_mcp_settings", lambda: old_settings)
    monkeypatch.setattr(config_manager_module, "mcp_manager", DummyMCPManager())
    monkeypatch.setattr(
        config_manager_module.MCPConfigLoader,
        "save_project_settings",
        lambda project_root, settings: saved_settings.append(settings),
    )

    result = await config_manager.save_mcp_settings({
        "servers": [
            {
                "name": "database",
                "transport": "stdio",
                "enabled": True,
                "command": "python",
                "script": "db.py",
                "server_type": "database",
            }
        ]
    })

    assert len(saved_settings) == 1
    assert len(reconcile_calls) == 1
    saved_server = saved_settings[0].get_server("database")
    assert saved_server is not None
    assert saved_server.env == {"MYSQL_HOST": "127.0.0.1"}
    assert saved_server.headers == {"Authorization": "Bearer old"}
    assert result["servers"][0]["name"] == "database"


@pytest.mark.asyncio
async def test_set_mcp_server_enabled_persists_and_returns_runtime_state(monkeypatch):
    config_manager = config_manager_module.ConfigManager()
    settings = MCPSettings(servers=[
        MCPServerConfig(
            name="qcc-company",
            enabled=True,
            transport=MCPTransportType.STREAMABLE_HTTP,
            url="https://company.example.com/mcp",
            description="Company MCP",
        )
    ])

    saved_settings: list[MCPSettings] = []
    reconcile_calls: list[MCPSettings] = []

    class DummyManagedServer:
        def status(self) -> dict[str, object]:
            return {
                "name": "qcc-company",
                "server_type": "service",
                "transport": "streamable-http",
                "connected": False,
                "generation": 3,
                "tool_count": 0,
                "description": "Company MCP",
                "tool_prefix": "qcc-company_",
                "tags": [],
            }

    class DummyMCPManager:
        async def reconcile(self, new_settings: MCPSettings) -> None:
            reconcile_calls.append(new_settings)

        def get_server(self, name: str):
            return None if name == "qcc-company" else DummyManagedServer()

    monkeypatch.setattr(config_manager, "get_mcp_settings", lambda: settings)
    monkeypatch.setattr(config_manager_module, "mcp_manager", DummyMCPManager())
    monkeypatch.setattr(
        config_manager_module.MCPConfigLoader,
        "save_project_settings",
        lambda project_root, new_settings: saved_settings.append(new_settings),
    )

    result = await config_manager.set_mcp_server_enabled("qcc-company", False)

    assert len(saved_settings) == 1
    assert len(reconcile_calls) == 1
    assert saved_settings[0].get_server("qcc-company").enabled is False
    assert result["name"] == "qcc-company"
    assert result["enabled"] is False
    assert result["connected"] is False
    assert result["tool_count"] == 0


@pytest.mark.asyncio
async def test_restart_mcp_server_delegates_to_manager(monkeypatch):
    config_manager = config_manager_module.ConfigManager()
    settings = MCPSettings(servers=[
        MCPServerConfig(
            name="qcc-company",
            enabled=True,
            transport=MCPTransportType.STREAMABLE_HTTP,
            url="https://company.example.com/mcp",
            description="Company MCP",
        )
    ])

    restart_calls: list[tuple[str, MCPSettings]] = []

    class DummyManagedServer:
        def status(self) -> dict[str, object]:
            return {
                "name": "qcc-company",
                "enabled": True,
                "status": "connected",
                "server_type": "service",
                "transport": "streamable-http",
                "connected": True,
                "generation": 8,
                "tool_count": 14,
                "description": "Company MCP",
                "tool_prefix": "qcc-company_",
                "tags": [],
            }

    class DummyMCPManager:
        async def restart_server(self, name: str, current_settings: MCPSettings) -> None:
            restart_calls.append((name, current_settings))

        def get_server(self, name: str):
            return DummyManagedServer() if name == "qcc-company" else None

    monkeypatch.setattr(config_manager, "get_mcp_settings", lambda: settings)
    monkeypatch.setattr(config_manager_module, "mcp_manager", DummyMCPManager())

    result = await config_manager.restart_mcp_server("qcc-company")

    assert restart_calls == [("qcc-company", settings)]
    assert result["name"] == "qcc-company"
    assert result["status"] == "connected"
    assert result["tool_count"] == 14


@pytest.mark.asyncio
async def test_list_mcp_servers_returns_all_configured_servers_with_runtime(monkeypatch):
    config_manager = config_manager_module.ConfigManager()
    settings = MCPSettings(servers=[
        MCPServerConfig(
            name="database",
            enabled=True,
            transport=MCPTransportType.STDIO,
            command="python",
            script="db.py",
            server_type="database",
            description="DB MCP",
        ),
        MCPServerConfig(
            name="qcc-risk",
            enabled=False,
            transport=MCPTransportType.STREAMABLE_HTTP,
            url="https://risk.example.com/mcp",
            description="Risk MCP",
        ),
    ])

    class DummyManagedServer:
        def status(self) -> dict[str, object]:
            return {
                "name": "database",
                "enabled": True,
                "status": "connected",
                "server_type": "database",
                "transport": "stdio",
                "connected": True,
                "generation": 7,
                "tool_count": 3,
                "description": "DB MCP",
                "tool_prefix": "database_",
                "tags": [],
            }

    class DummyMCPManager:
        def get_server(self, name: str):
            return DummyManagedServer() if name == "database" else None

    monkeypatch.setattr(config_manager, "get_mcp_settings", lambda: settings)
    monkeypatch.setattr(config_manager_module, "mcp_manager", DummyMCPManager())

    result = await config_manager.list_mcp_servers()

    assert [item["name"] for item in result] == ["database", "qcc-risk"]
    assert result[0]["status"] == "connected"
    assert result[0]["tool_count"] == 3
    assert result[1]["enabled"] is False
    assert result[1]["status"] == "disabled"
    assert result[1]["connected"] is False
    assert result[1]["tool_count"] == 0


@pytest.mark.asyncio
async def test_update_mcp_server_enabled_route_delegates_to_config_manager(monkeypatch):
    calls: list[tuple[str, bool]] = []

    class DummyConfigManager:
        async def set_mcp_server_enabled(self, name: str, enabled: bool):
            calls.append((name, enabled))
            if name == "missing":
                raise KeyError(name)
            return {"name": name, "enabled": enabled, "connected": enabled}

    monkeypatch.setattr(mcp_api_module, "config_manager", DummyConfigManager())

    response = await mcp_api_module.update_mcp_server_enabled(
        "qcc-risk",
        mcp_api_module.MCPEnabledUpdateRequest(enabled=False),
    )
    assert response == {
        "status": "success",
        "server": {"name": "qcc-risk", "enabled": False, "connected": False},
    }
    assert calls == [("qcc-risk", False)]

    with pytest.raises(HTTPException) as exc_info:
        await mcp_api_module.update_mcp_server_enabled(
            "missing",
            mcp_api_module.MCPEnabledUpdateRequest(enabled=True),
        )
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_restart_mcp_server_route_maps_errors(monkeypatch):
    calls: list[str] = []

    class DummyConfigManager:
        async def restart_mcp_server(self, name: str):
            calls.append(name)
            if name == "missing":
                raise KeyError(name)
            if name == "disabled":
                raise ValueError("MCP server is disabled: disabled")
            return {"name": name, "status": "connected"}

    monkeypatch.setattr(mcp_api_module, "config_manager", DummyConfigManager())

    response = await mcp_api_module.restart_mcp_server("qcc-company")
    assert response == {"status": "success", "server": {"name": "qcc-company", "status": "connected"}}

    with pytest.raises(HTTPException) as not_found:
        await mcp_api_module.restart_mcp_server("missing")
    assert not_found.value.status_code == 404

    with pytest.raises(HTTPException) as bad_request:
        await mcp_api_module.restart_mcp_server("disabled")
    assert bad_request.value.status_code == 400
    assert calls == ["qcc-company", "missing", "disabled"]


@pytest.mark.asyncio
async def test_update_db_config_persists_runtime_config_and_reconciles_effective_database_env(
    monkeypatch,
    tmp_path,
):
    user_mcp_path = tmp_path / "mcp.json"
    user_mcp_path.write_text(
        json.dumps(
            {
                "servers": [
                    {
                        "name": "database",
                        "transport": "stdio",
                        "enabled": True,
                        "command": "python",
                        "script": "db.py",
                        "env": {
                            "MYSQL_HOST": "localhost",
                            "MYSQL_PORT": "3306",
                            "MYSQL_USER": "root",
                            "MYSQL_PASSWORD": "old-password",
                            "MYSQL_DATABASE": "old_db",
                        },
                        "server_type": "database",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    config_manager = config_manager_module.ConfigManager()
    config_manager.project_root = tmp_path
    config_manager.user_config_dir = tmp_path
    config_manager.runtime_config_path = tmp_path / "runtime.json"
    config_manager.ai_config = AIConfig(
        mcp_server_script="db.py",
        mysql_host="localhost",
        mysql_port=3306,
        mysql_user="root",
        mysql_password="current-password",
        mysql_database="old_db",
    )

    reconcile_calls: list[MCPSettings] = []

    class DummyMCPManager:
        async def reconcile(self, settings: MCPSettings) -> None:
            reconcile_calls.append(settings)

    monkeypatch.setattr(config_manager_module.MCPConfigLoader, "USER_CONFIG_PATH", user_mcp_path)
    monkeypatch.setattr(config_manager_module, "mcp_manager", DummyMCPManager())

    await config_manager.update_db_config({"database": "wwe", "password": ""})

    runtime = json.loads(config_manager.runtime_config_path.read_text(encoding="utf-8"))
    assert runtime["database"]["database"] == "wwe"
    assert runtime["database"]["password"] == "current-password"
    assert len(reconcile_calls) == 1

    database_server = reconcile_calls[0].get_server("database")
    assert database_server is not None
    assert database_server.env["MYSQL_DATABASE"] == "wwe"
    assert database_server.env["MYSQL_PASSWORD"] == "current-password"
    assert database_server.enabled is True
