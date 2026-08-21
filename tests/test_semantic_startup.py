from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from src.mcp.config_models import MCPServerConfig
from src.mcp.config_models import MCPSettings
from src.mcp.manager import MCPManager, _ManagedServer
from src.semantic_startup import SemanticStartupService


class FakeSemanticServer:
    def __init__(self, snapshots: list[dict[str, Any]], validation: dict[str, Any], job_id: str = "job-1") -> None:
        self.snapshots = iter(snapshots)
        self.validation = validation
        self.job_id = job_id
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.connected = True
        self.generation = 1

    def status(self) -> dict[str, Any]:
        return {"connected": self.connected, "generation": self.generation}

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> str:
        self.calls.append((name, arguments))
        if name == "sl_ingest":
            return json.dumps({"jobId": self.job_id, "phase": "queued"})
        if name == "sl_ingest_status":
            return json.dumps(next(self.snapshots))
        if name == "sl_validate":
            return json.dumps(self.validation)
        raise AssertionError(name)


class FakeManager:
    def __init__(self, server: FakeSemanticServer | None) -> None:
        self.server = server

    def find_server_by_type(self, server_type: str) -> FakeSemanticServer | None:
        return self.server if server_type == "semantic" else None


def configured_project(tmp_path: Path) -> Path:
    project = tmp_path / "semantic-context"
    project.mkdir()
    (project / "ktx.yaml").write_text("connections: {}\n", encoding="utf-8")
    return project


def run_startup(
    tmp_path: Path,
    snapshots: list[dict[str, Any]],
    validation: dict[str, Any],
) -> tuple[dict[str, Any], FakeSemanticServer]:
    async def scenario() -> tuple[dict[str, Any], FakeSemanticServer]:
        server = FakeSemanticServer(snapshots, validation)
        service = SemanticStartupService(FakeManager(server))
        service.configure(configured_project(tmp_path))
        initial = await service.start()
        assert initial["status"] == "checking"
        assert service._task is not None
        await service._task
        return service.status(), server

    return asyncio.run(scenario())


def test_missing_configuration_is_skipped(tmp_path: Path) -> None:
    async def scenario() -> dict[str, Any]:
        service = SemanticStartupService(FakeManager(None))
        service.configure(tmp_path / "missing")
        return await service.start()

    result = asyncio.run(scenario())
    assert result["status"] == "skipped"
    assert result["errorCode"] == "semantic_configuration_missing"


def test_completed_ingest_becomes_ready(tmp_path: Path) -> None:
    result, server = run_startup(
        tmp_path,
        [{
            "jobId": "job-1",
            "phase": "completed",
            "currentConnectionId": None,
            "completedConnections": 1,
            "totalConnections": 1,
            "summary": {"updated": 1, "unchanged": 0, "failed": 0, "skipped": 0},
            "results": [{"connectionId": "warehouse", "status": "completed"}],
            "catalogReady": True,
        }],
        {"valid": True, "catalogReady": True, "errors": [], "warnings": []},
    )
    assert result["status"] == "ready"
    assert [name for name, _ in server.calls] == ["sl_ingest", "sl_ingest_status", "sl_validate"]


