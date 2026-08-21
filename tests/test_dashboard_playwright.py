from pathlib import Path

import pytest

from src.agent.tool_providers.dashboard_compiler import compile_dashboard_runtime
from src.agent.tool_providers.dashboard_data import DashboardDataset
from src.agent.tool_providers.dashboard_renderer import render_dashboard_runtime_html


def _browser_runtime() -> dict:
    rows = [
        {"region": "East", "sales": 120},
        {"region": "West", "sales": 80},
    ]
    schema = [
        {"name": "region", "type": "string", "role": "dimension"},
        {"name": "sales", "type": "number", "role": "measure"},
    ]
    spec = {
        "version": "3",
        "title": "Browser verification",
        "layout": {"sidebar": False},
        "filters": [
            {
                "id": "region_filter",
                "type": "select",
                "label": "Region",
                "dataset": "sales",
                "field": "region",
                "targets": ["sales_chart", "sales_table"],
                "default": "",
                "all_label": "All",
            }
        ],
        "views": [
            {
                "id": "sales_chart",
                "type": "chart",
                "title": "East leads",
                "insight": "East is the largest region.",
                "recipe": "category-columns",
                "reading_mode": "glance",
                "source": "Browser fixture",
                "dataset": "sales",
                "layout": {"span": 8, "height": 420},
                "coordinate": "cartesian",
                "x": {"field": "region", "type": "category"},
                "axes": [{"id": "sales_axis", "orient": "y", "name": "Sales"}],
                "series": [{"name": "Sales", "field": "sales", "mark": "bar", "axis": "sales_axis"}],
            },
            {
                "id": "sales_table",
                "type": "table",
                "title": "Regional detail",
                "insight": "The table exposes the chart values.",
                "recipe": "detail-table",
                "reading_mode": "detail",
                "source": "Browser fixture",
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
    datasets = {"sales": DashboardDataset(id="sales", rows=rows, schema=schema)}
    return compile_dashboard_runtime(spec, datasets)


def test_dashboard_renders_and_filters_in_real_browser(tmp_path: Path):
    sync_api = pytest.importorskip("playwright.sync_api")
    echarts_path = Path(__file__).parents[1] / "frontend" / "node_modules" / "echarts" / "dist" / "echarts.min.js"
    if not echarts_path.exists():
        pytest.skip("local ECharts asset is not installed")

    html = render_dashboard_runtime_html(
        _browser_runtime(),
        assets={"mode": "custom", "echarts_url": echarts_path.resolve().as_uri()},
        exports=[],
    )
    html_path = tmp_path / "dashboard-browser.html"
    html_path.write_text(html, encoding="utf-8")

    with sync_api.sync_playwright() as playwright:
        try:
            browser = playwright.chromium.launch(headless=True)
        except sync_api.Error as exc:
            pytest.skip(f"Playwright Chromium is unavailable: {exc}")
        page_errors = []
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.goto(html_path.resolve().as_uri())
        page.locator("#view-chart-sales_chart canvas").wait_for()

        assert page.locator(".sidebar").count() == 0
        assert page.locator('[data-view-id="sales_table"] tbody tr').count() == 2
        assert page.locator("#view-chart-sales_chart").evaluate(
            "(element) => getComputedStyle(element).height"
        ) == "420px"
        assert page.locator("#view-chart-sales_chart canvas").evaluate(
            """canvas => {
              const context = canvas.getContext('2d');
              const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
              let colored = 0;
              for (let index = 0; index < pixels.length; index += 160) {
                const alpha = pixels[index + 3];
                if (alpha && (pixels[index] < 245 || pixels[index + 1] < 245 || pixels[index + 2] < 245)) colored += 1;
              }
              return colored;
            }"""
        ) > 10

        page.select_option('[data-filter-id="region_filter"]', "East")
        page.wait_for_function(
            "() => document.querySelectorAll('[data-view-id=\"sales_table\"] tbody tr').length === 1"
        )
        assert page.locator('[data-view-id="sales_table"] tbody tr td').first.text_content() == "East"

        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(100)
        assert page.evaluate(
            "() => document.documentElement.scrollWidth <= window.innerWidth + 1"
        )
        assert not page_errors
        browser.close()
