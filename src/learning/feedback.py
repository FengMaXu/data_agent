"""
4.2 用户反馈收集器 (Feedback Collector)

收集用户对查询结果的反馈（正确/错误），
错误反馈自动流入 Learning Store 形成学习闭环。

闭环流程：
  用户说"这个查询不对" → FeedbackCollector 收集 →
  LLM 诊断原因 → 修正 SQL → 保存到 LearningStore →
  下次同类查询自动避坑
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any

from src.agent.types import AgentTool, AgentToolResult
from src.ai.base_provider import ToolResultContent

from .learning_store import LearningStore, LearningEntry

logger = logging.getLogger("data_agent.learning.feedback")


@dataclass
class FeedbackRecord:
    """一条反馈记录"""

    timestamp: float = 0.0
    query: str = ""
    result_summary: str = ""
    is_correct: bool = True
    user_comment: str = ""


class FeedbackCollector:
    """
    用户反馈收集器

    与 LearningStore 联动：
    - 正面反馈 → 记录成功率
    - 负面反馈 → 触发学习闭环（LLM 诊断 + 保存教训）
    """

    def __init__(self, learning_store: LearningStore):
        self._learning_store = learning_store
        self._history: list[FeedbackRecord] = []
        # 记录最近执行的 SQL 用于反馈关联
        self._last_sql: str = ""
        self._last_result: str = ""

    def record_execution(self, sql: str, result: str) -> None:
        """记录最近执行的查询（供反馈时关联）"""
        self._last_sql = sql
        self._last_result = result[:500]  # 截断避免太长

    def record_feedback(
        self,
        is_correct: bool,
        user_comment: str = "",
        query: str = "",
    ) -> FeedbackRecord:
        """记录用户反馈"""
        record = FeedbackRecord(
            timestamp=time.time(),
            query=query or self._last_sql,
            result_summary=self._last_result,
            is_correct=is_correct,
            user_comment=user_comment,
        )
        self._history.append(record)

        if is_correct:
            logger.info(f"[Feedback] ✅ 正面反馈: {record.query[:60]}")
        else:
            logger.info(f"[Feedback] ❌ 负面反馈: {record.query[:60]} | {user_comment}")

        return record

    def save_negative_as_learning(
        self,
        failed_sql: str,
        error_message: str,
        fixed_sql: str = "",
        fix_explanation: str = "",
    ) -> str:
        """将负面反馈转化为学习记录"""
        entry = LearningEntry(
            failed_sql=failed_sql,
            error_message=error_message,
            error_type="logic",  # 用户反馈通常是逻辑错误
            fixed_sql=fixed_sql,
            fix_explanation=fix_explanation,
            source="user_feedback",
        )
        return self._learning_store.save(entry)

    def get_accuracy_stats(self) -> dict[str, Any]:
        """获取准确率统计"""
        total = len(self._history)
        if total == 0:
            return {"total": 0, "accuracy": 0.0}
        correct = sum(1 for f in self._history if f.is_correct)
        return {
            "total": total,
            "correct": correct,
            "incorrect": total - correct,
            "accuracy": round(correct / total * 100, 1),
        }

    def create_tools(self) -> list[AgentTool]:
        """创建反馈相关的 Agent 工具"""
        collector = self

        async def report_query_feedback(
            tool_call_id: str, arguments: dict[str, Any]
        ) -> AgentToolResult:
            """记录用户对查询结果的反馈"""
            is_correct = arguments.get("is_correct", True)
            comment = arguments.get("comment", "")
            query = arguments.get("query", "")

            record = collector.record_feedback(
                is_correct=is_correct,
                user_comment=comment,
                query=query,
            )

            if is_correct:
                stats = collector.get_accuracy_stats()
                return AgentToolResult(
                    content=[
                        ToolResultContent(
                            text=f"✅ 已记录正面反馈。当前准确率: {stats['accuracy']}% ({stats['correct']}/{stats['total']})"
                        )
                    ],
                )
            else:
                return AgentToolResult(
                    content=[
                        ToolResultContent(
                            text=(
                                f"❌ 已记录负面反馈。\n"
                                f"问题 SQL: `{record.query[:100]}`\n"
                                f"用户说明: {comment}\n\n"
                                f"请分析错误原因，修正查询后调用 `save_learning` 保存教训。"
                            )
                        )
                    ],
                )

        return [
            AgentTool(
                name="report_query_feedback",
                description=(
                    "记录用户对查询结果的反馈。\n"
                    "当用户表示'对的'或'不对'时调用此工具。\n"
                    "负面反馈会触发你进行诊断和修正的闭环。"
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "is_correct": {
                            "type": "boolean",
                            "description": "查询结果是否正确",
                        },
                        "comment": {
                            "type": "string",
                            "description": "用户的补充说明",
                        },
                        "query": {
                            "type": "string",
                            "description": "相关的 SQL（可选，默认使用最近执行的）",
                        },
                    },
                    "required": ["is_correct"],
                },
                execute_fn=report_query_feedback,
                label="查询反馈",
            ),
        ]
