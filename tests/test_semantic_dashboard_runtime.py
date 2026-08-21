from __future__ import annotations

import asyncio
import json
import re
import shutil
import subprocess

import pytest

from src.dashboard_runtime.semantic_contract import (
    SemanticDashboardValidationError,
    SemanticSourceCatalog,
    compile_semantic_dashboard,
)
from src.dashboard_runtime.semantic_document import extract_semantic_dashboard_document
from src.dashboard_runtime.semantic_evaluator import evaluate_semantic_dashboard
from src.dashboard_runtime.semantic_renderer import render_semantic_dashboard_html


class FakeSemanticExecutor:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    async def call_sl_query(self, arguments: dict) -> dict:
        self.calls.append(arguments)
        source = arguments["measures"][0].split(".")[0]
        if source == "sales_model" and arguments.get("dimensions") == ["sales_model.industry_name"]:
            return {"headers": ["industry_name", "sales"], "rows": [["Retail", "10.5"], ["Wholesale", "7"]], "totalRows": 2}
        if source == "sales_model" and len(arguments.get("dimensions", [])) == 1:
            return {"headers": ["month_month", "sales"], "rows": [["2026-01-31T16:00:00.000Z", "10.5"]], "totalRows": 1}
        return {"headers": ["month_month", "industry_name", "sales"], "rows": [["2026-01-31T16:00:00.000Z", "Retail", "10.5"]], "totalRows": 1}


def _catalog() -> dict[str, SemanticSourceCatalog]:
    return {
        "sales_model": SemanticSourceCatalog(
            name="sales_model",
            columns=frozenset({"month", "industry_name"}),
            measures=frozenset({"sales"}),
            field_types={"month": "time", "industry_name": "string", "sales": "number"},
        )
    }


def _spec() -> dict:
    return {
        "version": "4",
        "title": "Sales",
        "connection": "default-mysql",
        "parameters": {
            "month": {
                "type": "select",
                "default": None,
                "options": {"data": "month_options", "field": "month"},
            },
            "industry": {
                "type": "select",
                "default": None,
                "options": {"data": "industry_options", "field": "industry"},
            },
        },
        "data": {
            "month_options": {
                "source": "sales_model",
                "dimensions": {"month": {"field": "month", "granularity": "month"}},
                "measures": {"value": "sales"},
                "limit": 10,
            },
            "industry_options": {
                "source": "sales_model",
                "dimensions": {"industry": "industry_name"},
                "measures": {"value": "sales"},
                "limit": 10,
            },
            "trend": {
                "source": "sales_model",
                "dimensions": {
                    "month": {"field": "month", "granularity": "month"},
                    "industry": "industry_name",
                },
                "measures": {"sales": "sales"},
                "where": [
                    {"field": "month", "operator": "eq", "value": {"$param": "month"}},
                    {"field": "industry_name", "operator": "eq", "value": {"$param": "industry"}},
                ],
                "orderBy": [{"field": "month", "direction": "asc"}],
            },
        },
        "views": [
            {
                "id": "trend_view",
                "type": "chart",
                "data": "trend",
                "x": {"field": "month"},
                "axes": [{"id": "sales_axis", "orient": "y"}],
                "series": [{"field": "sales", "mark": "bar", "axis": "sales_axis"}],
            }
        ],
        "interactions": [],
        "layout": {"sidebar": False},
    }


def test_compile_builds_dependency_graph_and_catalog_fields():
    compiled = compile_semantic_dashboard(_spec(), _catalog())

    assert compiled.dependencies["month"] == frozenset({"trend"})
    assert compiled.dependencies["industry"] == frozenset({"trend"})
    assert compiled.data["trend"].outputs[0].expected_header == "month_month"
    assert compiled.data["trend"].outputs[-1].expected_header == "sales"


