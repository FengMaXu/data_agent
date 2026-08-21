import json
import re
import shutil
import subprocess

import pytest

from src.agent.tool_providers.dashboard_compiler import compile_dashboard_runtime
from src.agent.tool_providers.dashboard_data import DashboardDataset
from src.agent.tool_providers.dashboard_design import COMMERCIAL_PALETTE
from src.agent.tool_providers.dashboard_renderer import render_dashboard_runtime_html
from src.agent.tool_providers.dashboard_spec import normalize_dashboard_arguments, validate_dashboard_spec


def _quality_spec() -> dict:
    return {
        "version": "3",
        "title": "Regional performance",
        "layout": {"sidebar": False},
        "datasets": [
            {
                "id": "sales",
                "source": {"type": "csv", "path": "data/sales.csv"},
                "schema": [
                    {"name": "region", "type": "string", "role": "dimension"},
                    {"name": "sales", "type": "number", "role": "measure", "unit": "CNY"},
                ],
            }
        ],
        "filters": [
            {
                "id": "region",
                "type": "select",
                "label": "Region",
                "dataset": "sales",
                "field": "region",
                "targets": ["sales_chart", "sales_table"],
                "default": "",
                "all_label": "All regions",
            }
        ],
        "views": [
            {
                "id": "sales_chart",
                "type": "chart",
                "title": "East leads regional sales",
                "subtitle": "Current reporting period",
                "insight": "East contributes the largest reported value.",
                "recipe": "category-columns",
                "reading_mode": "glance",
                "source": {"label": "Sales ledger", "updated_at": "2026-07-29"},
                "annotations": [{"text": "Review the gap to West.", "tone": "warning"}],
                "dataset": "sales",
                "layout": {"span": 8, "height": 420},
                "coordinate": "cartesian",
                "x": {"field": "region", "type": "category"},
                "axes": [{"id": "sales_axis", "orient": "y", "name": "Sales", "unit": "CNY"}],
                "series": [{"name": "Sales", "field": "sales", "mark": "bar", "axis": "sales_axis"}],
            },
            {
                "id": "sales_table",
                "type": "table",
                "title": "Regional detail",
                "insight": "The table preserves the auditable values behind the comparison.",
                "recipe": "detail-table",
                "reading_mode": "detail",
                "source": "Sales ledger",
                "dataset": "sales",
                "layout": {"span": 4},
                "columns": [
                    {"field": "region", "label": "Region"},
                    {"field": "sales", "label": "Sales"},
                ],
            },
        ],
        "interactions": [],
        "exports": [],
    }


def _runtime() -> dict:
    spec = normalize_dashboard_arguments({"spec": _quality_spec()})
    dataset_spec = spec["datasets"][0]
    datasets = {
        "sales": DashboardDataset(
            id="sales",
            rows=[
                {"region": "East", "sales": 120},
                {"region": "West", "sales": 80},
            ],
            schema=dataset_spec["schema"],
        )
    }
    return compile_dashboard_runtime(spec, datasets)


def test_quality_metadata_recipe_and_filter_validate_without_warnings():
    spec = normalize_dashboard_arguments({"spec": _quality_spec()})

    assert validate_dashboard_spec(spec) == []


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda spec: spec["views"][0].update({"recipe": "unknown"}), "recipe unsupported"),
        (lambda spec: spec["views"][0].update({"type": "pivot_table"}), "type unsupported"),
        (
            lambda spec: spec.update(
                {
                    "interactions": [
                        {
                            "source": {"view": "sales_chart", "event": "click"},
                            "action": {"type": "click-to-filter"},
                        }
                    ]
                }
            ),
            "only drilldown interactions are executable",
        ),
        (lambda spec: spec["filters"][0].update({"default": "All"}), "empty value"),
    ],
)
def test_validation_rejects_non_executable_or_untraceable_contracts(mutate, message):
    spec = _quality_spec()
    mutate(spec)

    with pytest.raises(ValueError, match=message):
        normalize_dashboard_arguments({"spec": spec})


def test_runtime_preserves_narrative_filters_and_project_palette():
    runtime = _runtime()
    chart = runtime["views"][0]

    assert runtime["design"]["palette"] == COMMERCIAL_PALETTE
    assert runtime["filters"][0]["field"] == "region"
    assert chart["insight"] == "East contributes the largest reported value."
    assert chart["recipe"] == "category-columns"
    assert chart["annotations"][0]["tone"] == "warning"


def test_renderer_honors_sidebar_span_numeric_height_filters_and_narrative():
    html = render_dashboard_runtime_html(_runtime(), exports=[])

    assert 'class="dashboard-shell no-sidebar"' in html
    assert 'data-filter-id="region"' in html
    assert 'style="--view-span:8;"' in html
    assert 'style="height:420px;"' in html
    assert 'class="view-insight"' in html
    assert "East contributes the largest reported value." in html
    assert 'class="annotation warning"' in html
    assert "Sales ledger" in html
    assert "__SIDEBAR_HTML__" not in html
    assert "__FILTERS_HTML__" not in html


def test_generated_inline_runtime_javascript_passes_node_syntax_check():
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is not installed")

    html = render_dashboard_runtime_html(_runtime(), exports=[])
    scripts = re.findall(r"<script>\s*([\s\S]*?)\s*</script>", html)
    assert len(scripts) == 1
    result = subprocess.run(
        [node, "--check", "-"],
        input=scripts[0],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr


def test_runtime_payload_remains_json_serializable():
    json.dumps(_runtime(), ensure_ascii=False)


def test_numeric_scatter_recipe_compiles_true_xy_points():
    spec = {
        "version": "3",
        "title": "Relationship",
        "datasets": [
            {
                "id": "points",
                "source": {"type": "csv", "path": "data/points.csv"},
                "schema": [
                    {"name": "spend", "type": "number"},
                    {"name": "revenue", "type": "number"},
                ],
            }
        ],
        "views": [
            {
                "id": "relationship",
                "type": "chart",
                "title": "Spend and revenue move together",
                "insight": "Higher spend is associated with higher revenue.",
                "recipe": "relationship-scatter",
                "reading_mode": "analysis",
                "source": "Finance model",
                "dataset": "points",
                "coordinate": "cartesian",
                "x": {"field": "spend", "type": "value"},
                "axes": [{"id": "revenue_axis", "orient": "y", "name": "Revenue"}],
                "series": [
                    {"name": "Revenue", "field": "revenue", "mark": "scatter", "axis": "revenue_axis"}
                ],
            }
        ],
    }
    normalized = normalize_dashboard_arguments({"spec": spec})
    runtime = compile_dashboard_runtime(
        normalized,
        {
            "points": DashboardDataset(
                id="points",
                rows=[{"spend": 10, "revenue": 30}, {"spend": 20, "revenue": 55}],
                schema=spec["datasets"][0]["schema"],
            )
        },
    )
    option = runtime["views"][0]["render"]["option"]

    assert option["xAxis"] == {"type": "value"}
    assert option["tooltip"] == {"trigger": "item"}
    assert option["series"][0]["data"] == [[10, 30], [20, 55]]