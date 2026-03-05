"""
企业级数据智能体 - HTTP API 服务主入口
"""

import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.config_manager import config_manager
from src.api.agent import router as agent_router
from src.api.settings import router as settings_router

# 设置日志格式
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    handlers=[
        logging.FileHandler("data_agent.log", encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger("data_agent.server")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时初始化
    logger.info("============== 服务器启动 =============")
    await config_manager.startup()
    yield
    # 关闭时清理
    logger.info("============== 服务器关闭 =============")
    await config_manager.shutdown()


app = FastAPI(
    title="Data Agent API",
    description="企业级数据智能体后端接口",
    version="0.1.0",
    lifespan=lifespan,
)

# 允许前端跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(agent_router)
app.include_router(settings_router)


@app.get("/health")
async def health_check():
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
