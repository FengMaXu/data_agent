import logging
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from src.config_manager import config_manager

logger = logging.getLogger("data_agent.api.settings")

router = APIRouter(prefix="/settings", tags=["settings"])


class LLMConfigRequest(BaseModel):
    api_key: str | None = None
    base_url: str | None = None
    model: str | None = None


class DBConfigRequest(BaseModel):
    host: str | None = None
    port: int | None = None
    user: str | None = None
    password: str | None = None
    database: str | None = None


@router.get("/config")
async def get_config() -> dict[str, Any]:
    """获取当前配置"""
    return config_manager.get_config()


@router.post("/llm")
async def update_llm_config(req: LLMConfigRequest):
    """热更新 LLM 配置"""
    data = req.model_dump(exclude_unset=True)
    await config_manager.update_llm_config(data)
    return {"status": "success", "message": "LLM 配置已更新并重建 Gateway"}


@router.post("/database")
async def update_db_config(req: DBConfigRequest):
    """热更新数据库配置并重连 MCP"""
    data = req.model_dump(exclude_unset=True)
    try:
        await config_manager.update_db_config(data)
        return {"status": "success", "message": "数据库配置已更新并重建连接/工具"}
    except Exception as e:
        logger.error(f"重连数据库 MCP 失败: {e}")
        return {"status": "error", "message": str(e)}


@router.post("/database/test")
async def test_db_connection(req: DBConfigRequest):
    """测试数据库连接但不保存"""
    data = req.model_dump(exclude_unset=True)
    result = await config_manager.test_db_connection(data)
    return result
