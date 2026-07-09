import json
import re

from src.agent.tool_providers.dashboard_renderer import render_dashboard_runtime_html


def _runtime() -> dict:
    return {
        "version": "3",
        "metadata": {"title": "Renderer Test", "theme": "light"},
        "datasets": [
            {
                "id": "summary",
                "schema": [
                    {"name": "month", "type": "string"},
                    {"name": "sales", "type": "number"},
                ],
                "rows": [{"month": "Jan", "sales": 12}],
            }
        ],
        "views": [
            {
                "id": "kpis",
                "type": "metric_cards",
                "title": "KPIs",
                "render": {"engine": "metric-cards", "cards": [{"label": "Revenue", "value": "120", "change": "+8%"}]},
            },
            {
                "id": "sales_chart",
                "type": "chart",
                "title": "Revenue",
                "dataset": "summary",
                "render": {
                    "engine": "echarts",
                    "option": {
                        "xAxis": {"type": "category", "data": ["Jan"]},
                        "yAxis": [{"type": "value"}],
                        "series": [{"type": "bar", "data": [12]}],
                    },
                },
                "data": {"rows": [{"month": "Jan", "sales": 12}]},
            },
            {
                "id": "detail_table",
                "type": "table",
                "title": "Details",
                "dataset": "summary",
                "render": {
                    "engine": "html-table",
                    "columns": [
                        {"field": "month", "label": "Month"},
                        {"field": "sales", "label": "Sales"},
                    ],
                },
                "data": {"rows": [{"month": "Jan", "sales": 12}]},
            },
        ],
        "filters": [],
        "interactions": [],
        "exports": [],
        "state": {"filters": {}, "drill_path": []},
    }


def test_render_dashboard_runtime_html_includes_v3_runtime_markers():
    html = render_dashboard_runtime_html(
        _runtime(),
        dashboard_spec={"version": "3", "title": "Renderer Test"},
        assets={"mode": "local", "echarts_url": "assets/vendor/echarts.min.js"},
        exports=[],
    )

    assert "<title>Renderer Test</title>" in html
    assert 'src="assets/vendor/echarts.min.js"' in html
    assert 'id="dashboard-runtime"' in html
    assert 'id="dashboard-spec"' in html
    assert 'id="dashboard-metadata"' in html
    assert 'id="view-card-sales_chart"' in html
    assert 'id="view-chart-sales_chart"' in html
    assert 'data-view-id="detail_table"' in html
    assert "renderMetricCards" in html
    assert "renderTable" in html
    assert "renderChart" in html
    assert "handleDrilldown" in html
    assert "charts-data" not in html


def test_render_dashboard_runtime_html_embeds_parseable_runtime_payload():
    html = render_dashboard_runtime_html(_runtime(), dashboard_spec={"version": "3"}, exports=[])
    runtime_json = re.search(
        r'<script id="dashboard-runtime" type="application/json">\s*(.*?)\s*</script>',
        html,
        re.DOTALL,
    ).group(1)
    runtime = json.loads(runtime_json)

    assert runtime["version"] == "3"
    assert [view["type"] for view in runtime["views"]] == ["metric_cards", "chart", "table"]
    assert runtime["views"][1]["render"]["engine"] == "echarts"
    assert runtime["views"][2]["render"]["engine"] == "html-table"


def test_render_dashboard_runtime_html_can_disable_pdf_export():
    html = render_dashboard_runtime_html(_runtime(), exports=[])

    assert "html2pdf" not in html
    assert "Export PDF" not in html