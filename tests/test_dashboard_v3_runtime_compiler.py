import json

from src.agent.tool_providers.dashboard_compiler import compile_dashboard_runtime
from src.agent.tool_providers.dashboard_data import DashboardDataset
from src.agent.tool_providers.dashboard_spec import normalize_dashboard_arguments


def _runtime_spec() -> dict:
    return {
        "version": "3",
        "title": "Runtime Dashboard",
        "filename": "runtime_dashboard",
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
                "id": "kpis",
                "type": "metric_cards",
                "cards": [{"label": "Sales", "value": "30"}],
            },
            {
                "id": "summary_chart",
                "type": "chart",
                "coordinate": "cartesian",
                "dataset": "summary",
                "x": {"field": "category"},
                "axes": [{"id": "sales_axis", "orient": "y", "name": "Sales"}],
                "series": [{"name": "Sales", "field": "sales", "mark": "bar", "axis": "sales_axis"}],
            },
            {
                "id": "detail_table",
                "type": "table",
                "dataset": "detail",
                "columns": [
                    {"field": "item", "label": "Item"},
                    {"field": "sales", "label": "Sales"},
                ],
            },
        ],
        "interactions": [
            {
                "id": "drill_to_detail",
                "source": {"view": "summary_chart", "event": "click"},
                "action": {
                    "type": "drilldown",
                    "target_dataset": "detail",
                    "match": {"source_field": "category", "target_field": "category"},
                    "target_view": {
                        "type": "table",
                        "columns": [
                            {"field": "item", "label": "Item"},
                            {"field": "sales", "label": "Sales"},
                        ],
                    },
                },
            }
        ],
    }


def _datasets(spec: dict) -> dict[str, DashboardDataset]:
    return {
        "summary": DashboardDataset(
            id="summary",
            schema=spec["datasets"][0]["schema"],
            rows=[
                {"category": "A", "sales": 10},
                {"category": "B", "sales": 20},
            ],
        ),
        "detail": DashboardDataset(
            id="detail",
            schema=spec["datasets"][1]["schema"],
            rows=[
                {"category": "A", "item": "A1", "sales": 6},
                {"category": "A", "item": "A2", "sales": 4},
                {"category": "B", "item": "B1", "sales": 20},
            ],
        ),
    }


def test_compile_dashboard_runtime_outputs_v3_payload_without_legacy_ir():
    spec = normalize_dashboard_arguments({"spec": _runtime_spec()})
    runtime = compile_dashboard_runtime(spec, _datasets(spec))
    payload = json.dumps(runtime, ensure_ascii=False)

    assert runtime["version"] == "3"
    assert runtime["metadata"]["title"] == "Runtime Dashboard"
    assert [view["id"] for view in runtime["views"]] == ["kpis", "summary_chart", "detail_table"]
    assert "chart_type" not in payload
    assert "drilldown_data" not in payload
    assert "echarts_option" not in payload
    assert "charts-data" not in payload


def test_compile_dashboard_runtime_preserves_view_render_models_and_interactions():
    spec = normalize_dashboard_arguments({"spec": _runtime_spec()})
    runtime = compile_dashboard_runtime(spec, _datasets(spec))
    views = {view["id"]: view for view in runtime["views"]}

    assert views["kpis"]["render"]["engine"] == "metric-cards"
    assert views["summary_chart"]["render"]["engine"] == "echarts"
    assert views["summary_chart"]["render"]["option"]["series"][0]["data"] == [10, 20]
    assert views["detail_table"]["render"]["engine"] == "html-table"
    assert views["detail_table"]["data"]["rows"][0]["item"] == "A1"
    assert runtime["interactions"][0]["action"]["target_view"]["type"] == "table"
    assert runtime["state"] == {"filters": {}, "drill_path": []}