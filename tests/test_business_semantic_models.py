from __future__ import annotations

import re
from pathlib import Path

import yaml


SEMANTIC_DIR = (
    Path(__file__).resolve().parents[1]
    / ".data_agent"
    / "semantic-context"
    / "semantic-layer"
    / "default-mysql"
)
EXPECTED_MODELS = {
    "business_industry_sales_monthly",
    "business_industry_sales_trend",
    "business_industry_sales_ranking",
    "business_company_sales_monthly",
    "business_industry_growth_summary",
    "business_industry_growth_monthly",
    "business_new_four_above_summary",
    "business_new_four_above_growth",
    "business_new_four_above_companies",
    "business_new_four_above_by_industry",
    "business_lost_four_above_by_industry",
    "business_new_four_above_batch",
    "business_lost_four_above_batch",
}


def _models() -> list[tuple[Path, dict]]:
    result = []
    for path in sorted(SEMANTIC_DIR.glob("business_*.yaml")):
        result.append((path, yaml.safe_load(path.read_text(encoding="utf-8"))))
    return result


def test_verified_business_models_are_reusable_and_parameter_free() -> None:
    models = _models()
    assert {data["name"] for _path, data in models} == EXPECTED_MODELS
    assert {path.stem for path, _data in models} == EXPECTED_MODELS

    for path, data in models:
        sql = data["sql"]
        sql_without_leading_comments = re.sub(r"^\s*(?:--[^\n]*\n)+", "", sql)
        assert sql_without_leading_comments.strip().upper().startswith(("SELECT", "WITH")), path.name
        assert not re.search(r"'20\d{2}-\d{2}-\d{2}'", sql), path.name
        assert "春晓花开" not in sql, path.name
        assert "query_template" not in data.get("tags", {}).get("dbt", []), path.name
        assert data["measures"], path.name


def test_four_above_models_expose_both_comparison_months() -> None:
    comparison_models = {
        "business_new_four_above_summary",
        "business_new_four_above_growth",
        "business_new_four_above_companies",
        "business_new_four_above_by_industry",
        "business_new_four_above_batch",
        "business_lost_four_above_by_industry",
        "business_lost_four_above_batch",
    }
    for path, data in _models():
        if data["name"] not in comparison_models:
            continue
        columns = {column["name"] for column in data["columns"]}
        assert {"base_month", "target_month"} <= columns, path.name
        assert data["default_time_dimension"]["dbt"] in {"base_month", "target_month"}
