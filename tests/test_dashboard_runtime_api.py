from __future__ import annotations

import json
from pathlib import Path

import pytest
from starlette.requests import Request

from src.api import dashboard_runtime
from src.dashboard_runtime.semantic_document import json_script_payload
from src.dashboard_runtime.semantic_evaluator import SemanticDashboardEvaluationError
from src.auth.service import AuthenticatedUser


def _request() -> Request:
    request = Request({
        "type": "http",
        "method": "POST",
        "path": "/dashboard-runtime/evaluate",
        "headers": [],
        "query_string": b"",
        "client": ("test", 1),
        "server": ("test", 80),
        "scheme": "http",
    })
    request.state.current_user = AuthenticatedUser("user-1", "tester", "Tester")
    return request


def _document() -> dict:
    return {
        "version": "4",
        "title": "API",
        "connection": "default-mysql",
        "parameters": {
            "industry": {"type": "select", "default": None, "options": {"data": "options", "field": "industry"}}
        },
        "data": {
            "options": {
                "source": "sales_model",
                "dimensions": {"industry": "industry"},
                "measures": {"value": "sales"},
                "limit": 10,
            },
            "trend": {
                "source": "sales_model",
                "dimensions": {"industry": "industry"},
                "measures": {"sales": "sales"},
                "where": [{"field": "industry", "operator": "eq", "value": {"$param": "industry"}}],
                "limit": 10,
            },
        },
        "views": [
            {
                "id": "trend_view",
                "type": "table",
                "data": "trend",
                "columns": [{"field": "industry", "label": "Industry"}, {"field": "sales", "label": "Sales"}],
            }
        ],
        "interactions": [],
        "layout": {},
    }


@pytest.mark.asyncio
async def test_dashboard_runtime_api_reextracts_owned_document(monkeypatch, tmp_path: Path):
    session_dir = tmp_path / "session-1" / "dashboards"
    session_dir.mkdir(parents=True)
    document = _document()
    (session_dir / "api.html").write_text(
        '<script id="dashboard-document" type="application/json">'
        + json_script_payload(document)
        + "</script>",
        encoding="utf-8",
    )
    monkeypatch.setattr(dashboard_runtime, "WORKSPACE_ROOT", tmp_path)
    monkeypatch.setattr(dashboard_runtime.chat_store, "get_session", lambda _user, session: object() if session == "session-1" else None)
    monkeypatch.setattr(
        dashboard_runtime,
        "load_semantic_catalog",
        lambda connection, source_names: _catalog_async(connection, source_names),
    )
    monkeypatch.setattr(dashboard_runtime, "evaluate_semantic_dashboard", _fake_evaluate)

    payload = dashboard_runtime.DashboardEvaluateRequest(
        requestId="r-1",
        dashboard="session-1/dashboards/api.html",
        parameters={"industry": None},
        changed=None,
    )
    response = await dashboard_runtime.evaluate_dashboard_runtime(payload, _request())

    assert response["requestId"] == "r-1"
    assert response["data"]["trend"]["rows"] == []


@pytest.mark.asyncio
async def test_dashboard_runtime_api_rejects_unowned_path(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(dashboard_runtime, "WORKSPACE_ROOT", tmp_path)
    monkeypatch.setattr(dashboard_runtime.chat_store, "get_session", lambda _user, _session: None)
    payload = dashboard_runtime.DashboardEvaluateRequest(
        requestId="r-1",
        dashboard="other-session/dashboards/api.html",
        parameters={},
        changed=None,
    )
    with pytest.raises(Exception) as caught:
        await dashboard_runtime.evaluate_dashboard_runtime(payload, _request())
    assert getattr(caught.value, "status_code", None) == 404


async def _catalog_async(_connection, _source_names):
    from src.dashboard_runtime.semantic_contract import SemanticSourceCatalog
    return {"sales_model": SemanticSourceCatalog("sales_model", frozenset({"industry"}), frozenset({"sales"}), {"industry": "string", "sales": "number"})}


async def _fake_evaluate(compiled, parameters, changed, *, request_id, initial):
    return {"requestId": request_id, "parameters": parameters, "data": {"trend": {"rows": [], "totalRows": 0}}, "errors": {}}
