from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from src.ai.config import AIConfig
from src.config_manager import ConfigManager, config_manager

logger = logging.getLogger("data_agent.app_runtime")


@asynccontextmanager
async def app_runtime(
    config: AIConfig | None = None,
    manager: ConfigManager = config_manager,
) -> AsyncIterator[ConfigManager]:
    """
    Shared application runtime lifecycle for CLI and HTTP entrypoints.
    """
    if config is not None:
        manager.ai_config = config

    logger.info("[AppRuntime] startup")
    await manager.startup()
    try:
        yield manager
    finally:
        logger.info("[AppRuntime] shutdown")
        await manager.shutdown()


def get_enabled_mcp_server_names(
    manager: ConfigManager = config_manager,
) -> list[str]:
    return [
        server.name
        for server in manager.get_mcp_settings().servers
        if server.enabled
    ]
