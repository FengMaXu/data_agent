from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from src.mcp.manager import MCPManager, mcp_manager

logger = logging.getLogger("data_agent.semantic_startup")

SEMANTIC_SERVER_TYPE = "semantic"
VISIBLE_SEMANTIC_TOOLS = {"sl_discover", "sl_read_source", "sl_query"}
SEMANTIC_RECONNECT_POLL_SECONDS = 0.25
SEMANTIC_INGEST_POLL_SECONDS = 1.0
SEMANTIC_INGEST_TIMEOUT_SECONDS = 30 * 60


def _empty_summary() -> dict[str, int]:
    return {"updated": 0, "unchanged": 0, "failed": 0, "skipped": 0}


class SemanticStartupService:
    """Coordinates the single host-owned semantic MCP ingest job."""

    def __init__(self, manager: MCPManager = mcp_manager) -> None:
        self._manager = manager
        self._project_dir: Path | None = None
        self._state: dict[str, Any] = {
            "status": "checking",
            "jobId": None,
            "currentConnectionId": None,
            "completedConnections": 0,
            "totalConnections": 0,
            "summary": _empty_summary(),
            "failedConnections": [],
            "errorCode": None,
            "updatedAt": None,
        }
        self._task: asyncio.Task[None] | None = None
        self._monitor_task: asyncio.Task[None] | None = None
        self._lock = asyncio.Lock()

    def configure(self, project_dir: Path | str) -> None:
        self._project_dir = Path(project_dir).expanduser().resolve()

    def reset_for_tests(self) -> None:
        """Reset in-memory state for isolated host/API tests."""
        self._task = None
        self._monitor_task = None
        self._state = {
            "status": "checking",
            "jobId": None,
            "currentConnectionId": None,
            "completedConnections": 0,
            "totalConnections": 0,
            "summary": _empty_summary(),
            "failedConnections": [],
            "errorCode": None,
            "updatedAt": None,
        }

    def status(self) -> dict[str, Any]:
        return {
            **self._state,
            "summary": dict(self._state["summary"]),
            "failedConnections": list(self._state["failedConnections"]),
        }

    async def start(self) -> dict[str, Any]:
        return await self._schedule(force=False)

    async def retry(self) -> dict[str, Any]:
        return await self._schedule(force=True)

    async def _schedule(self, *, force: bool) -> dict[str, Any]:
        async with self._lock:
            if self._task is not None and not self._task.done():
                return self.status()

            if self._project_dir is None or not (self._project_dir / "ktx.yaml").is_file():
                self._set_state(status="skipped", errorCode="semantic_configuration_missing")
                return self.status()

            if self._manager.find_server_by_type(SEMANTIC_SERVER_TYPE) is None:
                self._set_state(status="failed", errorCode="semantic_mcp_unavailable")
                return self.status()

            self._set_state(
                status="checking",
                jobId=None,
                currentConnectionId=None,
                completedConnections=0,
                totalConnections=0,
                summary=_empty_summary(),
                failedConnections=[],
                errorCode=None,
            )
            self._task = asyncio.create_task(self._run(force=force), name="semantic-startup-ingest")
            self._ensure_reconnect_monitor()
            return self.status()

    async def stop(self) -> None:
        async with self._lock:
            task = self._task
            self._task = None
            monitor = self._monitor_task
            self._monitor_task = None
            if task is None or task.done():
                task = None
            else:
                task.cancel()
            if monitor is not None and not monitor.done():
                monitor.cancel()
        for pending in (task, monitor):
            if pending is None:
                continue
            try:
                await pending
            except asyncio.CancelledError:
                pass

    def _ensure_reconnect_monitor(self) -> None:
        if self._monitor_task is None or self._monitor_task.done():
            self._monitor_task = asyncio.create_task(
                self._watch_semantic_connection(),
                name="semantic-startup-reconnect-monitor",
            )

    async def _watch_semantic_connection(self) -> None:
        previous_server: Any | None = None
        previous_connected = False
        previous_generation = 0
        while True:
            await asyncio.sleep(SEMANTIC_RECONNECT_POLL_SECONDS)
            server = self._manager.find_server_by_type(SEMANTIC_SERVER_TYPE)
            status_fn = getattr(server, "status", None) if server is not None else None
            if not callable(status_fn):
                return
            snapshot = status_fn()
            connected = bool(snapshot.get("connected"))
            generation = self._safe_int(snapshot.get("generation"))
            server_changed = previous_server is not None and server is not previous_server
            disconnected = previous_connected and not connected
            reconnected = connected and previous_server is not None and (
                disconnected or server_changed or generation != previous_generation
            )
            if disconnected:
                self._set_state(
                    status="checking",
                    currentConnectionId=None,
                    errorCode="semantic_mcp_reconnecting",
                )
            if reconnected:
                await self.start()
            previous_server = server
            previous_connected = connected
            previous_generation = generation

    async def _run(self, *, force: bool = False) -> None:
        server = self._manager.find_server_by_type(SEMANTIC_SERVER_TYPE)
        if server is None:
            self._set_state(status="failed", errorCode="semantic_mcp_unavailable")
            return

        catalog_ready_at_start = False
        try:
            catalog_ready_at_start = await self._existing_catalog_is_ready(server)
            if catalog_ready_at_start and not force:
                self._set_state(status="ready", errorCode=None)
                return
            self._set_state(status="refreshing" if catalog_ready_at_start else "ingesting")
            ingest_response = self._parse_json(await server.call_tool("sl_ingest", {}))
            if "error" in ingest_response:
                self._set_state(
                    status="degraded" if catalog_ready_at_start else "failed",
                    errorCode="semantic_ingest_start_failed",
                )
                return
            job_id = self._safe_string(ingest_response.get("jobId"))
            if not job_id:
                self._set_state(status="failed", errorCode="semantic_ingest_protocol_error")
                return
            self._set_state(jobId=job_id)

            final_status: dict[str, Any] | None = None
            deadline = asyncio.get_running_loop().time() + SEMANTIC_INGEST_TIMEOUT_SECONDS
            while asyncio.get_running_loop().time() < deadline:
                snapshot = self._parse_json(await server.call_tool("sl_ingest_status", {"jobId": job_id}))
                if "error" in snapshot:
                    self._set_state(status="failed", errorCode="semantic_ingest_status_failed")
                    return
                self._apply_ingest_snapshot(snapshot)
                phase = self._safe_string(snapshot.get("phase"))
                if phase in {"completed", "partial", "failed"}:
                    final_status = snapshot
                    break
                await asyncio.sleep(SEMANTIC_INGEST_POLL_SECONDS)

            if final_status is None:
                self._set_state(
                    status="degraded" if catalog_ready_at_start else "failed",
                    errorCode="semantic_ingest_timeout",
                )
                return

            validation = self._parse_json(await server.call_tool("sl_validate", {}))
            if "error" in validation:
                self._set_state(status="failed", errorCode="semantic_validation_failed")
                return

            catalog_ready = bool(validation.get("catalogReady"))
            phase = self._safe_string(final_status.get("phase"))
            if phase == "completed" and catalog_ready:
                product_status = "ready"
            elif catalog_ready and phase in {"partial", "failed"}:
                product_status = "degraded"
            else:
                product_status = "failed"

            self._set_state(
                status=product_status,
                currentConnectionId=None,
                errorCode=None if product_status in {"ready", "degraded"} else "semantic_catalog_not_ready",
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("Semantic startup coordination failed: %s", type(exc).__name__)
            self._set_state(
                status="degraded" if catalog_ready_at_start else "failed",
                errorCode="semantic_startup_failed",
            )

    async def _existing_catalog_is_ready(self, server: Any) -> bool:
        if self._project_dir is None:
            return False
        catalog_dir = self._project_dir / "semantic-layer"
        if not catalog_dir.is_dir() or not any(catalog_dir.rglob("*.yaml")):
            return False
        try:
            validation = self._parse_json(await server.call_tool("sl_validate", {}))
        except Exception:
            return False
        return "error" not in validation and bool(validation.get("catalogReady"))

    def _apply_ingest_snapshot(self, snapshot: dict[str, Any]) -> None:
        results = snapshot.get("results")
        failed_connections = []
        if isinstance(results, list):
            for item in results:
                if not isinstance(item, dict):
                    continue
                if item.get("status") in {"failed", "partial"}:
                    connection_id = self._safe_string(item.get("connectionId"))
                    if connection_id:
                        failed_connections.append(connection_id)

        summary = self._safe_summary(snapshot.get("summary"))
        self._set_state(
            currentConnectionId=self._safe_string(snapshot.get("currentConnectionId")),
            completedConnections=self._safe_int(snapshot.get("completedConnections")),
            totalConnections=self._safe_int(snapshot.get("totalConnections")),
            summary=summary,
            failedConnections=sorted(set(failed_connections)),
        )

    def _set_state(self, **changes: Any) -> None:
        changes["updatedAt"] = datetime.now(timezone.utc).isoformat()
        self._state.update(changes)

    @staticmethod
    def _parse_json(raw: str) -> dict[str, Any]:
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise ValueError("semantic MCP returned a non-object response")
        return value

    @staticmethod
    def _safe_string(value: Any) -> str | None:
        return value if isinstance(value, str) and value.strip() else None

    @staticmethod
    def _safe_int(value: Any) -> int:
        return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0

    @classmethod
    def _safe_summary(cls, value: Any) -> dict[str, int]:
        if not isinstance(value, dict):
            return _empty_summary()
        return {key: cls._safe_int(value.get(key)) for key in _empty_summary()}


semantic_startup = SemanticStartupService()
