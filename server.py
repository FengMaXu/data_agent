"""HTTP API service entrypoint."""

from __future__ import annotations

import argparse
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api.agent import router as agent_router
from src.api.knowledge_api import router as knowledge_router
from src.api.mcp import router as mcp_router
from src.api.settings import router as settings_router
from src.api.workspace_api import router as workspace_router
from src.app_runtime import app_runtime

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8080

logger = logging.getLogger("data_agent.server")


def configure_logging(log_dir: str | None = None) -> Path | None:
    """Configure process logging and return the active log file path, if any."""
    target_dir_value = log_dir or os.getenv("DATA_AGENT_LOG_DIR")
    handlers: list[logging.Handler] = [logging.StreamHandler()]
    log_path: Path | None = None

    if target_dir_value:
        target_dir = Path(target_dir_value).expanduser()
        target_dir.mkdir(parents=True, exist_ok=True)
        log_path = target_dir / "data_agent.log"
        handlers.insert(0, logging.FileHandler(log_path, encoding="utf-8"))

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        handlers=handlers,
        force=True,
    )
    return log_path


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the Data Agent HTTP API.")
    parser.add_argument(
        "--host",
        default=os.getenv("HOST", DEFAULT_HOST),
        help=f"Bind host. Defaults to {DEFAULT_HOST}.",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=None,
        help="Bind port. Overrides PORT when provided.",
    )
    parser.add_argument(
        "--log-dir",
        default=None,
        help="Directory for data_agent.log, usually Electron app.getPath('userData').",
    )
    return parser.parse_args(argv)


configure_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("============== server startup ==============")
    async with app_runtime():
        yield
    logger.info("============== server shutdown ==============")


app = FastAPI(
    title="Data Agent API",
    description="Enterprise Data Agent backend API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(agent_router)
app.include_router(settings_router)
app.include_router(settings_router, prefix="/api")
app.include_router(workspace_router)
app.include_router(knowledge_router)
app.include_router(mcp_router)


@app.get("/health")
async def health_check():
    return {"status": "ok"}


if __name__ == "__main__":
    args = parse_args()
    log_path = configure_logging(args.log_dir)
    port = args.port or int(os.getenv("PORT", str(DEFAULT_PORT)))
    logger.info("Starting API on %s:%s; log=%s", args.host, port, log_path or "stream-only")
    uvicorn.run(
        app,
        host=args.host,
        port=port,
        log_config=None,
        reload=False,
    )
