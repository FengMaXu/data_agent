from __future__ import annotations

import json
import re
from typing import Any

from .semantic_contract import SemanticDashboardValidationError, normalize_semantic_dashboard_spec


_DOCUMENT_RE = re.compile(
    r'<script\b(?=[^>]*\bid=["\']dashboard-document["\'])(?=[^>]*\btype=["\']application/json["\'])[^>]*>(.*?)</script\s*>',
    re.IGNORECASE | re.DOTALL,
)


def extract_semantic_dashboard_document(html: str) -> dict[str, Any]:
    if not isinstance(html, str) or not html.strip():
        raise SemanticDashboardValidationError("dashboard HTML is empty")
    matches = _DOCUMENT_RE.findall(html)
    if len(matches) != 1:
        raise SemanticDashboardValidationError([
            {"path": "dashboard-document", "code": "missing_or_duplicate_document", "message": "dashboard must contain exactly one dashboard-document JSON block"}
        ])
    try:
        value = json.loads(matches[0].strip())
    except json.JSONDecodeError as exc:
        raise SemanticDashboardValidationError([
            {"path": "dashboard-document", "code": "invalid_json", "message": "dashboard-document is not valid JSON"}
        ]) from exc
    if not isinstance(value, dict):
        raise SemanticDashboardValidationError("dashboard-document must contain an object")
    return normalize_semantic_dashboard_spec(value)


def json_script_payload(value: Any) -> str:
    """Encode JSON for a script element without allowing HTML termination."""
    return (
        json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        .replace("&", "\\u0026")
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
    )
