"""HTTP API service entrypoint."""

from __future__ import annotations

import argparse
import logging
import os
import runpy
import sys
import traceback
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api.agent import router as agent_router
from src.api.dashboard_runtime import router as dashboard_runtime_router
from src.api.auth import router as auth_router
from src.api.knowledge_api import router as knowledge_router
from src.api.mcp import router as mcp_router
from src.api.sessions import router as sessions_router
from src.api.semantic_api import router as semantic_router
from src.api.settings import router as settings_router
from src.api.startup import router as startup_router
from src.api.tasks import router as tasks_router
from src.api.workspace_api import router as workspace_router
from src.app_runtime import app_runtime
from src.auth.service import get_user_by_token

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
    parser.add_argument(
        "--data-agent-run-python-script",
        default=None,
        help=argparse.SUPPRESS,
    )
    parser.add_argument(
        "--semantic-project-dir",
        default=None,
        help="Writable ktx semantic project directory.",
    )
    return parser.parse_args(argv)


def run_python_script(script_path: str) -> int:
    """Run a workspace script from the packaged backend executable."""
    try:
        sys.argv = [script_path]
        runpy.run_path(script_path, run_name="__main__")
        return 0
    except SystemExit as exc:
        code = exc.code
        if code is None:
            return 0
        if isinstance(code, int):
            return code
        print(code, file=sys.stderr)
        return 1
    except Exception:
        traceback.print_exc()
        return 1


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


@app.middleware("http")
async def authenticate_request(request, call_next):
    if request.method == "OPTIONS":
        return await call_next(request)

    public_paths = ("/auth", "/health", "/docs", "/redoc", "/openapi.json")
    if request.url.path.startswith(public_paths):
        return await call_next(request)

    auth_header = request.headers.get("authorization", "")
    token = auth_header[7:].strip() if auth_header.lower().startswith("bearer ") else ""
    if not token:
        token = request.query_params.get("access_token", "")
    user = get_user_by_token(token)
    if user is None:
        from fastapi.responses import JSONResponse

        return JSONResponse({"detail": "Authentication required"}, status_code=401)

    request.state.current_user = user
    return await call_next(request)


app.include_router(auth_router)
app.include_router(tasks_router)
app.include_router(sessions_router)
app.include_router(agent_router)
app.include_router(dashboard_runtime_router)
app.include_router(settings_router)
app.include_router(settings_router, prefix="/api")
app.include_router(workspace_router)
app.include_router(knowledge_router)
app.include_router(mcp_router)
app.include_router(semantic_router)
app.include_router(startup_router)


@app.get("/health")
async def health_check():
    return {"status": "ok"}


if __name__ == "__main__":
    args = parse_args()
    if args.data_agent_run_python_script:
        raise SystemExit(run_python_script(args.data_agent_run_python_script))

    if args.semantic_project_dir:
        os.environ["DATA_AGENT_SEMANTIC_PROJECT_DIR"] = args.semantic_project_dir
        from src.config_manager import config_manager

        config_manager.configure_semantic_project_dir(args.semantic_project_dir)

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
