"""Gate A — external contract fixtures run against the legacy Python implementations.

The JSON fixture files under tests/contract-fixtures/ are language-independent:
the same cases run against the TypeScript runtime
(packages/runtime/src/contract-fixtures.test.ts) and against the legacy Python
code here. A mismatch in either direction fails the A-K readiness gate.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.mcp.sql_guard import SQLGuard

FIXTURES_ROOT = Path(__file__).resolve().parent / "contract-fixtures"


def load_fixture(name: str) -> dict:
    return json.loads((FIXTURES_ROOT / name).read_text(encoding="utf-8"))


def sql_guard_cases() -> list[dict]:
    fixture = load_fixture("sql-guard.json")
    assert len(fixture["cases"]) >= 30
    return fixture["cases"]


@pytest.mark.parametrize("case", sql_guard_cases(), ids=lambda c: c["name"])
def test_sql_guard_contract(case: dict) -> None:
    guard = SQLGuard()
    result = guard.check(case["sql"])
    assert result.allowed is case["allowed"], (
        f"allowed mismatch for {case['name']!r}: got allowed={result.allowed} reason={result.reason!r}"
    )
    if "reasonContains" in case:
        assert case["reasonContains"] in result.reason
