"""
Agent Loop —— 事件驱动的智能体主循环
借鉴 pi-mono/packages/agent/src/agent-loop.ts 的双循环架构

外循环：检查 follow-up 队列
内循环：LLM 调用 → 工具执行 → 检查 steering 队列

核心特性：
- Steering（打断）：工具执行间隙检查，有新消息则跳过剩余工具
- Follow-up（追加）：Agent 即将停止时检查，有追加则继续执行
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import AsyncIterator

from src.ai.base_provider import (
    AssistantResponse,
    Message,
    Role,
    StreamEvent,
    ToolCall,
    ToolDefinition,
    ToolResultContent,
)
from src.ai.gateway import AIGateway

from .event_stream import EventStream
from .types import (
    AgentContext,
    AgentEvent,
    AgentEventType,
    AgentLoopConfig,
    AgentTool,
    AgentToolResult,
)

logger = logging.getLogger("data_agent.agent.loop")


async def agent_loop(
    user_message: str,
    context: AgentContext,
    config: AgentLoopConfig,
    gateway: AIGateway,
) -> AsyncIterator[AgentEvent]:
    """
    启动 Agent 事件循环

    参数：
        user_message: 用户输入
        context: Agent 上下文（system_prompt, messages, tools）
        config: 循环配置（model, 队列回调等）
        gateway: AI 网关实例

    返回：
        异步迭代器，产出 AgentEvent
    """
    # 确保 system prompt 在 messages 最前面（仅首次注入）
    if context.system_prompt and (
        not context.messages or context.messages[0].role != Role.SYSTEM
    ):
        system_msg = Message(role=Role.SYSTEM, content=context.system_prompt)
        context.messages.insert(0, system_msg)

    # 添加用户消息到上下文
    user_msg = Message(role=Role.USER, content=user_message)
    context.messages.append(user_msg)
    new_messages: list[Message] = [user_msg]

    yield AgentEvent(type=AgentEventType.AGENT_START)
    yield AgentEvent(type=AgentEventType.MESSAGE_START, message=user_msg)
    yield AgentEvent(type=AgentEventType.MESSAGE_END, message=user_msg)

    # 检查是否有初始 steering 消息
    pending_messages: list[Message] = []
    if config.get_steering_messages:
        pending_messages = await config.get_steering_messages()

    turn_count = 0

    # ═══ 外循环：检查 follow-up 队列 ═══
    while True:
        has_more_tool_calls = True
        steering_after_tools: list[Message] | None = None

        # ═══ 内循环：LLM 调用 → 工具执行 → steering 检查 ═══
        while has_more_tool_calls or pending_messages:
            turn_count += 1
            if config.max_turns > 0 and turn_count > config.max_turns:
                logger.warning(f"达到最大轮次限制 ({config.max_turns})，强制停止")
                yield AgentEvent(
                    type=AgentEventType.ERROR,
                    error=f"达到最大轮次限制 ({config.max_turns})",
                )
                break

            yield AgentEvent(type=AgentEventType.TURN_START)

            # 注入 pending 消息（steering 或 follow-up）
            if pending_messages:
                for msg in pending_messages:
                    context.messages.append(msg)
                    new_messages.append(msg)
                    yield AgentEvent(type=AgentEventType.MESSAGE_START, message=msg)
                    yield AgentEvent(type=AgentEventType.MESSAGE_END, message=msg)
                pending_messages = []

            # ── 调用 LLM ──
            assistant_response: AssistantResponse | None = None
            full_text = ""

            # 构造工具定义
            tool_defs = (
                [t.to_definition() for t in context.tools] if context.tools else None
            )

            try:
                async for event in gateway.stream(
                    config.model,
                    context.messages,
                    tool_defs,
                    temperature=config.temperature,
                    max_tokens=config.max_tokens,
                ):
                    if event.type == "text_delta":
                        full_text += event.text
                        yield AgentEvent(
                            type=AgentEventType.MESSAGE_UPDATE,
                            text_delta=event.text,
                        )
                    elif event.type == "done":
                        assistant_response = event.response

            except Exception as e:
                logger.error(f"LLM 调用失败: {e}")
                yield AgentEvent(type=AgentEventType.ERROR, error=str(e))
                yield AgentEvent(
                    type=AgentEventType.AGENT_END,
                    all_messages=new_messages,
                )
                return

            if not assistant_response:
                yield AgentEvent(type=AgentEventType.ERROR, error="LLM 未返回响应")
                yield AgentEvent(
                    type=AgentEventType.AGENT_END,
                    all_messages=new_messages,
                )
                return

            # 将 assistant 消息加入上下文
            assistant_msg = Message(
                role=Role.ASSISTANT,
                content=assistant_response.content,
                tool_calls=assistant_response.tool_calls,
            )
            context.messages.append(assistant_msg)
            new_messages.append(assistant_msg)

            yield AgentEvent(type=AgentEventType.MESSAGE_START, message=assistant_msg)
            yield AgentEvent(type=AgentEventType.MESSAGE_END, message=assistant_msg)

            # ── 检查工具调用 ──
            tool_calls = assistant_response.tool_calls or []
            has_more_tool_calls = len(tool_calls) > 0

            if has_more_tool_calls:
                # ── 执行工具 ──
                tool_results, steering = await _execute_tool_calls(
                    context.tools,
                    tool_calls,
                    config,
                )

                # 将工具结果加入上下文
                for result_msg in tool_results:
                    context.messages.append(result_msg)
                    new_messages.append(result_msg)

                # 产出工具事件
                for result_msg in tool_results:
                    yield AgentEvent(
                        type=AgentEventType.MESSAGE_START,
                        message=result_msg,
                    )
                    yield AgentEvent(
                        type=AgentEventType.MESSAGE_END,
                        message=result_msg,
                    )

                steering_after_tools = steering

            yield AgentEvent(type=AgentEventType.TURN_END, message=assistant_msg)

            # 获取 steering 消息
            if steering_after_tools:
                pending_messages = steering_after_tools
                steering_after_tools = None
            elif config.get_steering_messages:
                pending_messages = await config.get_steering_messages()
            else:
                pending_messages = []

        # ═══ Agent 即将停止，检查 follow-up ═══
        if config.get_follow_up_messages:
            follow_ups = await config.get_follow_up_messages()
            if follow_ups:
                pending_messages = follow_ups
                continue

        # 没有更多消息，退出
        break

    yield AgentEvent(
        type=AgentEventType.AGENT_END,
        all_messages=new_messages,
    )


async def _execute_tool_calls(
    tools: list[AgentTool],
    tool_calls: list[ToolCall],
    config: AgentLoopConfig,
) -> tuple[list[Message], list[Message] | None]:
    """
    并发执行工具调用，支持结束前 Steering 打断检查

    返回：
        (tool_result_messages, steering_messages_or_None)
    """
    tool_map = {t.name: t for t in tools}

    async def _run_single_tool(tc: ToolCall) -> Message:
        tool = tool_map.get(tc.name)
        logger.info(f"[Tool] 开始执行: {tc.name}({tc.arguments})")

        if not tool:
            return [
                Message(
                    role=Role.TOOL_RESULT,
                    content=f"错误：工具 '{tc.name}' 不存在。可用工具: {', '.join(tool_map.keys())}",
                    tool_call_id=tc.id,
                    tool_name=tc.name,
                )
            ]

        try:
            result = await tool.execute(tc.id, tc.arguments)

            # Check if this tool result is a Skill Activation Payload Requesting Injection
            if result.details and result.details.get("_is_skill_activation"):
                # 1. Provide the UI message indicating the skill is loading
                ui_message = result.details.get("ui_message", "")
                user_msg = Message(
                    role=Role.USER,
                    content=ui_message,
                )

                # 2. Provide the hidden contextual injection payload
                model_message_injection = result.details.get(
                    "model_message_injection", ""
                )
                meta_msg = Message(
                    role=Role.USER,
                    content=model_message_injection,
                )

                # We return a list of messages instead of a single TOOL_RESULT message
                # In anthropic's spec, this is typically handled at the API boundaries (is_meta=True).
                # Here we simulate the context injection by pushing both into the history.
                return [
                    Message(
                        role=Role.TOOL_RESULT,
                        content=json.dumps(result.details, ensure_ascii=False),
                        tool_call_id=tc.id,
                        tool_name=tc.name,
                    ),
                    user_msg,
                    meta_msg,
                ]

            content_text = "\n".join(c.text for c in result.content if c.text)
            return [
                Message(
                    role=Role.TOOL_RESULT,
                    content=content_text,
                    tool_call_id=tc.id,
                    tool_name=tc.name,
                )
            ]
        except Exception as e:
            logger.error(f"[Tool] {tc.name} 执行失败: {e}")
            return [
                Message(
                    role=Role.TOOL_RESULT,
                    content=f"工具执行错误: {str(e)}",
                    tool_call_id=tc.id,
                    tool_name=tc.name,
                )
            ]

    # ── 使用 asyncio.gather 并行执行所有的工具调用 ──
    tasks = [_run_single_tool(tc) for tc in tool_calls]
    results_list_of_lists = await asyncio.gather(*tasks)

    # Flatten the lists of messages returned by the tools
    result_messages = []
    for msgs in results_list_of_lists:
        result_messages.extend(msgs)

    # ── Steering 检查：在工具全部执行完后检查打断队列 ──
    steering_messages: list[Message] | None = None
    if config.get_steering_messages:
        steering = await config.get_steering_messages()
        if steering:
            steering_messages = steering

    return result_messages, steering_messages
