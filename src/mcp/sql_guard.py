"""SQL safety guard for MCP database calls."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

logger = logging.getLogger("data_agent.mcp.sql_guard")


@dataclass
class SQLGuardResult:
    """SQL safety check result."""

    allowed: bool
    reason: str = ""


DANGEROUS_KEYWORDS = [
    r"\bDROP\b",
    r"\bTRUNCATE\b",
    r"\bDELETE\b",
    r"\bALTER\b",
    r"\bGRANT\b",
    r"\bREVOKE\b",
    r"\bINSERT\b",
    r"\bUPDATE\b",
    r"\bCALL\b",
    r"\bCREATE\b",
    r"\bRENAME\b",
    r"\bREPLACE\b",  # REPLACE INTO
    r"\bLOAD\s+DATA\b",
    r"\bINTO\s+OUTFILE\b",
    r"\bINTO\s+DUMPFILE\b",
]

INJECTION_PATTERNS = [
    r";\s*\w",  # Multi-statement injection.
    # Standard SQL line comments (-- text) are valid and are not high-risk alone.
    r"/\*.*?\*/",  # Block comments can hide dangerous keywords.
    r"\bUNION\s+(ALL\s+)?SELECT\b",
    r"\bEXEC\b",
    r"\bXP_\w+",
]


class SQLGuard:
    """
    Defensively block high-risk SQL while allowing everything else by default.

    The ``strict`` argument is retained for backward-compatible construction,
    but the guard no longer enforces a statement-prefix whitelist. This allows
    valid read queries such as ``WITH ... SELECT`` while still blocking mutating
    or high-risk operations anywhere in the SQL text.
    """

    def __init__(self, strict: bool = True):
        self.strict = strict
        self._dangerous_patterns = [
            re.compile(pattern, re.IGNORECASE) for pattern in DANGEROUS_KEYWORDS
        ]
        self._injection_patterns = [
            re.compile(pattern, re.IGNORECASE | re.DOTALL)
            for pattern in INJECTION_PATTERNS
        ]

    def check(self, sql: str) -> SQLGuardResult:
        """Return whether the SQL is allowed to reach the MCP server."""

        if not sql or not sql.strip():
            return SQLGuardResult(allowed=False, reason="Empty query")

        sql_clean = sql.strip()

        for pattern in self._injection_patterns:
            if pattern.search(sql_clean):
                reason = f"SQL blocked: injection pattern detected [{pattern.pattern}]"
                logger.warning("%s | SQL: %s", reason, sql_clean[:100])
                return SQLGuardResult(allowed=False, reason=reason)

        for pattern in self._dangerous_patterns:
            if pattern.search(sql_clean):
                reason = f"SQL blocked: high-risk operation detected [{pattern.pattern}]"
                logger.warning("%s | SQL: %s", reason, sql_clean[:100])
                return SQLGuardResult(allowed=False, reason=reason)

        return SQLGuardResult(allowed=True)
