"""
3.1 主动澄清机制 (Proactive Inquiry / Human-in-the-loop)

注册 `request_user_clarification` 工具供 LLM 调用。
当 LLM 遇到模糊指令时，可以主动向用户提问。

机制：
  1. LLM 调用 request_user_clarification(question, options)
  2. 工具执行时，通过 callback 向前端弹出提问
  3. 前端挂起等待用户输入
  4. 用户回答后，答案作为工具返回值返回给 LLM
  5. LLM 带着答案继续推理
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable

from src.agent.types import AgentTool, AgentToolResult
from src.ai.base_provider import ToolResultContent

logger = logging.getLogger("data_agent.interaction.clarification")

# 用户输入回调类型
# 接收 (question, options) → 返回用户的回答文本
ClarificationCallback = Callable[[str, list[str]], Awaitable[str]]


def create_clarification_tool(
    on_clarification: ClarificationCallback,
) -> AgentTool:
    """
    创建主动澄清工具

    Args:
        on_clarification: 前端回调函数。
            当 LLM 需要澄清时被调用，参数为 (question, options)。
            该函数应当阻塞等待用户输入并返回用户的回答。

    示例 (CLI):
        async def ask_user(question, options):
            print(f"🤔 Agent 提问: {question}")
            if options:
                for i, opt in enumerate(options, 1):
                    print(f"  {i}. {opt}")
            return input("你的回答: ")

        tool = create_clarification_tool(ask_user)
    """

    async def request_user_clarification(
        tool_call_id: str,
        arguments: dict[str, Any],
    ) -> AgentToolResult:
        question = arguments.get("question", "")
        options = arguments.get("options", [])

        if not question:
            return AgentToolResult(
                content=[ToolResultContent(text="错误：必须提供问题内容。")],
                is_error=True,
            )

        logger.info(f"[Clarification] LLM 提问: {question}")

        try:
            # 调用前端回调，挂起等待用户输入
            user_answer = await on_clarification(question, options)

            logger.info(f"[Clarification] 用户回答: {user_answer}")

            return AgentToolResult(
                content=[ToolResultContent(text=f"用户回答：{user_answer}")],
                details={"question": question, "answer": user_answer},
            )

        except asyncio.CancelledError:
            return AgentToolResult(
                content=[ToolResultContent(text="用户取消了回答。请换一种方式继续。")],
                details={"question": question, "cancelled": True},
            )
        except Exception as e:
            logger.error(f"[Clarification] 获取用户回答失败: {e}")
            return AgentToolResult(
                content=[
                    ToolResultContent(
                        text=f"获取用户回答失败: {str(e)}。请基于你的判断继续。"
                    )
                ],
                is_error=True,
            )

    return AgentTool(
        name="request_user_clarification",
        description=(
            "当用户的问题或指令不够清晰时，主动向用户提问以获取澄清。"
            "例如用户说'查一下大客户'但没定义'大'的标准，你应该调用此工具提问。\n\n"
            "使用时机：\n"
            "- 业务术语模糊（如'大客户'、'高价值'、'最近'）且知识库中无定义\n"
            "- 查询条件缺失（如时间范围、部门、地区未指定）\n"
            "- 有多种理解方式需要确认\n\n"
            "你可以提供 options 列表给用户选择，也可以让用户自由输入。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": "向用户提出的澄清问题",
                },
                "options": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "可选：提供给用户的选项列表。留空则允许自由输入。",
                },
            },
            "required": ["question"],
        },
        execute_fn=request_user_clarification,
        label="主动提问",
    )
