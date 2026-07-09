from pathlib import Path
import uuid

import pytest

from src.agent.tool_providers.base import GlobalRuntimeServices, SessionToolBuildContext
from src.agent.tool_providers.html_dashboard import HTMLDashboardProvider
from src.workspace.workspace_manager import WorkspaceManager


def _context():
    root_dir = Path(".html_dashboard_provider_workspace") / uuid.uuid4().hex
    workspace = WorkspaceManager(root_dir=str(root_dir), session_id="session_test")
    context = SessionToolBuildContext(
        session_id="session_test",
        workspace=workspace,
        project_root=Path.cwd(),
        global_services=GlobalRuntimeServices(),
    )
    return workspace, context


def _write_fixture_data(workspace: WorkspaceManager) -> None:
    workspace.write_file("data/summary.csv", "category,sales,growth\nWholesale,7276.57,-23.34\nRetail,499.88,16.46\n")
    workspace.write_file(
        "data/medium.csv",
        "category,item,sales,growth\nWholesale,Machinery,1000,-12.5\nWholesale,Food,800,8.2\nRetail,General retail,300,18.1\n",
    )


def _dashboard_spec(filename: str = "industry_dashboard") -> dict:
    return {
        "version": "3",
        "title": "Industry Dashboard",
        "filename": filename,
        "datasets": [
            {
                "id": "summary",
                "source": {"type": "csv", "path": "data/summary.csv"},
                "schema": [
                    {"name": "category", "type": "string"},
                    {"name": "sales", "type": "number"},
                    {"name": "growth", "type": "number"},
                ],
            },
            {
                "id": "medium",
                "source": {"type": "csv", "path": "data/medium.csv"},
                "schema": [
                    {"name": "category", "type": "string"},
                    {"name": "item", "type": "string"},
                    {"name": "sales", "type": "number"},
                    {"name": "growth", "type": "number"},
                ],
            },
        ],
        "views": [
            {
                "id": "sales_growth",
                "type": "chart",
                "coordinate": "cartesian",
                "title": "Sales and growth",
                "dataset": "summary",
                "layout": {"span": 12, "height": 420},
                "x": {"field": "category"},
                "axes": [
                    {"id": "sales_axis", "orient": "y", "name": "Sales"},
                    {"id": "growth_axis", "orient": "y", "name": "Growth", "position": "right"},
                ],
                "series": [
                    {"name": "Sales", "field": "sales", "mark": "bar", "axis": "sales_axis"},
                    {"name": "Growth", "field": "growth", "mark": "line", "axis": "growth_axis"},
                ],
            },
            {
                "id": "detail_table",
                "type": "table",
                "title": "Details",
                "dataset": "medium",
                "columns": [
                    {"field": "category", "label": "Category"},
                    {"field": "item", "label": "Item"},
                    {"field": "sales", "label": "Sales"},
                ],
            },
        ],
        "interactions": [
            {
                "id": "drill",
                "source": {"view": "sales_growth", "event": "click"},
                "action": {
                    "type": "drilldown",
                    "target_dataset": "medium",
                    "match": {"source_field": "category", "target_field": "category"},
                    "target_view": {
                        "type": "chart",
                        "coordinate": "cartesian",
                        "title": "{{ value }} item sales",
                        "x": {"field": "item"},
                        "axes": [{"id": "sales_axis", "orient": "y", "name": "Sales"}],
                        "series": [{"name": "Sales", "field": "sales", "mark": "bar", "axis": "sales_axis"}],
                    },
                },
            }
        ],
    }


@pytest.mark.asyncio
async def test_build_dashboard_supports_v3_spec_only():
    workspace, context = _context()
    _write_fixture_data(workspace)
    tools = await HTMLDashboardProvider().build_tools(context)
    tool_names = {tool.name for tool in tools}

    assert tool_names == {"validate_dashboard_spec", "build_dashboard", "edit_dashboard"}

    build_dashboard = next(tool for tool in tools if tool.name == "build_dashboard")
    result = await build_dashboard.execute("call-1", {"spec": _dashboard_spec()})

    html = workspace.read_file("dashboards/industry_dashboard.html")
    assert result.is_error is False
    assert result.details["spec_version"] == "3"
    assert result.details["view_count"] == 2
    assert "show_widget" not in result.content[0].text
    assert "Industry Dashboard" in result.content[0].text
    assert 'id="dashboard-runtime"' in html
    assert '"engine": "echarts"' in html
    assert '"engine": "html-table"' in html
    assert '"chart_type"' not in html
    assert '"renderer_version": "dashboard-html-v3-runtime"' in html


@pytest.mark.asyncio
async def test_build_dashboard_rejects_legacy_charts():
    _workspace, context = _context()
    tools = await HTMLDashboardProvider().build_tools(context)
    build_dashboard = next(tool for tool in tools if tool.name == "build_dashboard")

    result = await build_dashboard.execute(
        "call-1",
        {"title": "Legacy", "charts": [{"title": "Sales", "chart_type": "bar"}]},
    )

    assert result.is_error is True
    assert "legacy charts input" in result.details["error"]


@pytest.mark.asyncio
async def test_validate_dashboard_spec_tool_reports_errors():
    _workspace, context = _context()
    tools = await HTMLDashboardProvider().build_tools(context)
    validate = next(tool for tool in tools if tool.name == "validate_dashboard_spec")

    result = await validate.execute(
        "call-1",
        {
            "spec": {
                "version": "3",
                "title": "Invalid",
                "datasets": [],
                "views": [{"id": "v1", "type": "chart", "coordinate": "cartesian", "title": "Bad", "dataset": "missing"}],
            }
        },
    )

    assert result.is_error is True
    assert "unknown dataset" in result.details["error"]


@pytest.mark.asyncio
async def test_edit_dashboard_replaces_view_from_embedded_spec():
    workspace, context = _context()
    _write_fixture_data(workspace)
    tools = await HTMLDashboardProvider().build_tools(context)
    build_dashboard = next(tool for tool in tools if tool.name == "build_dashboard")
    edit_dashboard = next(tool for tool in tools if tool.name == "edit_dashboard")

    build_result = await build_dashboard.execute("call-build", {"spec": _dashboard_spec("editable_dashboard")})
    assert build_result.is_error is False

    replacement = _dashboard_spec()["views"][0]
    replacement["title"] = "Updated title"
    edit_result = await edit_dashboard.execute(
        "call-edit",
        {
            "dashboard_path": "dashboards/editable_dashboard.html",
            "operations": [{"op": "replace_view", "view_id": "sales_growth", "view": replacement}],
        },
    )

    html = workspace.read_file("dashboards/editable_dashboard.html")
    assert edit_result.is_error is False
    assert edit_result.details["applied_operations"] == ["replaced view sales_growth"]
    assert "Updated title" in html
    assert '"dashboard-spec"' in html