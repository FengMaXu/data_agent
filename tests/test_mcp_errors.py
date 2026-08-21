import asyncio

from src.mcp.config_models import MCPServerConfig
from src.mcp.mcp_client import format_mcp_error
from src.mcp.registry import MCPRegistry


def test_format_mcp_error_unwraps_task_group():
    error = ExceptionGroup(
        "unhandled errors in a TaskGroup",
        [ExceptionGroup("connection", [ConnectionError("refused")])],
    )

    assert format_mcp_error(error) == "ConnectionError: refused"


def test_format_mcp_error_keeps_distinct_task_group_errors():
    error = ExceptionGroup(
        "unhandled errors in a TaskGroup",
        [TimeoutError("timed out"), ConnectionError("refused")],
    )

    assert format_mcp_error(error) == "TimeoutError: timed out; ConnectionError: refused"


def test_registry_test_server_returns_unwrapped_error(monkeypatch):
    async def fail_connect(_registry):
        raise ExceptionGroup("unhandled errors in a TaskGroup", [ConnectionError("refused")])

    monkeypatch.setattr(MCPRegistry, "connect_all_enabled", fail_connect)

    result = asyncio.run(MCPRegistry().test_server(MCPServerConfig(name="demo")))

    assert result == {"success": False, "message": "ConnectionError: refused"}