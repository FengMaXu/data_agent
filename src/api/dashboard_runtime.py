from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from src.auth.service import ensure_local_user
from src.dashboard_runtime.semantic_contract import (
    SemanticDashboardValidationError,
    compile_semantic_dashboard,
)
from src.dashboard_runtime.semantic_document import extract_semantic_dashboard_document
from src.dashboard_runtime.semantic_evaluator import (
    EVALUATE_TIMEOUT_SECONDS,
    SemanticDashboardEvaluationError,
    evaluate_semantic_dashboard,
    load_semantic_catalog,
)
from src.persistence import chat_store
from src.api.workspace_api import WORKSPACE_ROOT

logger = logging.getLogger("data_agent.api.dashboard_runtime")
router = APIRouter(prefix="/dashboard-runtime", tags=["dashboard-runtime"])


class DashboardEvaluateRequest(BaseModel):
    requestId: str = Field(min_length=1, max_length=128)
    dashboard: str = Field(min_length=1, max_length=600)
    parameters: dict[str, Any] = Field(default_factory=dict)
    changed: list[str] | None = None


@router.post("/evaluate")
async def evaluate_dashboard_runtime(
    payload: DashboardEvaluateRequest,
    request: Request,
) -> dict[str, Any]:
    """Evaluate a V4 dashboard document owned by the authenticated user."""
    dashboard_path = _owned_dashboard_path(request, payload.dashboard)
    try:
        if dashboard_path.stat().st_size > 10 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Dashboard file is too large")
        html = dashboard_path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Dashboard file not found") from exc
    except OSError as exc:
        raise HTTPException(status_code=403, detail="Dashboard file cannot be read") from exc

    try:
        spec = extract_semantic_dashboard_document(html)
        source_names = {
            str(node.get("source"))
            for node in spec.get("data", {}).values()
            if isinstance(node, dict) and node.get("source")
        }
        async def run_runtime() -> dict[str, Any]:
            catalog = await load_semantic_catalog(spec["connection"], source_names)
            compiled = compile_semantic_dashboard(spec, catalog)
            return await evaluate_semantic_dashboard(
                compiled,
                payload.parameters,
                payload.changed,
                request_id=payload.requestId,
                initial=False,
            )

        return await asyncio.wait_for(run_runtime(), timeout=EVALUATE_TIMEOUT_SECONDS)
    except asyncio.TimeoutError as exc:
        raise HTTPException(status_code=504, detail={"code": "evaluate_timeout", "message": "Dashboard evaluation timed out"}) from exc
    except SemanticDashboardValidationError as exc:
        raise HTTPException(status_code=400, detail={"status": "invalid_spec", "errors": exc.errors}) from exc
    except SemanticDashboardEvaluationError as exc:
        raise HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": exc.message}) from exc
    except Exception as exc:
        logger.exception("dashboard runtime evaluation failed")
        raise HTTPException(status_code=502, detail={"code": "dashboard_runtime_failed", "message": "Dashboard runtime evaluation failed"}) from exc


def _owned_dashboard_path(request: Request, dashboard: str) -> Path:
    value = str(dashboard or "").strip()
    if not value or "\\" in value or value.startswith("/") or Path(value).is_absolute():
        raise HTTPException(status_code=400, detail="Invalid dashboard path")
    parts = Path(value).parts
    if len(parts) < 2 or parts[0] in {".", ".."} or any(part in {"", ".", ".."} for part in parts):
        raise HTTPException(status_code=400, detail="Dashboard path must include an owned session")
    session_id = parts[0]
    if Path(session_id).name != session_id:
        raise HTTPException(status_code=400, detail="Invalid dashboard session")
    user_id = _request_user_id(request)
    if chat_store.get_session(user_id, session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")
    relative = Path(*parts)
    if relative.suffix.lower() not in {".html", ".htm"} or "dashboards" not in parts[1:-1]:
        raise HTTPException(status_code=400, detail="Dashboard path must point to a dashboards HTML file")
    root = Path(os.getenv("DATA_AGENT_WORKSPACE_ROOT") or WORKSPACE_ROOT).resolve()
    resolved = (root / relative).resolve()
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail="Dashboard path escapes workspace") from exc
    return resolved


def _request_user_id(request: Request) -> str:
    user = getattr(getattr(request, "state", None), "current_user", None)
    if user is not None:
        return str(user.id)
    return ensure_local_user().id
