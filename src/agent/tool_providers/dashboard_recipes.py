from __future__ import annotations

from typing import Any


# Recipes describe business intent and honest data contracts. They do not own
# colors; every recipe is rendered with the project palette.
DASHBOARD_RECIPES: dict[str, dict[str, Any]] = {
    "kpi-summary": {
        "view_types": {"metric_cards"},
        "data_shape": "three to six headline measures",
        "reading_mode": "glance",
    },
    "trend-line": {
        "view_types": {"chart"},
        "marks": {"line"},
        "data_shape": "one measure over ordered time",
        "reading_mode": "analysis",
    },
    "multi-series-trend": {
        "view_types": {"chart"},
        "marks": {"line"},
        "data_shape": "one measure over time grouped by one dimension",
        "reading_mode": "analysis",
    },
    "ranked-bars": {
        "view_types": {"chart"},
        "marks": {"bar"},
        "data_shape": "ordered category comparison",
        "reading_mode": "glance",
    },
    "category-columns": {
        "view_types": {"chart"},
        "marks": {"bar"},
        "data_shape": "small category comparison",
        "reading_mode": "glance",
    },
    "grouped-comparison": {
        "view_types": {"chart"},
        "marks": {"bar"},
        "data_shape": "two or three comparable series by category",
        "reading_mode": "analysis",
    },
    "volume-and-rate": {
        "view_types": {"chart"},
        "marks": {"bar", "line"},
        "data_shape": "absolute value and rate on two explicit axes",
        "reading_mode": "analysis",
    },
    "positive-negative": {
        "view_types": {"chart"},
        "marks": {"bar"},
        "data_shape": "signed category values around zero",
        "reading_mode": "glance",
    },
    "composition-donut": {
        "view_types": {"pie_chart"},
        "data_shape": "part-to-whole with no more than five categories",
        "reading_mode": "glance",
    },
    "relationship-scatter": {
        "view_types": {"chart"},
        "marks": {"scatter"},
        "data_shape": "relationship between two numeric measures",
        "reading_mode": "analysis",
    },
    "distribution-scatter": {
        "view_types": {"chart"},
        "marks": {"scatter"},
        "data_shape": "record-level distribution by category",
        "reading_mode": "detail",
    },
    "detail-table": {
        "view_types": {"table"},
        "data_shape": "auditable record details",
        "reading_mode": "detail",
    },
    "top-n-table": {
        "view_types": {"table"},
        "data_shape": "ranked records with several measures",
        "reading_mode": "detail",
    },
    "master-detail": {
        "view_types": {"chart", "table"},
        "data_shape": "summary view with explicit drilldown details",
        "reading_mode": "analysis",
    },
}


def validate_dashboard_recipe(recipe_id: str, view: dict[str, Any], path: str) -> None:
    recipe = DASHBOARD_RECIPES.get(recipe_id)
    if recipe is None:
        supported = ", ".join(sorted(DASHBOARD_RECIPES))
        raise ValueError(f"{path}.recipe unsupported: {recipe_id}; choose one of: {supported}")

    view_type = str(view.get("type") or "")
    if view_type not in recipe["view_types"]:
        raise ValueError(f"{path}.recipe '{recipe_id}' does not support view type '{view_type}'")

    allowed_marks = recipe.get("marks")
    if not allowed_marks or view_type != "chart":
        return
    actual_marks = {str(series.get("mark") or "bar") for series in view.get("series", [])}
    if not actual_marks.issubset(allowed_marks):
        raise ValueError(
            f"{path}.recipe '{recipe_id}' supports marks {sorted(allowed_marks)}, "
            f"received {sorted(actual_marks)}"
        )
