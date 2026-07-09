from src.agent.tool_providers.dashboard_renderer import render_dashboard_runtime_html


def _runtime() -> dict:
    return {
        "version": "3",
        "metadata": {"title": "Runtime Smoke", "theme": "light"},
        "datasets": [
            {
                "id": "summary",
                "schema": [{"name": "category", "type": "string"}, {"name": "sales", "type": "number"}],
                "rows": [{"category": "A", "sales": 10}],
            }
        ],
        "views": [
            {
                "id": "summary_chart",
                "type": "chart",
                "title": "Summary",
                "dataset": "summary",
                "render": {
                    "engine": "echarts",
                    "option": {
                        "xAxis": {"type": "category", "data": ["A"]},
                        "yAxis": [{"type": "value"}],
                        "series": [{"type": "bar", "data": [10]}],
                    },
                },
                "data": {"rows": [{"category": "A", "sales": 10}]},
            }
        ],
        "filters": [],
        "interactions": [
            {
                "id": "drill",
                "source": {"view": "summary_chart", "event": "click"},
                "action": {
                    "type": "drilldown",
                    "target_dataset": "summary",
                    "match": {"source_field": "category", "target_field": "category"},
                    "target_view": {
                        "type": "table",
                        "columns": [
                            {"field": "category", "label": "Category"},
                            {"field": "sales", "label": "Sales"},
                        ],
                    },
                },
            }
        ],
        "exports": [],
        "state": {"filters": {}, "drill_path": []},
    }


def test_runtime_dashboard_smoke_contains_core_regions_and_chart_bootstrap():
    html = render_dashboard_runtime_html(_runtime(), exports=[])

    assert "dashboard-shell" in html
    assert "runtime-grid" in html
    assert 'id="view-chart-summary_chart"' in html
    assert "echarts.init" in html
    assert "chart.setOption" in html


def test_runtime_dashboard_smoke_contains_drilldown_runtime():
    html = render_dashboard_runtime_html(_runtime(), exports=[])

    assert "chart.on('click'" in html
    assert "handleDrilldown" in html
    assert "renderDrillTarget" in html
    assert "resetDrilldown" in html
    assert "html-table" in html