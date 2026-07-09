import json
from pathlib import Path
import uuid

import pytest

from src.agent.tool_providers.base import GlobalRuntimeServices, SessionToolBuildContext
from src.agent.tool_providers.dashboard_compiler import compile_dashboard_runtime
from src.agent.tool_providers.dashboard_data import DashboardDataset
from src.agent.tool_providers.dashboard_spec import normalize_dashboard_arguments
from src.agent.tool_providers.html_dashboard import HTMLDashboardProvider
from src.workspace.workspace_manager import WorkspaceManager


def _trend_spec(filename: str = "grouped_dashboard") -> dict:
    return {
        "version": "3",
        "title": "Grouped Trend",
        "filename": filename,
        "datasets": [
            {
                "id": "trend",
                "source": {"type": "csv", "path": "data/trend.csv"},
                "schema": [
                    {"name": "industry", "type": "string"},
                    {"name": "month", "type": "string"},
                    {"name": "growth", "type": "number"},
                ],
            }
        ],
        "views": [
            {
                "id": "growth",
                "type": "chart",
                "coordinate": "cartesian",
                "title": "Growth Trend",
                "dataset": "trend",
                "x": {"field": "month"},
                "series_by": {
                    "field": "industry",
                    "order": ["Wholesale", "Retail", "Catering"],
                    "colors": {"Wholesale": "#4F6980", "Retail": "#F47942", "Catering": "#638B66"},
                },
                "axes": [{"id": "growth_axis", "orient": "y", "name": "Growth", "unit": "%"}],
                "series": [{"name": "YoY growth", "field": "growth", "mark": "line", "axis": "growth_axis"}],
            }
        ],
    }


def _trend_rows() -> list[dict]:
    return [
        {"industry": "Wholesale", "month": "2025-03", "growth": -17},
        {"industry": "Retail", "month": "2025-03", "growth": 17},
        {"industry": "Catering", "month": "2025-03", "growth": 6},
        {"industry": "Wholesale", "month": "2025-04", "growth": -22},
        {"industry": "Retail", "month": "2025-04", "growth": 25},
        {"industry": "Catering", "month": "2025-04", "growth": 8},
    ]


def _dataset(spec: dict) -> DashboardDataset:
    return DashboardDataset(id="trend", rows=_trend_rows(), schema=spec["datasets"][0]["schema"])


def test_series_by_compiles_long_form_rows_into_independent_runtime_series():
    spec = normalize_dashboard_arguments({"spec": _trend_spec()})
    runtime = compile_dashboard_runtime(spec, {"trend": _dataset(spec)})
    option = runtime["views"][0]["render"]["option"]

    assert option["xAxis"]["data"] == ["2025-03", "2025-04"]
    assert [series["name"] for series in option["series"]] == ["Wholesale", "Retail", "Catering"]
    assert option["series"][0]["data"] == [-17, -22]
    assert option["series"][1]["data"] == [17, 25]
    assert option["series"][2]["data"] == [6, 8]
    assert option["series"][0]["lineStyle"]["color"] == "#4F6980"
    assert runtime["views"][0]["data"]["bindings"]["series_by"]["field"] == "industry"


def test_repeated_series_field_requires_grouping_or_where_filters():
    spec = _trend_spec()
    view = spec["views"][0]
    view.pop("series_by")
    view["series"] = [
        {"name": "Wholesale", "field": "growth", "mark": "line", "axis": "growth_axis"},
        {"name": "Retail", "field": "growth", "mark": "line", "axis": "growth_axis"},
    ]

    with pytest.raises(ValueError, match="repeats field 'growth'"):
        normalize_dashboard_arguments({"spec": spec})


def test_where_filters_allow_repeated_measure_series():
    spec = _trend_spec()
    view = spec["views"][0]
    view.pop("series_by")
    view["series"] = [
        {"name": "Wholesale", "field": "growth", "mark": "line", "axis": "growth_axis", "where": {"industry": "Wholesale"}},
        {"name": "Retail", "field": "growth", "mark": "line", "axis": "growth_axis", "where": {"industry": "Retail"}},
    ]
    normalized = normalize_dashboard_arguments({"spec": spec})
    runtime = compile_dashboard_runtime(normalized, {"trend": _dataset(normalized)})
    option = runtime["views"][0]["render"]["option"]

    assert option["xAxis"]["data"] == ["2025-03", "2025-04"]
    assert option["series"][0]["data"] == [-17, -22]
    assert option["series"][1]["data"] == [17, 25]


@pytest.mark.asyncio
async def test_dashboard_tools_recover_raw_arguments_and_operation_aliases():
    root_dir = Path(".dashboard_grouped_workspace") / uuid.uuid4().hex
    workspace = WorkspaceManager(root_dir=str(root_dir), session_id="session_test")
    workspace.write_file(
        "data/trend.csv",
        "\n".join([
            "industry,month,growth",
            "Wholesale,2025-03,-17",
            "Retail,2025-03,17",
            "Catering,2025-03,6",
            "Wholesale,2025-04,-22",
            "Retail,2025-04,25",
            "Catering,2025-04,8",
        ]),
    )
    context = SessionToolBuildContext(
        session_id="session_test",
        workspace=workspace,
        project_root=Path.cwd(),
        global_services=GlobalRuntimeServices(),
    )
    tools = await HTMLDashboardProvider().build_tools(context)
    build_dashboard = next(tool for tool in tools if tool.name == "build_dashboard")
    edit_dashboard = next(tool for tool in tools if tool.name == "edit_dashboard")

    build_result = await build_dashboard.execute("call-build", {"_raw": json.dumps({"spec": _trend_spec("raw_grouped")})})

    replacement = _trend_spec()["views"][0]
    replacement["title"] = "Updated Growth Trend"
    edit_result = await edit_dashboard.execute(
        "call-edit",
        {
            "_raw": json.dumps({
                "dashboard_path": "dashboards/raw_grouped.html",
                "operations": [{"type": "replace_view", "target": {"view_id": "growth"}, "view": replacement}],
            })
        },
    )

    assert build_result.is_error is False
    assert edit_result.is_error is False
    assert edit_result.details["applied_operations"] == ["replaced view growth"]
    assert "Updated Growth Trend" in workspace.read_file("dashboards/raw_grouped.html")