@pytest.mark.asyncio
async def test_evaluator_maps_columns_normalizes_month_and_refreshes_only_dependencies():
    compiled = compile_semantic_dashboard(_spec(), _catalog())
    executor = FakeSemanticExecutor()

    initial = await evaluate_semantic_dashboard(compiled, executor=executor, initial=True, request_id="initial")
    assert initial["errors"] == {}
    assert initial["data"]["month_options"]["rows"][0]["month"] == "2026-02-01"
    initial_call_count = len(executor.calls)

    refreshed = await evaluate_semantic_dashboard(
        compiled,
        {"month": "2026-02-01", "industry": None},
        changed=["month"],
        executor=executor,
        request_id="r-1",
    )
    assert refreshed["requestId"] == "r-1"
    assert set(refreshed["data"]) == {"trend"}
    assert len(executor.calls) == initial_call_count + 3  # two allow-list nodes + one dependent business node
    assert refreshed["data"]["trend"]["rows"][0]["month"] == "2026-02-01"


@pytest.mark.asyncio
async def test_invalid_parameter_is_rejected_before_business_query():
    compiled = compile_semantic_dashboard(_spec(), _catalog())
    executor = FakeSemanticExecutor()

    with pytest.raises(Exception) as caught:
        await evaluate_semantic_dashboard(
            compiled,
            {"month": "not-allowed", "industry": None},
            changed=["month"],
            executor=executor,
            request_id="r-invalid",
        )
    assert getattr(caught.value, "code", "") == "parameter_value_not_allowed"
    assert len(executor.calls) == 2  # only the two options allow-list queries ran
    assert all(not call.get("filters") for call in executor.calls)


def test_document_extraction_revalidates_v4_and_escapes_script_termination():
    html = '<script id="dashboard-document" type="application/json">' + json.dumps({**_spec(), "title": "<safe>"}, ensure_ascii=False).replace("<", "\\u003c") + "</script>"
    document = extract_semantic_dashboard_document(html)
    assert document["version"] == "4"
    assert document["title"] == "<safe>"


def test_generated_v4_runtime_javascript_passes_node_syntax_check():
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is not installed")
    compiled = compile_semantic_dashboard(_spec(), _catalog())
    evaluation = {
        "data": {
            "month_options": {"rows": [{"month": "2026-02-01", "value": 1}], "totalRows": 1},
            "industry_options": {"rows": [{"industry": "Retail", "value": 1}], "totalRows": 1},
            "trend": {"rows": [{"month": "2026-02-01", "industry": "Retail", "sales": 1}], "totalRows": 1},
        },
        "errors": {},
    }
    html = render_semantic_dashboard_html(compiled, evaluation)
    scripts = re.findall(r"<script>\s*([\s\S]*?)\s*</script>", html)
    assert len(scripts) == 1
    result = subprocess.run([node, "--check", "-"], input=scripts[0], text=True, capture_output=True, check=False)
    assert result.returncode == 0, result.stderr


def test_v4_dashboard_renders_in_real_browser_when_playwright_is_available(tmp_path):
    sync_api = pytest.importorskip("playwright.sync_api")
    echarts_path = __import__("pathlib").Path(__file__).parents[1] / "frontend" / "node_modules" / "echarts" / "dist" / "echarts.min.js"
    if not echarts_path.exists():
        pytest.skip("local ECharts asset is not installed")
    compiled = compile_semantic_dashboard(_spec(), _catalog())
    evaluation = {
        "data": {
            "month_options": {"rows": [{"month": "2026-02-01", "value": 1}], "totalRows": 1},
            "industry_options": {"rows": [{"industry": "Retail", "value": 1}], "totalRows": 1},
            "trend": {"rows": [{"month": "2026-02-01", "industry": "Retail", "sales": 1}], "totalRows": 1},
        },
        "errors": {},
    }
    html = render_semantic_dashboard_html(compiled, evaluation, assets={"mode": "custom", "echarts_url": echarts_path.resolve().as_uri()})
    html_path = tmp_path / "semantic-dashboard.html"
    html_path.write_text(html, encoding="utf-8")
    with sync_api.sync_playwright() as playwright:
        try:
            browser = playwright.chromium.launch(headless=True)
        except sync_api.Error as exc:
            pytest.skip(f"Playwright Chromium is unavailable: {exc}")
        errors = []
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(html_path.resolve().as_uri())
        page.locator("#view-chart-trend_view canvas").wait_for()
        assert page.locator("#live-state").text_content() == "离线快照"
        assert page.locator("#parameter-controls select").count() == 2
        assert page.locator("#view-card-trend_view").count() == 1
        assert not errors
        browser.close()


