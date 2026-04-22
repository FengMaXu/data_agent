"""
SQL 执行与导出控制层。

职责：
1. 所有 SQL 都先通过 SQL Guard 和空跑验证。
2. execute_sql 只返回受控预览，避免大结果集污染上下文窗口。
3. export_sql_to_csv 负责把完整查询结果直接落盘到 workspace，并返回下载信息。
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

from src.agent.types import AgentTool, AgentToolResult
from src.ai.base_provider import ToolResultContent
from src.mcp.callable import MCPCallable
from src.mcp.sql_guard import SQLGuard
from src.workspace.workspace_manager import WorkspaceManager

logger = logging.getLogger("data_agent.interaction.sql_evaluator")

_PREVIEW_MAX_ROWS = 20
_PREVIEW_MAX_CHARS = 12_000
_EXPORT_DIR = "data/exports"
_WINDOWS_RESERVED_FILENAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}


@dataclass
class EvaluationResult:
    """SQL 评估结果"""

    passed: bool
    original_sql: str
    error_message: str = ""
    validation_method: str = ""  # guard | limit1 | passthrough | template_fast_path


class SQLEvaluator:
    """统一的 SQL 安全预览/导出执行器。"""

    def __init__(
        self,
        mcp_client: MCPCallable,
        sql_guard: SQLGuard | None = None,
        workspace: WorkspaceManager | None = None,
    ):
        self._mcp = mcp_client
        self._guard = sql_guard or SQLGuard(strict=True)
        self._workspace = workspace

    async def validate(self, sql: str, *, trusted_template: bool = False) -> EvaluationResult:
        sql_clean = sql.strip().rstrip(";")

        guard_result = self._guard.check(sql_clean)
        if not guard_result.allowed:
            return EvaluationResult(
                passed=False,
                original_sql=sql,
                error_message=guard_result.reason,
                validation_method="guard",
            )

        if trusted_template and self._is_low_risk_template_query(sql_clean):
            return EvaluationResult(
                passed=True,
                original_sql=sql,
                validation_method="template_fast_path",
            )

        if re.match(r"^\s*SELECT\b", sql_clean, re.IGNORECASE):
            return await self._validate_with_limit(sql_clean)

        return EvaluationResult(
            passed=True,
            original_sql=sql,
            validation_method="passthrough",
        )

    def _is_low_risk_template_query(self, sql: str) -> bool:
        sql_upper = sql.upper()
        if not sql_upper.startswith("SELECT"):
            return False
        if " UNION " in sql_upper or " HAVING " in sql_upper:
            return False
        if re.search(r"\bWITH\b", sql_upper):
            return False
        if re.search(r"\bOVER\s*\(", sql_upper):
            return False
        if re.search(r"\bFROM\s*\(", sql_upper):
            return False
        if re.search(r"\bJOIN\b", sql_upper):
            return False
        if re.findall(r"\(\s*SELECT\b", sql_upper):
            return False
        return True

    async def _validate_with_limit(self, sql: str) -> EvaluationResult:
        has_limit = bool(re.search(r"\bLIMIT\s+\d+", sql, re.IGNORECASE))
        test_sql = (
            re.sub(r"\bLIMIT\s+\d+", "LIMIT 1", sql, flags=re.IGNORECASE)
            if has_limit
            else f"{sql} LIMIT 1"
        )

        logger.info("[Evaluator] 空跑验证: %s...", test_sql[:100])

        try:
            result = await self._mcp.call_tool("execute_sql", {"query": test_sql})
            payload = self._parse_payload(result)
            error_message = self._extract_error(payload)
            if error_message:
                logger.warning("[Evaluator] 空跑失败: %s", error_message)
                return EvaluationResult(
                    passed=False,
                    original_sql=sql,
                    error_message=f"SQL 验证失败（LIMIT 1 空跑）：{error_message}",
                    validation_method="limit1",
                )

            logger.info("[Evaluator] 空跑通过")
            return EvaluationResult(
                passed=True,
                original_sql=sql,
                validation_method="limit1",
            )
        except Exception as exc:
            logger.error("[Evaluator] 空跑异常: %s", exc)
            return EvaluationResult(
                passed=False,
                original_sql=sql,
                error_message=f"SQL 验证异常: {exc}",
                validation_method="limit1",
            )

    def _parse_payload(self, result: Any) -> Any:
        if isinstance(result, str):
            try:
                return json.loads(result)
            except json.JSONDecodeError:
                return result
        return result

    def _extract_error(self, payload: Any) -> str:
        if isinstance(payload, dict):
            error = payload.get("error")
            if error:
                return str(error)
            if "SQL 错误" in str(payload):
                return str(payload)
        return ""

    def _extract_rows(self, payload: Any) -> list[dict[str, Any]] | None:
        rows: Any = payload
        if isinstance(payload, dict) and isinstance(payload.get("data"), list):
            rows = payload["data"]

        if not isinstance(rows, list):
            return None

        normalized: list[dict[str, Any]] = []
        for row in rows:
            if isinstance(row, dict):
                normalized.append(row)
            else:
                normalized.append({"value": row})
        return normalized

    def _stringify_payload(self, payload: Any) -> str:
        if isinstance(payload, str):
            return payload
        return json.dumps(payload, ensure_ascii=False, indent=2)

    def _fit_preview_rows(self, rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], bool]:
        preview_rows = rows[:_PREVIEW_MAX_ROWS]
        truncated_by_chars = False

        while len(preview_rows) > 1:
            preview_text = json.dumps(preview_rows, ensure_ascii=False, indent=2)
            if len(preview_text) <= _PREVIEW_MAX_CHARS:
                return preview_rows, truncated_by_chars
            preview_rows = preview_rows[:-1]
            truncated_by_chars = True

        if preview_rows:
            preview_text = json.dumps(preview_rows, ensure_ascii=False, indent=2)
            if len(preview_text) > _PREVIEW_MAX_CHARS:
                clipped = preview_text[:_PREVIEW_MAX_CHARS]
                return [{"preview_truncated": clipped}], True

        return preview_rows, truncated_by_chars

    def _build_preview_text(self, result: Any) -> tuple[str, dict[str, Any]]:
        payload = self._parse_payload(result)
        raw_text = self._stringify_payload(payload)
        error_message = self._extract_error(payload)
        if error_message:
            return raw_text, {
                "truncated": False,
                "total_rows": 0,
                "preview_rows": 0,
                "recommend_export": False,
            }

        rows = self._extract_rows(payload)
        if rows is None:
            if len(raw_text) > _PREVIEW_MAX_CHARS:
                return (
                    raw_text[:_PREVIEW_MAX_CHARS]
                    + "\n\n[输出过长，已按字符截断。如需完整结构化数据，请改用 export_sql_to_csv。]",
                    {
                        "truncated": True,
                        "total_rows": 0,
                        "preview_rows": 0,
                        "recommend_export": True,
                    },
                )
            return raw_text, {
                "truncated": False,
                "total_rows": 0,
                "preview_rows": 0,
                "recommend_export": False,
            }

        total_rows = len(rows)
        preview_rows, truncated_by_chars = self._fit_preview_rows(rows)
        preview_text = json.dumps(preview_rows, ensure_ascii=False, indent=2)
        truncated = total_rows > len(preview_rows) or truncated_by_chars
        shown_rows = len(preview_rows)

        if truncated:
            preview_text += (
                "\n\n"
                f"[结果共 {total_rows} 行，当前仅展示前 {shown_rows} 行的受控预览。"
                "如需完整数据文件，请调用 export_sql_to_csv，避免把大结果集继续写入上下文。]"
            )
        elif total_rows == 0:
            preview_text += "\n\n[查询结果为空]"

        return preview_text, {
            "truncated": truncated,
            "total_rows": total_rows,
            "preview_rows": shown_rows,
            "recommend_export": truncated or total_rows > _PREVIEW_MAX_ROWS,
        }

    def _default_export_filename(self) -> str:
        return f"sql_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"

    def _normalize_export_filename(self, filename: str | None) -> str:
        raw_name = (filename or "").strip()
        if not raw_name:
            raw_name = self._default_export_filename()
        raw_name = Path(raw_name).name
        raw_name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", raw_name)

        if not raw_name.lower().endswith(".csv"):
            raw_name += ".csv"

        stem = Path(raw_name).stem.rstrip(" .")
        suffix = Path(raw_name).suffix or ".csv"

        if not stem:
            stem = Path(self._default_export_filename()).stem

        if stem.upper() in _WINDOWS_RESERVED_FILENAMES:
            stem = f"{stem}_export"

        normalized = f"{stem}{suffix}".rstrip(" .")
        if not normalized.lower().endswith(".csv"):
            normalized += ".csv"
        return normalized

    def _build_export_relative_path(self, filename: str | None) -> str:
        return f"{_EXPORT_DIR}/{self._normalize_export_filename(filename)}"

    async def _run_validated_query(
        self,
        query: str,
        *,
        trusted_template: bool = False,
    ) -> tuple[EvaluationResult, Any]:
        eval_result = await self.validate(query, trusted_template=trusted_template)
        if not eval_result.passed:
            return eval_result, None
        result = await self._mcp.call_tool("execute_sql", {"query": query})
        return eval_result, result

    async def export_query_to_csv(
        self,
        query: str,
        *,
        filename: str | None = None,
        trusted_template: bool = False,
    ) -> AgentToolResult:
        if self._workspace is None:
            return AgentToolResult(
                content=[ToolResultContent(text="导出失败：当前会话未提供 workspace。")],
                is_error=True,
            )

        eval_result, result = await self._run_validated_query(
            query,
            trusted_template=trusted_template,
        )
        if not eval_result.passed:
            return AgentToolResult(
                content=[
                    ToolResultContent(
                        text=(
                            "SQL 验证未通过，请修正后再导出。\n\n"
                            f"错误原因: {eval_result.error_message}\n\n"
                            f"SQL:\n```sql\n{query}\n```"
                        )
                    )
                ],
                details={
                    "blocked": True,
                    "query": query,
                    "reason": eval_result.error_message,
                    "validation_method": eval_result.validation_method,
                },
                is_error=True,
            )

        payload = self._parse_payload(result)
        error_message = self._extract_error(payload)
        if error_message:
            return AgentToolResult(
                content=[ToolResultContent(text=f"导出失败：{error_message}")],
                details={"query": query},
                is_error=True,
            )

        rows = self._extract_rows(payload)
        if rows is None:
            return AgentToolResult(
                content=[ToolResultContent(text="导出失败：当前查询结果不是可导出的表格数据。")],
                details={"query": query},
                is_error=True,
            )

        relative_path = self._build_export_relative_path(filename)
        saved_path = self._workspace.write_csv_rows(relative_path, rows)
        download_url = f"/workspace/files/download?path={quote(saved_path, safe='/')}"

        return AgentToolResult(
            content=[
                ToolResultContent(
                    text=(
                        f"已将查询结果导出为 CSV，共 {len(rows)} 行。\n"
                        f"文件路径: {saved_path}\n"
                        f"下载链接: {download_url}\n"
                        "如需在界面中展示文件入口，请继续调用 show_widget(kind='file_link', ...)"
                    )
                )
            ],
            details={
                "query": query,
                "validated": True,
                "validation_method": eval_result.validation_method,
                "trusted_template": trusted_template,
                "row_count": len(rows),
                "file_path": saved_path,
                "download_url": download_url,
                "file_type": "csv",
            },
        )

    def create_validated_execute_tool(self) -> AgentTool:
        evaluator = self

        async def validated_execute_sql(
            tool_call_id: str,
            arguments: dict[str, Any],
        ) -> AgentToolResult:
            query = arguments.get("query", "")
            trusted_template = bool(arguments.get("trusted_template", False))

            eval_result, result = await evaluator._run_validated_query(
                query,
                trusted_template=trusted_template,
            )
            if not eval_result.passed:
                return AgentToolResult(
                    content=[
                        ToolResultContent(
                            text=(
                                "SQL 验证未通过，请修正后重试。\n\n"
                                f"错误原因: {eval_result.error_message}\n\n"
                                f"你的 SQL:\n```sql\n{query}\n```\n\n"
                                "请分析错误原因，修正 SQL 后重新调用 execute_sql。"
                            )
                        )
                    ],
                    details={
                        "blocked": True,
                        "query": query,
                        "reason": eval_result.error_message,
                        "validation_method": eval_result.validation_method,
                    },
                    is_error=True,
                )

            preview_text, preview_meta = evaluator._build_preview_text(result)
            return AgentToolResult(
                content=[ToolResultContent(text=preview_text)],
                details={
                    "query": query,
                    "validated": True,
                    "validation_method": eval_result.validation_method,
                    "trusted_template": trusted_template,
                    **preview_meta,
                },
            )

        return AgentTool(
            name="execute_sql",
            description=(
                "执行只读 SQL 查询（仅限 SELECT/SHOW/DESCRIBE/EXPLAIN），"
                "并在真正执行前自动完成安全校验与 LIMIT 1 空跑验证。\n"
                "该工具只返回受控预览，用于看样例结果、校验 SQL 是否正确。\n"
                "如果你需要完整结果文件，必须改用 export_sql_to_csv，不要尝试用 execute_sql 拉取全量数据。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "要执行的 SQL 查询语句",
                    },
                    "trusted_template": {
                        "type": "boolean",
                        "description": "当 SQL 直接来自已命中的简单查询模板时传 true，以启用保守 fast-path；默认 false。",
                    },
                },
                "required": ["query"],
            },
            execute_fn=validated_execute_sql,
            label="执行 SQL（预览）",
        )

    def create_export_tool(self) -> AgentTool:
        evaluator = self

        async def export_sql_to_csv(
            tool_call_id: str,
            arguments: dict[str, Any],
        ) -> AgentToolResult:
            return await evaluator.export_query_to_csv(
                arguments.get("query", ""),
                filename=arguments.get("filename"),
                trusted_template=bool(arguments.get("trusted_template", False)),
            )

        return AgentTool(
            name="export_sql_to_csv",
            description=(
                "执行只读 SQL 查询，并将完整结果直接导出到当前 session 的 workspace CSV 文件。\n"
                "适用于导出完整明细、大结果集、交付数据文件。\n"
                "该工具不会把完整结果返回到对话上下文，因此是全量导出的首选。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "要导出的 SQL 查询语句",
                    },
                    "filename": {
                        "type": "string",
                        "description": "可选导出文件名，例如 sales_detail_april.csv。仅支持文件名，不支持绝对路径。",
                    },
                    "trusted_template": {
                        "type": "boolean",
                        "description": "当 SQL 直接来自已命中的简单查询模板时传 true，以启用保守 fast-path；默认 false。",
                    },
                },
                "required": ["query"],
            },
            execute_fn=export_sql_to_csv,
            label="导出 SQL 为 CSV",
        )
