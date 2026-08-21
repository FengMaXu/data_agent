from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from src.semantic_startup import semantic_startup

router = APIRouter(prefix="/startup", tags=["startup"])


@router.get("/status")
async def get_startup_status() -> dict[str, Any]:
    return semantic_startup.status()


@router.post("/semantic-ingest/retry")
async def retry_semantic_ingest() -> dict[str, Any]:
    return await semantic_startup.retry()