def test_v4_live_bridge_roundtrip_in_sandboxed_iframe(tmp_path):
    sync_api = pytest.importorskip("playwright.sync_api")
    compiled = compile_semantic_dashboard(_spec(), _catalog())
    evaluation = {
        "data": {
            "month_options": {"rows": [{"month": "2026-02-01", "value": 1}], "totalRows": 1},
            "industry_options": {"rows": [{"industry": "Retail", "value": 1}], "totalRows": 1},
            "trend": {"rows": [{"month": "2026-02-01", "industry": "Retail", "sales": 1}], "totalRows": 1},
        },
        "errors": {},
    }
    html = render_semantic_dashboard_html(compiled, evaluation, assets={"mode": "custom", "echarts_url": "about:blank"})
    with sync_api.sync_playwright() as playwright:
        try:
            browser = playwright.chromium.launch(headless=True)
        except sync_api.Error as exc:
            pytest.skip(f"Playwright Chromium is unavailable: {exc}")
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.set_content('<div id="host"></div><script>window.__dashboardMessages=[]; window.addEventListener("message", event => window.__dashboardMessages.push(event.data));</script>')
        page.evaluate("""(html) => { const frame = document.createElement('iframe'); frame.id = 'dashboard-frame'; frame.setAttribute('sandbox', 'allow-scripts'); document.getElementById('host').appendChild(frame); frame.srcdoc = html; }""", html)
        frame = page.frame_locator("#dashboard-frame")
        frame.locator("#parameter-controls select").first.wait_for()
        frame.locator("#parameter-controls select").first.select_option("2026-02-01")
        page.wait_for_function("() => window.__dashboardMessages.some(item => item && item.type === 'dashboard_parameters_changed')")
        message = page.evaluate("() => window.__dashboardMessages.find(item => item && item.type === 'dashboard_parameters_changed')")
        assert message["parameters"]["month"] == "2026-02-01"
        page.evaluate("""(message) => document.getElementById('dashboard-frame').contentWindow.postMessage({ type: 'dashboard_data_patch', requestId: message.requestId, parameters: message.parameters, data: { trend: { rows: [{ month: '2026-02-01', industry: 'Retail', sales: 2 }], totalRows: 1 } }, errors: {} }, '*')""", message)
        frame.locator("#parameter-controls select").first.wait_for()
        assert frame.locator("#live-state").text_content() == "在线数据"
        browser.close()


def test_renderer_embeds_snapshot_without_sql_or_credentials():
    compiled = compile_semantic_dashboard(_spec(), _catalog())
    evaluation = {
        "requestId": "build",
        "parameters": {"month": None, "industry": None},
        "data": {
            "month_options": {"rows": [{"month": "2026-02-01", "value": 1}], "totalRows": 1},
            "industry_options": {"rows": [{"industry": "Retail", "value": 1}], "totalRows": 1},
            "trend": {"rows": [{"month": "2026-02-01", "industry": "Retail", "sales": 1}], "totalRows": 1},
        },
        "errors": {},
    }
    html = render_semantic_dashboard_html(compiled, evaluation)
    assert 'id="dashboard-document"' in html
    assert 'id="dashboard-runtime"' in html
    assert "sqlTemplate" not in html
    assert "Bearer" not in html
    assert "WITH " not in html
