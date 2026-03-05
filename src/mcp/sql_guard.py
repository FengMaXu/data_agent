"""
SQL 安全拦截器 (SQL Guard)
在 MCP 调用前强制扫描 SQL，拦截危险操作

PRD 要求：
- 拦截 DROP, TRUNCATE, DELETE, ALTER, GRANT, INSERT, UPDATE
- 拦截 SQL 注入特征：--, UNION SELECT, ; 多语句
- 仅放行 SELECT / SHOW / DESCRIBE / EXPLAIN 类只读查询
"""

from __future__ import annotations

import re
import logging
from dataclasses import dataclass

logger = logging.getLogger("data_agent.mcp.sql_guard")


@dataclass
class SQLGuardResult:
    """安全检查结果"""

    allowed: bool
    reason: str = ""


# ─────────────────────────────────────────────
# 危险关键字（大小写不敏感）
# ─────────────────────────────────────────────

DANGEROUS_KEYWORDS = [
    r"\bDROP\b",
    r"\bTRUNCATE\b",
    r"\bDELETE\b",
    r"\bALTER\b",
    r"\bGRANT\b",
    r"\bREVOKE\b",
    r"\bINSERT\b",
    r"\bUPDATE\b",
    r"\bCREATE\b",
    r"\bRENAME\b",
    r"\bREPLACE\b",  # REPLACE INTO
    r"\bLOAD\s+DATA\b",
    r"\bINTO\s+OUTFILE\b",
    r"\bINTO\s+DUMPFILE\b",
]

# SQL 注入特征
INJECTION_PATTERNS = [
    r";\s*\w",  # 分号后跟语句（多语句注入）
    r"--\s",  # SQL 注释符
    r"/\*.*?\*/",  # 块注释
    r"\bUNION\s+(ALL\s+)?SELECT\b",  # UNION 注入
    r"\bEXEC\b",  # 执行存储过程
    r"\bXP_\w+",  # SQL Server 危险函数
    r"0x[0-9a-fA-F]+",  # 十六进制注入
]

# 允许的只读语句开头
SAFE_PREFIXES = [
    r"^\s*SELECT\b",
    r"^\s*SHOW\b",
    r"^\s*DESCRIBE\b",
    r"^\s*DESC\b",
    r"^\s*EXPLAIN\b",
    r"^\s*USE\b",
]


class SQLGuard:
    """
    SQL 安全网关

    在发送查询到 MCP Server 之前，强制检查 SQL 安全性。
    采用白名单（只允许只读查询）+ 黑名单（拦截危险关键字和注入特征）双重策略。
    """

    def __init__(self, strict: bool = True):
        """
        Args:
            strict: 严格模式。True = 白名单优先（只允许 SELECT 等），
                    False = 黑名单优先（只拦截危险操作）
        """
        self.strict = strict

        # 编译正则（性能优化）
        self._dangerous_patterns = [
            re.compile(p, re.IGNORECASE) for p in DANGEROUS_KEYWORDS
        ]
        self._injection_patterns = [
            re.compile(p, re.IGNORECASE | re.DOTALL) for p in INJECTION_PATTERNS
        ]
        self._safe_patterns = [re.compile(p, re.IGNORECASE) for p in SAFE_PREFIXES]

    def check(self, sql: str) -> SQLGuardResult:
        """
        检查 SQL 是否安全

        返回 SQLGuardResult(allowed=True/False, reason=原因)
        """
        if not sql or not sql.strip():
            return SQLGuardResult(allowed=False, reason="空查询")

        sql_clean = sql.strip()

        # ── 第一道：检查注入特征 ──
        for pattern in self._injection_patterns:
            if pattern.search(sql_clean):
                reason = f"🚨 安全拦截：检测到 SQL 注入特征 [{pattern.pattern}]"
                logger.warning(f"{reason} | SQL: {sql_clean[:100]}")
                return SQLGuardResult(allowed=False, reason=reason)

        # ── 第二道：危险关键字黑名单 ──
        for pattern in self._dangerous_patterns:
            if pattern.search(sql_clean):
                reason = f"🚨 安全拦截：检测到危险操作 [{pattern.pattern}]"
                logger.warning(f"{reason} | SQL: {sql_clean[:100]}")
                return SQLGuardResult(allowed=False, reason=reason)

        # ── 第三道：严格模式下的白名单检查 ──
        if self.strict:
            is_safe = any(p.match(sql_clean) for p in self._safe_patterns)
            if not is_safe:
                reason = f"🚨 安全拦截：非只读查询。仅允许 SELECT/SHOW/DESCRIBE/EXPLAIN"
                logger.warning(f"{reason} | SQL: {sql_clean[:100]}")
                return SQLGuardResult(allowed=False, reason=reason)

        return SQLGuardResult(allowed=True)