def test_running_ingest_is_polled_until_terminal(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.setattr("src.semantic_startup.SEMANTIC_INGEST_POLL_SECONDS", 0)
    result, server = run_startup(
        tmp_path,
        [
            {
                "jobId": "job-1",
                "phase": "running",
                "currentConnectionId": "warehouse",
                "completedConnections": 0,
                "totalConnections": 1,
                "summary": {"updated": 0, "unchanged": 0, "failed": 0, "skipped": 0},
                "results": [],
                "catalogReady": False,
            },
            {
                "jobId": "job-1",
                "phase": "completed",
                "currentConnectionId": None,
                "completedConnections": 1,
                "totalConnections": 1,
                "summary": {"updated": 1, "unchanged": 0, "failed": 0, "skipped": 0},
                "results": [{"connectionId": "warehouse", "status": "completed"}],
                "catalogReady": True,
            },
        ],
        {"valid": True, "catalogReady": True, "errors": [], "warnings": []},
    )

    assert result["status"] == "ready"
    assert [name for name, _ in server.calls].count("sl_ingest_status") == 2


def test_existing_catalog_is_reused_without_starting_refresh(tmp_path: Path) -> None:
    project = configured_project(tmp_path)
    catalog_dir = project / "semantic-layer" / "warehouse"
    catalog_dir.mkdir(parents=True)
    (catalog_dir / "orders.yaml").write_text("name: orders\n", encoding="utf-8")

    async def scenario() -> tuple[dict[str, Any], FakeSemanticServer]:
        server = FakeSemanticServer(
            [{
                "jobId": "job-1",
                "phase": "completed",
                "currentConnectionId": None,
                "completedConnections": 1,
                "totalConnections": 1,
                "summary": {"updated": 0, "unchanged": 1, "failed": 0, "skipped": 0},
                "results": [{"connectionId": "warehouse", "status": "completed"}],
                "catalogReady": True,
            }],
            {"valid": True, "catalogReady": True, "errors": [], "warnings": []},
        )
        service = SemanticStartupService(FakeManager(server))
        service.configure(project)
        await service.start()
        assert service._task is not None
        await service._task
        return service.status(), server

    result, server = asyncio.run(scenario())
    assert result["status"] == "ready"
    assert [name for name, _ in server.calls] == ["sl_validate"]


def test_retry_refreshes_an_existing_catalog(tmp_path: Path) -> None:
    project = configured_project(tmp_path)
    catalog_dir = project / "semantic-layer" / "warehouse"
    catalog_dir.mkdir(parents=True)
    (catalog_dir / "orders.yaml").write_text("name: orders\n", encoding="utf-8")

    async def scenario() -> tuple[dict[str, Any], FakeSemanticServer]:
        server = FakeSemanticServer(
            [{
                "jobId": "job-1",
                "phase": "completed",
                "currentConnectionId": None,
                "completedConnections": 1,
                "totalConnections": 1,
                "summary": {"updated": 0, "unchanged": 1, "failed": 0, "skipped": 0},
                "results": [{"connectionId": "warehouse", "status": "completed"}],
                "catalogReady": True,
            }],
            {"valid": True, "catalogReady": True, "errors": [], "warnings": []},
        )
        service = SemanticStartupService(FakeManager(server))
        service.configure(project)
        await service.retry()
        assert service._task is not None
        await service._task
        return service.status(), server

    result, server = asyncio.run(scenario())
    assert result["status"] == "ready"
    assert [name for name, _ in server.calls] == [
        "sl_validate",
        "sl_ingest",
        "sl_ingest_status",
        "sl_validate",
    ]


def test_partial_ingest_with_catalog_becomes_degraded(tmp_path: Path) -> None:
    result, _ = run_startup(
        tmp_path,
        [{
            "jobId": "job-1",
            "phase": "partial",
            "currentConnectionId": None,
            "completedConnections": 2,
            "totalConnections": 2,
            "summary": {"updated": 1, "unchanged": 0, "failed": 1, "skipped": 0},
            "results": [
                {"connectionId": "warehouse", "status": "completed"},
                {"connectionId": "broken", "status": "failed"},
            ],
            "catalogReady": True,
        }],
        {"valid": True, "catalogReady": True, "errors": [], "warnings": []},
    )
    assert result["status"] == "degraded"
    assert result["failedConnections"] == ["broken"]


def test_failed_ingest_without_catalog_fails(tmp_path: Path) -> None:
    result, _ = run_startup(
        tmp_path,
        [{
            "jobId": "job-1",
            "phase": "failed",
            "currentConnectionId": None,
            "completedConnections": 1,
            "totalConnections": 1,
            "summary": {"updated": 0, "unchanged": 0, "failed": 1, "skipped": 0},
            "results": [{"connectionId": "warehouse", "status": "failed"}],
            "catalogReady": False,
        }],
        {"valid": False, "catalogReady": False, "errors": ["not ready"], "warnings": []},
    )
    assert result["status"] == "failed"
    assert result["errorCode"] == "semantic_catalog_not_ready"


def test_semantic_agent_bridge_exposes_only_query_tools() -> None:
    manager = MCPManager()
    server = _ManagedServer(MCPServerConfig(name="semantic", server_type="semantic", tool_prefix="semantic_"))
    server._tools = [
        {"name": "sl_ingest", "description": "mutating"},
        {"name": "sl_ingest_status", "description": "host status"},
        {"name": "sl_validate", "description": "host validation"},
        {"name": "sl_discover", "description": "discover"},
        {"name": "sl_read_source", "description": "read"},
        {"name": "sl_query", "description": "query"},
    ]
    manager._servers["semantic"] = server

    tools = manager.bridge_tools()

    assert [tool.name for tool in tools] == [
        "semantic_sl_discover",
        "semantic_sl_read_source",
        "semantic_sl_query",
    ]


def test_config_manager_injects_one_host_owned_semantic_server(tmp_path: Path, monkeypatch: Any) -> None:
    from src.config_manager import ConfigManager

    manager = ConfigManager()
    previous_project_dir = manager.semantic_project_dir
    project = configured_project(tmp_path)
    manager.configure_semantic_project_dir(project)
    monkeypatch.setenv("DATA_AGENT_NODE_COMMAND", "node")
    monkeypatch.delenv("DATA_AGENT_KTX_SEMANTIC_RUNTIME_DIR", raising=False)
    try:
        settings = manager._with_bundled_semantic_server(MCPSettings(servers=[
            MCPServerConfig(name="semantic", server_type="service"),
            MCPServerConfig(name="database", server_type="database"),
        ]))
        assert [server.name for server in settings.servers] == ["database", "semantic"]
        semantic = settings.get_server("semantic")
        assert semantic is not None
        assert semantic.server_type == "semantic"
        assert semantic.env["KTX_PROJECT_DIR"] == str(project)
        assert all(
            key in {"KTX_PROJECT_DIR", "PYTHONUTF8"}
            or key.startswith("DATA_AGENT_CONNECTION_")
            or key.startswith("DATA_AGENT_KTX_LLM_")
            for key in semantic.env
        )
    finally:
        manager.configure_semantic_project_dir(previous_project_dir)


def test_config_manager_lists_host_owned_semantic_server_when_unconfigured(tmp_path: Path, monkeypatch: Any) -> None:
    from src.config_manager import ConfigManager

    manager = ConfigManager()
    previous_project_dir = manager.semantic_project_dir
    manager.configure_semantic_project_dir(tmp_path / "missing-semantic-context")
    monkeypatch.setenv("DATA_AGENT_NODE_COMMAND", "node")
    monkeypatch.delenv("DATA_AGENT_KTX_SEMANTIC_RUNTIME_DIR", raising=False)
    try:
        settings = manager._with_bundled_semantic_server(MCPSettings(servers=[]))
        semantic = settings.get_server("semantic")
        assert semantic is not None
        assert semantic.server_type == "semantic"
        assert semantic.enabled is False
        assert "configure ktx.yaml" in semantic.description
    finally:
        manager.configure_semantic_project_dir(previous_project_dir)


def test_reconnect_restarts_semantic_startup_coordination(tmp_path: Path) -> None:
    async def scenario() -> tuple[dict[str, Any], FakeSemanticServer, FakeSemanticServer]:
        first = FakeSemanticServer(
            [{
                "jobId": "job-1",
                "phase": "completed",
                "currentConnectionId": None,
                "completedConnections": 1,
                "totalConnections": 1,
                "summary": {"updated": 1, "unchanged": 0, "failed": 0, "skipped": 0},
                "results": [{"connectionId": "warehouse", "status": "completed"}],
                "catalogReady": True,
            }],
            {"valid": True, "catalogReady": True, "errors": [], "warnings": []},
        )
        second = FakeSemanticServer(
            [{
                "jobId": "job-2",
                "phase": "completed",
                "currentConnectionId": None,
                "completedConnections": 1,
                "totalConnections": 1,
                "summary": {"updated": 0, "unchanged": 1, "failed": 0, "skipped": 0},
                "results": [{"connectionId": "warehouse", "status": "completed"}],
                "catalogReady": True,
            }],
            {"valid": True, "catalogReady": True, "errors": [], "warnings": []},
            job_id="job-2",
        )

        class ReconnectingManager(FakeManager):
            def __init__(self) -> None:
                super().__init__(first)

        manager = ReconnectingManager()
        service = SemanticStartupService(manager)
        service.configure(configured_project(tmp_path))
        await service.start()
        assert service._task is not None
        await service._task
        await asyncio.sleep(0.6)
        manager.server = second
        for _ in range(20):
            if any(name == "sl_ingest" for name, _ in second.calls):
                break
            await asyncio.sleep(0.1)
        assert service._task is not None
        await service._task
        result = service.status()
        await service.stop()
        return result, first, second

    result, first, second = asyncio.run(scenario())
    assert result["status"] == "ready"
    assert result["jobId"] == "job-2"
    assert [name for name, _ in first.calls] == ["sl_ingest", "sl_ingest_status", "sl_validate"]
    assert [name for name, _ in second.calls] == ["sl_ingest", "sl_ingest_status", "sl_validate"]
