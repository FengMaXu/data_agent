"""
3.3 SQL 自我沙盒审核 (Evaluation Grader / Runtime Validator)

在 execute_sql 正式执行前，先用 LIMIT 1 空跑或 EXPLAIN 检测
SQL 是否有语法错误或类型不匹配。如果有错，返回错误信息
让 LLM 自动进入下一轮反思修正。

验证流程：
  1. 对 SELECT 语句加上 LIMIT 1 空跑
  2. 如果空跑成功，执行原始查询
  3. 如果空跑失败，返回错误信息（LLM 会自动修正）
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any

from src.agent.types import AgentTool, AgentToolResult
from src.ai.base_provider import ToolResultContent
from src.mcp.callable import MCPCallable
from src.mcp.sql_guard import SQLGuard, SQLGuardResult

logger = logging.getLogger("data_agent.interaction.sql_evaluator")


@dataclass
class EvaluationResult:
    """SQL 评估结果"""

    passed: bool
    original_sql: str
    error_message: str = ""
    validation_method: str = ""  # "limit1" | "explain"


class SQLEvaluator:
    """
    SQL 沙盒评估器

    在正式执行查询前：
    1. 先通过 SQL Guard 安全检查
    2. 给 SELECT 加上 LIMIT 1 做空跑验证
    3. 空跑通过后再执行原始查询
    """

    def __init__(self, mcp_client: MCPCallable, sql_guard: SQLGuard | None = None):
        self._mcp = mcp_client
        self._guard = sql_guard or SQLGuard(strict=True)

    async def validate(self, sql: str) -> EvaluationResult:
        """
        验证 SQL 是否可以安全执行

        Returns:
            EvaluationResult(passed=True/False, ...)
        """
        sql_clean = sql.strip().rstrip(";")

        # Step 1: 安全检查
        guard_result = self._guard.check(sql_clean)
        if not guard_result.allowed:
            return EvaluationResult(
                passed=False,
                original_sql=sql,
                error_message=guard_result.reason,
                validation_method="guard",
            )

        # Step 2: 对 SELECT 语句做 LIMIT 1 空跑
        if re.match(r"^\s*SELECT\b", sql_clean, re.IGNORECASE):
            return await self._validate_with_limit(sql_clean)

        # 非 SELECT 语句（SHOW/DESCRIBE/EXPLAIN），直接放行
        return EvaluationResult(
            passed=True,
            original_sql=sql,
            validation_method="passthrough",
        )

    async def _validate_with_limit(self, sql: str) -> EvaluationResult:
        """用 LIMIT 1 空跑验证 SELECT 语句"""
        # 检查是否已有 LIMIT
        has_limit = bool(re.search(r"\bLIMIT\s+\d+", sql, re.IGNORECASE))

        if has_limit:
            # 已有 LIMIT，替换为 LIMIT 1
            test_sql = re.sub(
                r"\bLIMIT\s+\d+",
                "LIMIT 1",
                sql,
                flags=re.IGNORECASE,
            )
        else:
            test_sql = f"{sql} LIMIT 1"

        logger.info(f"[Evaluator] 空跑验证: {test_sql[:100]}...")

        try:
            result = await self._mcp.call_tool("execute_sql", {"query": test_sql})
            result_data = json.loads(result) if isinstance(result, str) else result

            if isinstance(result_data, dict) and result_data.get("error"):
                error_msg = result_data["error"]
                logger.warning(f"[Evaluator] 空跑失败: {error_msg}")
                return EvaluationResult(
                    passed=False,
                    original_sql=sql,
                    error_message=f"SQL 验证失败（LIMIT 1 空跑）：{error_msg}",
                    validation_method="limit1",
                )

            if isinstance(result_data, dict) and "SQL 错误" in str(result_data):
                logger.warning(f"[Evaluator] 空跑报错: {result_data}")
                return EvaluationResult(
                    passed=False,
                    original_sql=sql,
                    error_message=f"SQL 验证失败：{result}",
                    validation_method="limit1",
                )

            logger.info("[Evaluator] ✅ 空跑通过")
            return EvaluationResult(
                passed=True,
                original_sql=sql,
                validation_method="limit1",
            )

        except Exception as e:
            logger.error(f"[Evaluator] 空跑异常: {e}")
            return EvaluationResult(
                passed=False,
                original_sql=sql,
                error_message=f"SQL 验证异常: {str(e)}",
                validation_method="limit1",
            )

    def create_validated_execute_tool(self) -> AgentTool:
        """
        创建带沙盒验证的 execute_sql 工具

        替代原有的 execute_sql，在执行前自动进行 LIMIT 1 空跑验证。
        """

        evaluator = self

        async def validated_execute_sql(
            tool_call_id: str,
            arguments: dict[str, Any],
        ) -> AgentToolResult:
            query = arguments.get("query", "")

            # Step 1: 沙盒验证
            eval_result = await evaluator.validate(query)

            if not eval_result.passed:
                return AgentToolResult(
                    content=[
                        ToolResultContent(
                            text=(
                                f"⚠️ SQL 验证未通过，请修正后重试。\n\n"
                                f"**错误原因**: {eval_result.error_message}\n\n"
                                f"**你的 SQL**:\n```sql\n{query}\n```\n\n"
                                f"请分析错误原因，修正 SQL 后重新调用 execute_sql。"
                            )
                        )
                    ],
                    details={
                        "blocked": True,
                        "query": query,
                        "reason": eval_result.error_message,
                    },
                    is_error=True,
                )

            # Step 2: 验证通过，执行原始查询
            result = await evaluator._mcp.call_tool("execute_sql", {"query": query})
            return AgentToolResult(
                content=[ToolResultContent(text=result)],
                details={"query": query, "validated": True},
            )

        return AgentTool(
            name="execute_sql",
            description=(
                "执行一条只读 SQL 查询语句（仅限 SELECT/SHOW/DESCRIBE/EXPLAIN）。\n"
                "系统会自动先用 LIMIT 1 空跑验证 SQL 是否有语法或类型错误。\n"
                "如果验证失败，会返回错误详情，请分析原因后修正 SQL 重新调用。\n"
                "注意：不允许执行任何修改数据的操作。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "要执行的 SQL 查询语句",
                    },
                },
                "required": ["query"],
            },
            execute_fn=validated_execute_sql,
            label="执行 SQL（带验证）",
        )
