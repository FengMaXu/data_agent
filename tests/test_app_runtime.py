import asyncio
from types import SimpleNamespace

from src.app_runtime import app_runtime, get_enabled_mcp_server_names


class DummyManager:
    def __init__(self):
        self.ai_config = None
        self.events = []

    async def startup(self):
        self.events.append("startup")

    async def shutdown(self):
        self.events.append("shutdown")

    def get_mcp_settings(self):
        return SimpleNamespace(
            servers=[
                SimpleNamespace(name="database", enabled=True),
                SimpleNamespace(name="qcc", enabled=False),
                SimpleNamespace(name="risk", enabled=True),
            ]
        )


def test_app_runtime_starts_and_stops_manager():
    manager = DummyManager()
    config = SimpleNamespace(name="cfg")

    async def run():
        async with app_runtime(config, manager):
            manager.events.append("inside")
            assert manager.ai_config is config

    asyncio.run(run())

    assert manager.events == ["startup", "inside", "shutdown"]


def test_app_runtime_stops_manager_on_error():
    manager = DummyManager()

    async def run():
        async with app_runtime(manager=manager):
            raise RuntimeError("boom")

    try:
        asyncio.run(run())
    except RuntimeError:
        pass

    assert manager.events == ["startup", "shutdown"]


def test_get_enabled_mcp_server_names_filters_disabled_servers():
    manager = DummyManager()

    assert get_enabled_mcp_server_names(manager) == ["database", "risk"]
