from __future__ import annotations

import logging
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel

from src.config_manager import config_manager

logger = logging.getLogger("data_agent.api.settings")

router = APIRouter(prefix="/settings", tags=["settings"])


class LLMConfigRequest(BaseModel):
    provider: Literal["openai", "anthropic"] | None = None
    api_key: str | None = None
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None
    base_url: str | None = None
    openai_base_url: str | None = None
    model: str | None = None


class DBConfigRequest(BaseModel):
    host: str | None = None
    port: int | None = None
    user: str | None = None
    password: str | None = None
    database: str | None = None


@router.get("/config")
async def get_config() -> dict[str, Any]:
    return config_manager.get_config()


@router.post("/llm")
async def update_llm_config(req: LLMConfigRequest):
    data = req.model_dump(exclude_unset=True)
    await config_manager.update_llm_config(data)
    return {"status": "success", "message": "LLM config updated and gateway rebuilt"}


@router.post("/llm/test")
async def test_llm_config(req: LLMConfigRequest):
    data = req.model_dump(exclude_unset=True)
    return await config_manager.test_llm_config(data)


@router.post("/database")
async def update_db_config(req: DBConfigRequest):
    data = req.model_dump(exclude_unset=True)
    try:
        await config_manager.update_db_config(data)
        return {"status": "success", "message": "Database config updated and MCP restarted"}
    except Exception as e:
        logger.error("Failed to reload database MCP config: %s", e)
        return {"status": "error", "message": str(e)}


@router.post("/database/test")
async def test_db_connection(req: DBConfigRequest):
    data = req.model_dump(exclude_unset=True)
    return await config_manager.test_db_connection(data)
