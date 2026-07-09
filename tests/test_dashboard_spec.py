import pytest

from src.agent.tool_providers.dashboard_spec import (
    CURRENT_DASHBOARD_SPEC_VERSION,
    normalize_dashboard_arguments,
    validate_dashboard_spec,
)


def _valid_spec() -> dict:
    return {
        "version": "3",
        "title": "Industry",
        "datasets": [
            {
                "id": "summary",
                "source": {"type": "csv", "path": "data/summary.csv"},
                "schema": [
                    {"name": "行业大类", "type": "string"},
                    {"name": "销售额", "type": "number"},
                    {"name": "增速", "type": "number"},
                ],
            },
            {
                "id": "medium",
                "source": {"type": "csv", "path": "data/medium.csv"},
                "schema": [
                    {"name": "行业大类", "type": "string"},
                    {"name": "行业中类", "type": "string"},
                    {"name": "销售额", "type": "number"},
                    {"name": "增速", "type": "number"},
                ],
            },
        ],
        "views": [
            {
                "id": "sales_growth",
                "type": "chart",
                "coordinate": "cartesian",
                "title": "销售额与增速",
                "dataset": "summary",
                "x": {"field": "行业大类"},
                "axes": [
                    {"id": "sales_axis", "orient": "y", "name": "销售额"},
                    {"id": "growth_axis", "orient": "y", "name": "增速", "position": "right"},
                ],
                "series": [
                    {"field": "销售额", "mark": "bar", "axis": "sales_axis"},
                    {"field": "增速", "mark": "line", "axis": "growth_axis"},
                ],
            }
        ],
        "interactions": [
            {
                "source": {"view": "sales_growth", "event": "click"},
                "action": {
                    "type": "drilldown",
                    "target_dataset": "medium",
                    "match": {"source_field": "行业大类", "target_field": "行业大类"},
                    "target_view": {
                        "type": "chart",
                        "coordinate": "cartesian",
                        "x": {"field": "行业中类"},
                        "axes": [{"id": "sales_axis", "orient": "y", "name": "销售额"}],
                        "series": [{"field": "销售额", "mark": "bar", "axis": "sales_axis"}],
                    },
                },
            }
        ],
    }


def test_normalize_requires_v3_spec():
    spec = normalize_dashboard_arguments({"spec": _valid_spec(), "filename": "industry"})

    assert spec["version"] == CURRENT_DASHBOARD_SPEC_VERSION
    assert spec["title"] == "Industry"
    assert spec["filename"] == "industry"
    assert spec["views"][0]["id"] == "sales_growth"
    assert validate_dashboard_spec(spec) == []


def test_rejects_legacy_top_level_charts():
    with pytest.raises(ValueError, match="legacy charts input"):
        normalize_dashboard_arguments({
            "title": "Legacy",
            "charts": [{"title": "Sales", "chart_type": "bar"}],
        })


def test_rejects_spec_charts():
    spec = _valid_spec()
    spec["charts"] = [{"title": "Legacy", "chart_type": "bar"}]
    with pytest.raises(ValueError, match="spec.charts"):
        normalize_dashboard_arguments({"spec": spec})


def test_rejects_empty_views():
    spec = _valid_spec()
    spec["views"] = []
    with pytest.raises(ValueError, match="views must be a non-empty array"):
        normalize_dashboard_arguments({"spec": spec})


def test_rejects_unknown_axis_with_path():
    spec = _valid_spec()
    spec["views"][0]["series"][0]["axis"] = "missing_axis"
    with pytest.raises(ValueError, match=r"views\[0\]\.series\[0\]\.axis"):
        normalize_dashboard_arguments({"spec": spec})


def test_rejects_missing_axes():
    spec = _valid_spec()
    spec["views"][0].pop("axes")
    with pytest.raises(ValueError, match=r"views\[0\]\.axes must be a non-empty array"):
        normalize_dashboard_arguments({"spec": spec})


def _ascii_spec() -> dict:
    return {
        "version": "3",
        "title": "Ascii Dashboard",
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
                "dataset": "summary",
                "x": {"field": "category"},
                "axes": [{"id": "sales_axis", "orient": "y", "name": "Sales"}],
                "series": [{"field": "sales", "mark": "bar", "axis": "sales_axis"}],
            }
        ],
        "interactions": [
            {
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


def test_validates_table_drilldown_target_view():
    spec = normalize_dashboard_arguments({"spec": _ascii_spec()})

    assert validate_dashboard_spec(spec) == []


def test_rejects_table_drilldown_target_missing_columns_with_path():
    spec = _ascii_spec()
    spec["interactions"][0]["action"]["target_view"]["columns"] = []

    with pytest.raises(
        ValueError,
        match=r"interactions\[0\]\.action\.target_view\.columns must be a non-empty array",
    ):
        normalize_dashboard_arguments({"spec": spec})


def test_rejects_drilldown_match_unknown_source_field_with_path():
    spec = _ascii_spec()
    spec["interactions"][0]["action"]["match"]["source_field"] = "missing"

    with pytest.raises(
        ValueError,
        match=r"interactions\[0\]\.action\.match\.source_field references unknown field 'missing'",
    ):
        normalize_dashboard_arguments({"spec": spec})
