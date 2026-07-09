from pathlib import Path
import uuid

import pytest

from src.agent.tool_providers.base import GlobalRuntimeServices, SessionToolBuildContext
from src.agent.tool_providers.html_dashboard import HTMLDashboardProvider
from src.workspace.workspace_manager import WorkspaceManager


def _context(workspace_name: str):
    root_dir = Path(".phase0_test_workspace") / f"{workspace_name}_{uuid.uuid4().hex}"
    root_dir.mkdir(parents=True)
    workspace = WorkspaceManager(root_dir=str(root_dir), session_id="phase0")
    context = SessionToolBuildContext(
        session_id="phase0",
        workspace=workspace,
        project_root=Path.cwd(),
        global_services=GlobalRuntimeServices(),
    )
    return workspace, context


def _write_data(workspace: WorkspaceManager) -> None:
    workspace.write_file("data/summary.csv", "category,sales\nA,10\nB,20\n")
    workspace.write_file("data/detail.csv", "category,item,sales\nA,A1,6\nA,A2,4\nB,B1,20\n")


def _table_drilldown_spec() -> dict:
    return {
        "version": "3",
        "title": "Phase 0 Table Drilldown",
        "filename": "phase0_table_drilldown",
        "datasets": [
            {
                "id": "summary",
                "source": {"type": "csv", "path": "data/summary.csv"},
                "schema": [
                    {"name": "category", "type": "string"},
                    {"name": "sales", "type": "number"},
                ],
            },
            {
                "id": "detail",
                "source": {"type": "csv", "path": "data/detail.csv"},
                "schema": [
                    {"name": "category", "type": "string"},
                    {"name": "item", "type": "string"},
                    {"name": "sales", "type": "number"},
                ],
            },
        ],
        "views": [
            {
                "id": "summary_chart",
                "type": "chart",
                "coordinate": "cartesian",
                "title": "Sales by category",
                "dataset": "summary",
                "x": {"field": "category"},
                "axes": [{"id": "sales_axis", "orient": "y", "name": "Sales"}],
                "series": [{"field": "sales", "mark": "bar", "axis": "sales_axis"}],
            },
            {
                "id": "detail_table",
                "type": "table",
                "title": "Detail rows",
                "dataset": "detail",
                "columns": [
                    {"field": "item", "label": "Item"},
                    {"field": "sales", "label": "Sales"},
                ],
            },
        ],
        "interactions": [
            {
                "id": "drill_to_table",
                "source": {"view": "summary_chart", "event": "click"},
                "action": {
                    "type": "drilldown",
                    "target_dataset": "detail",
                    "match": {"source_field": "category", "target_field": "category"},
                    "target_view": {
                        "type": "table",
                        "title": "{{ value }} detail",
                        "columns": [
                            {"field": "item", "label": "Item"},
                            {"field": "sales", "label": "Sales"},
                        ],
                    },
                },
            }
        ],
    }


@pytest.mark.asyncio
async def test_table_drilldown_builds_with_v3_runtime():
    workspace, context = _context("table_drilldown")
    _write_data(workspace)
    tools = await HTMLDashboardProvider().build_tools(context)
    validate = next(tool for tool in tools if tool.name == "validate_dashboard_spec")
    build = next(tool for tool in tools if tool.name == "build_dashboard")

    spec = _table_drilldown_spec()
    validate_result = await validate.execute("validate", {"spec": spec})
    build_result = await build.execute("build", {"spec": spec})
    html = workspace.read_file("dashboards/phase0_table_drilldown.html")

    assert validate_result.is_error is False
    assert build_result.is_error is False
    assert build_result.details["view_count"] == 2
    assert 'id="dashboard-runtime"' in html
    assert '"target_view": {"type": "table"' in html


@pytest.mark.asyncio
async def test_generated_dashboard_uses_v3_runtime_not_legacy_chart_ir():
    workspace, context = _context("runtime_ir")
    _write_data(workspace)
    tools = await HTMLDashboardProvider().build_tools(context)
    build = next(tool for tool in tools if tool.name == "build_dashboard")

    result = await build.execute("build", {"spec": _table_drilldown_spec()})
    html = workspace.read_file("dashboards/phase0_table_drilldown.html")

    assert result.is_error is False
    assert 'id="charts-data"' not in html
    assert '"chart_type"' not in html
    assert '"echarts_option"' not in html
    assert '"drilldown_data"' not in html
    assert '"engine": "echarts"' in html
    assert '"engine": "html-table"' in html

@pytest.mark.asyncio
async def test_runtime_contains_chart_to_table_drilldown_handlers():
    workspace, context = _context("table_drill_handlers")
    _write_data(workspace)
    tools = await HTMLDashboardProvider().build_tools(context)
    build = next(tool for tool in tools if tool.name == "build_dashboard")

    result = await build.execute("build", {"spec": _table_drilldown_spec()})
    html = workspace.read_file("dashboards/phase0_table_drilldown.html")

    assert result.is_error is False
    assert "function handleDrilldown" in html
    assert "function resetDrilldown" in html
    assert "renderDrillTarget" in html
    assert "html-table" in html
    assert "{{ value }} detail" in html


@pytest.mark.asyncio
async def test_runtime_contains_chart_to_chart_drilldown_handlers():
    workspace, context = _context("chart_drill_handlers")
    _write_data(workspace)
    tools = await HTMLDashboardProvider().build_tools(context)
    build = next(tool for tool in tools if tool.name == "build_dashboard")

    spec = _table_drilldown_spec()
    spec["interactions"][0]["action"]["target_view"] = {
        "type": "chart",
        "coordinate": "cartesian",
        "title": "{{ value }} item sales",
        "x": {"field": "item"},
        "axes": [{"id": "sales_axis", "orient": "y", "name": "Sales"}],
        "series": [{"field": "sales", "mark": "bar", "axis": "sales_axis"}],
    }
    result = await build.execute("build", {"spec": spec})
    html = workspace.read_file("dashboards/phase0_table_drilldown.html")

    assert result.is_error is False
    assert "function buildCartesianOption" in html
    assert "{{ value }} item sales" in html
    assert '"target_view": {"type": "chart"' in html
