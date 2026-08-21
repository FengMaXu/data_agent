from pathlib import Path

import pytest

from src.agent.tool_providers.dashboard_renderer import render_dashboard_runtime_html


def _runtime() -> dict:
    rows = [
        {"region": "East", "sales": 120},
        {"region": "West", "sales": 80},
    ]
    return {
        "version": "3",
        "metadata": {"title": "Drillback verification", "theme": "light"},
        "datasets": [{"id": "sales", "rows": rows, "schema": []}],
        "views": [
            {
                "id": "sales_chart",
                "type": "chart",
                "title": "Regional sales",
                "dataset": "sales",
                "layout": {"height": 420},
                "render": {"engine": "echarts"},
                "data": {
                    "rows": rows,
                    "bindings": {
                        "coordinate": "cartesian",
                        "x": {"field": "region", "type": "category"},
                        "axes": [{"id": "sales_axis", "orient": "y", "name": "Sales"}],
                        "series": [
                            {
                                "name": "Sales",
                                "field": "sales",
                                "mark": "bar",
                                "axis": "sales_axis",
                            }
                        ],
                    },
                },
            }
        ],
        "filters": [],
        "interactions": [
            {
                "id": "region_detail",
                "source": {"view": "sales_chart", "event": "click"},
                "action": {
                    "type": "drilldown",
                    "target_dataset": "sales",
                    "match": {
                        "source_field": "region",
                        "target_field": "region",
                    },
                    "target_view": {
                        "type": "table",
                        "title": "{{ value }} detail",
                        "columns": [
                            {"field": "region", "label": "Region"},
                            {"field": "sales", "label": "Sales"},
                        ],
                    },
                },
            }
        ],
        "exports": [],
        "state": {"filters": {}, "drill_path": []},
    }


def test_dashboard_returns_to_parent_view_after_drilldown(tmp_path: Path):
    sync_api = pytest.importorskip("playwright.sync_api")
    echarts_path = (
        Path(__file__).parents[1]
        / "frontend"
        / "node_modules"
        / "echarts"
        / "dist"
        / "echarts.min.js"
    )
    if not echarts_path.exists():
        pytest.skip("local ECharts asset is not installed")

    html = render_dashboard_runtime_html(
        _runtime(),
        assets={"mode": "custom", "echarts_url": echarts_path.resolve().as_uri()},
        exports=[],
    )
    html_path = tmp_path / "dashboard-drillback.html"
    html_path.write_text(html, encoding="utf-8")

    with sync_api.sync_playwright() as playwright:
        try:
            browser = playwright.chromium.launch(headless=True)
        except sync_api.Error as exc:
            pytest.skip(f"Playwright Chromium is unavailable: {exc}")
        page_errors = []
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.set_default_timeout(5000)
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.goto(html_path.resolve().as_uri())
        page.locator("#view-chart-sales_chart canvas").wait_for()

        page.evaluate(
            """() => handleDrilldown(
              dashboardRuntime.views[0],
              { name: 'East', data: { region: 'East', sales: 120 } }
            )"""
        )
        card = page.locator('[data-view-id="sales_chart"]')
        assert card.locator(".view-title").text_content() == "East detail"
        assert card.locator("tbody tr").count() == 1

        card.locator(".drill-breadcrumb button").click()
        card.locator("#view-chart-sales_chart canvas").wait_for()
        assert card.locator(".view-title").text_content() == "Regional sales"
        assert card.locator(".drill-breadcrumb").evaluate(
            "(element) => getComputedStyle(element).display"
        ) == "none"
        assert not page_errors
        browser.close()
