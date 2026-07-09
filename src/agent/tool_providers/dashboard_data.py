from __future__ import annotations

import csv
from dataclasses import dataclass
import io
from typing import Any


@dataclass(frozen=True)
class DashboardDataset:
    id: str
    rows: list[dict[str, Any]]
    schema: list[dict[str, Any]]


def load_dashboard_datasets(spec: dict[str, Any], workspace: Any) -> dict[str, DashboardDataset]:
    datasets: dict[str, DashboardDataset] = {}
    for dataset in spec.get("datasets", []):
        dataset_id = str(dataset.get("id") or "").strip()
        source = dataset.get("source") or {}
        path = str(source.get("path") or "").strip()
        csv_content = workspace.read_file(path)
        rows = parse_csv_rows(csv_content)
        schema = dataset.get("schema") or _infer_schema(rows)
        rows = [_coerce_row(row, schema) for row in rows]
        _validate_fields(dataset_id, rows, schema)
        datasets[dataset_id] = DashboardDataset(id=dataset_id, rows=rows, schema=schema)
    return datasets


def parse_csv_rows(content: str) -> list[dict[str, str]]:
    if content.startswith("\ufeff"):
        content = content[1:]
    reader = csv.DictReader(io.StringIO(content))
    return [
        {key.strip(): value.strip() if value else "" for key, value in row.items() if key}
        for row in reader
    ]


def _infer_schema(rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    if not rows:
        return []
    return [
        {"name": field, "type": "number" if _looks_numeric(row.get(field)) else "string"}
        for field in rows[0].keys()
        for row in [rows[0]]
    ]


def _coerce_row(row: dict[str, str], schema: list[dict[str, Any]]) -> dict[str, Any]:
    coerced: dict[str, Any] = dict(row)
    for field in schema:
        name = str(field.get("name") or "")
        if not name:
            continue
        value = row.get(name, "")
        if field.get("type") == "number":
            coerced[name] = _to_number(value)
        else:
            coerced[name] = value
    return coerced


def _validate_fields(dataset_id: str, rows: list[dict[str, Any]], schema: list[dict[str, Any]]) -> None:
    if not rows:
        return
    available = set(rows[0].keys())
    for index, field in enumerate(schema):
        name = str(field.get("name") or "").strip()
        if name and name not in available:
            raise ValueError(f"datasets['{dataset_id}'].schema[{index}].name references missing CSV column '{name}'")


def _looks_numeric(value: Any) -> bool:
    if value is None or value == "":
        return False
    try:
        float(str(value).replace(",", "").replace("%", ""))
        return True
    except ValueError:
        return False


def _to_number(value: Any) -> int | float:
    if value is None or value == "":
        return 0
    text = str(value).strip().replace(",", "")
    if text.endswith("%"):
        text = text[:-1]
    try:
        parsed = float(text)
    except ValueError:
        return 0
    if parsed.is_integer():
        return int(parsed)
    return parsed
