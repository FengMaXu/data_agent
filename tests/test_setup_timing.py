import asyncio
import logging
from pathlib import Path
from types import SimpleNamespace

from src.agent.tool_assembly import ToolAssemblyService
from src.agent.tool_providers.base import GlobalRuntimeServices, ToolProvider
from src.agent.types import AgentTimingRecorder
from src.mcp.config_models import MCPServerConfig, MCPSettings
from src.mcp.registry import MCPRegistry


class DummyProvider(ToolProvider):
    def __init__(self, name: str):
        self.name = name

    async def build_tools(self, context):
        await asyncio.sleep(0)
        return []


def test_tool_assembly_logs_provider_timing(tmp_path: Path, monkeypatch, caplog):
    service = ToolAssemblyService(tmp_path, providers=[DummyProvider("one")])
    timing = AgentTimingRecorder(req="run_setup", session="session_setup")

    with caplog.at_level(logging.INFO):
        asyncio.run(
            service.build_session_tools(
                session_id="s1",
                workspace=SimpleNamespace(),
                global_services=GlobalRuntimeServices(),
                timing=timing,
            )
        )

    assert any("provider_build_tools" in record.message for record in caplog.records)


def test_mcp_registry_logs_connect_and_list_tools(monkeypatch, caplog):
    timing = AgentTimingRecorder(req="run_mcp", session="session_mcp")
    registry = MCPRegistry(timing=timing)
    registry.configure(
        MCPSettings(
            servers=[
                MCPServerConfig(
                    name="mysql",
                    command="python",
                    script="server.py",
                )
            ]
        )
    )

    class FakeClient:
        async def list_tools(self):
            await asyncio.sleep(0)
            return [{"name": "list_tables", "description": "", "parameters": {}}]

    class FakeContextManager:
        async def __aenter__(self):
            return FakeClient()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(registry, "_create_client_context", lambda server: FakeContextManager())

    with caplog.at_level(logging.INFO):
        asyncio.run(registry.connect_all_enabled())

    assert any("[Timing][MCP]" in record.message and "connect_done" in record.message for record in caplog.records)
    assert any("[Timing][MCP]" in record.message and "list_tools_done" in record.message for record in caplog.records)
    assert any(stage["stage"] == "connect_total_done" for stage in timing.mcp_stages)
