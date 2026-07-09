"""
Agent Loop —— 事件驱动的智能体主循环
借鉴 pi-mono/packages/agent/src/agent-loop.ts 的双循环架构

外循环：检查 follow-up 队列
内循环：LLM 调用 → 工具执行 → 检查 steering 队列

核心特性：
- Steering（打断）：工具执行间隙检查，有新消息则跳过剩余工具
- Follow-up（追加）：Agent 即将停止时检查，有追加则继续执行
- Cooperative stop：在 LLM 前、LLM 后、工具批次后、下一轮前检查停止请求
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import AsyncIterator

from src.ai.base_provider import (
    Message,
    Role,
    ToolCall,
    ToolResultContent,
    generate_message_id,
)
from src.ai.gateway import AIGateway

from .types import (
    AgentContext,
    AgentEvent,
    AgentEventType,
    AgentLoopConfig,
    AgentTool,
    AgentToolResult,
    ToolExecutionOutcome,
)

logger = logging.getLogger("data_agent.agent.loop")

DEFAULT_READ_RESOURCE_LIMITS = {
    "knowledge": 8,
    "context_fs": 8,
    "workspace_fs": 8,
    "learning": 4,
    "business_knowledge": 8,
    "db": 3,
    "mcp": 4,
    "memory": 16,
    "network": 4,
    "default": 4,
}


def _tool_names(tools: list[AgentTool]) -> list[str]:
    return [tool.name for tool in tools]


def _refresh_context_tools(context: AgentContext, *, turn_count: int = 0) -> None:
    catalog = getattr(context, "tool_catalog", None)
    visible_tools = getattr(catalog, "visible_tools", None)
    if visible_tools is None:
        return

    before = _tool_names(context.tools)
    context.tools = list(visible_tools())
    after = _tool_names(context.tools)
    if before == after:
        return

    timing = context.timing
    if timing is not None:
        timing.record_tool_stage(
            "tool_catalog_refresh",
            tool_name="tool_search",
            tool_call_id="",
            turn=turn_count,
            visible_tool_count=len(after),
            loaded_tool_count=getattr(catalog, "loaded_tool_count", max(0, len(after) - 1)),
            deferred_tool_count=getattr(catalog, "deferred_tool_count", 0),
        )


async def _should_stop(config: AgentLoopConfig) -> bool:
    if config.should_stop is None:
        return False
    return await config.should_stop()


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
    timing = config.timing or context.timing
    if timing is not None and context.timing is None:
        context.timing = timing
    if context.system_prompt and (
        not context.messages or context.messages[0].role != Role.SYSTEM
    ):
        system_msg = Message(
            role=Role.SYSTEM,
            content=context.system_prompt,
            message_id=generate_message_id(),
        )
        context.messages.insert(0, system_msg)

    user_msg = Message(
        role=Role.USER,
        content=user_message,
        message_id=generate_message_id(),
    )
    context.messages.append(user_msg)
    new_messages: list[Message] = [user_msg]

    yield AgentEvent(type=AgentEventType.AGENT_START)
    yield AgentEvent(
        type=AgentEventType.MESSAGE_START,
        message=user_msg,
        message_id=user_msg.message_id or "",
    )
    yield AgentEvent(
        type=AgentEventType.MESSAGE_END,
        message=user_msg,
        message_id=user_msg.message_id or "",
    )

    pending_messages: list[Message] = []
    if config.get_steering_messages:
        pending_messages = await config.get_steering_messages()

    turn_count = 0
    stop_reason = "completed"

    while True:
        if await _should_stop(config):
            stop_reason = "stopped"
            break

        has_more_tool_calls = True
        steering_after_tools: list[Message] | None = None

        while has_more_tool_calls or pending_messages:
            if await _should_stop(config):
                stop_reason = "stopped"
                break

            turn_count += 1
            if timing is not None:
                timing.add_counter("turns")
                timing.record_llm_stage(
                    "turn_start",
                    turn=turn_count,
                    message_count=len(context.messages),
                )

            if config.max_turns > 0 and turn_count > config.max_turns:
                logger.warning("达到最大轮次限制 (%s)，强制停止", config.max_turns)
                yield AgentEvent(
                    type=AgentEventType.ERROR,
                    error=f"达到最大轮次限制 ({config.max_turns})",
                )
                stop_reason = "error"
                break

            yield AgentEvent(type=AgentEventType.TURN_START)

            if pending_messages:
                for msg in pending_messages:
                    if not msg.message_id:
                        msg.message_id = generate_message_id()
                    context.messages.append(msg)
                    new_messages.append(msg)
                    yield AgentEvent(
                        type=AgentEventType.MESSAGE_START,
                        message=msg,
                        message_id=msg.message_id or "",
                    )
                    yield AgentEvent(
                        type=AgentEventType.MESSAGE_END,
                        message=msg,
                        message_id=msg.message_id or "",
                    )
                pending_messages = []

            if await _should_stop(config):
                stop_reason = "stopped"
                break

            assistant_response = None
            full_text = ""
            stream_message_id = ""
            _refresh_context_tools(context, turn_count=turn_count)
            tool_defs = [t.to_definition() for t in context.tools] if context.tools else None
            llm_call_number = timing.add_counter("llm_calls") if timing is not None else 0
            llm_call_started_at = time.perf_counter()
            llm_first_text_recorded = False
            llm_first_tool_recorded = False

            if timing is not None:
                timing.record_llm_stage(
                    "llm_call_start",
                    turn=turn_count,
                    llm_call=llm_call_number,
                    message_count=len(context.messages),
                    tool_count=len(tool_defs or []),
                )

            try:
                async for event in gateway.stream(
                    config.model,
                    context.messages,
                    tool_defs,
                    temperature=config.temperature,
                    max_tokens=config.max_tokens,
                    timing=timing,
                ):
                    if event.type == "message_start":
                        stream_message_id = event.message_id or stream_message_id
                        yield AgentEvent(
                            type=AgentEventType.MESSAGE_START,
                            message_id=stream_message_id,
                        )
                    elif event.type == "text_delta":
                        full_text += event.text
                        stream_message_id = event.message_id or stream_message_id
                        if timing is not None and not llm_first_text_recorded:
                            llm_first_text_recorded = True
                            timing.record_llm_stage(
                                "llm_first_text",
                                turn=turn_count,
                                llm_call=llm_call_number,
                            )
                        yield AgentEvent(
                            type=AgentEventType.MESSAGE_UPDATE,
                            message_id=stream_message_id,
                            text_delta=event.text,
                        )
                    elif event.type == "reasoning_delta":
                        stream_message_id = event.message_id or stream_message_id
                        yield AgentEvent(
                            type=AgentEventType.REASONING_UPDATE,
                            message_id=stream_message_id,
                            reasoning_delta=event.text,
                        )
                    elif event.type == "tool_call_start" and event.tool_call:
                        stream_message_id = event.message_id or stream_message_id
                        if timing is not None and not llm_first_tool_recorded:
                            llm_first_tool_recorded = True
                            timing.record_llm_stage(
                                "llm_first_tool_call",
                                turn=turn_count,
                                llm_call=llm_call_number,
                                tool_name=event.tool_call.name,
                            )
                        yield AgentEvent(
                            type=AgentEventType.TOOL_CALL_START,
                            message_id=stream_message_id,
                            tool_call_id=event.tool_call.id,
                            tool_name=event.tool_call.name,
                            tool_args=event.tool_call.arguments,
                        )
                    elif event.type == "tool_call_delta":
                        stream_message_id = event.message_id or stream_message_id
                        yield AgentEvent(
                            type=AgentEventType.TOOL_CALL_DELTA,
                            message_id=stream_message_id,
                            tool_call_id=event.tool_call_id or "",
                            tool_name=event.tool_name or "",
                            partial_arguments=event.partial_arguments,
                        )
                    elif event.type == "done":
                        assistant_response = event.response
            except Exception as exc:
                logger.error("LLM 调用失败: %s", exc)
                yield AgentEvent(type=AgentEventType.ERROR, error=str(exc))
                yield AgentEvent(
                    type=AgentEventType.AGENT_END,
                    all_messages=new_messages,
                    stop_reason="error",
                )
                return
            finally:
                if timing is not None:
                    usage = assistant_response.usage if assistant_response else None
                    timing.record_llm_stage(
                        "llm_call_done",
                        turn=turn_count,
                        llm_call=llm_call_number,
                        duration_ms=round((time.perf_counter() - llm_call_started_at) * 1000, 3),
                        prompt_tokens=usage.prompt_tokens if usage else 0,
                        completion_tokens=usage.completion_tokens if usage else 0,
                        cache_read_tokens=usage.cache_read_tokens if usage else 0,
                        cache_write_tokens=usage.cache_write_tokens if usage else 0,
                        total_tokens=usage.total_tokens if usage else 0,
                    )

            if await _should_stop(config):
                stop_reason = "stopped"
                break

            if not assistant_response:
                yield AgentEvent(type=AgentEventType.ERROR, error="LLM 未返回响应")
                yield AgentEvent(
                    type=AgentEventType.AGENT_END,
                    all_messages=new_messages,
                    stop_reason="error",
                )
                return

            assistant_msg = Message(
                role=Role.ASSISTANT,
                content=assistant_response.content or full_text,
                tool_calls=assistant_response.tool_calls,
                message_id=assistant_response.message_id or stream_message_id,
                reasoning_content=assistant_response.reasoning_content,
            )
            context.messages.append(assistant_msg)
            new_messages.append(assistant_msg)

            yield AgentEvent(
                type=AgentEventType.MESSAGE_END,
                message=assistant_msg,
                message_id=assistant_msg.message_id or "",
            )

            tool_calls = assistant_response.tool_calls or []
            has_more_tool_calls = len(tool_calls) > 0

            if has_more_tool_calls:
                if timing is not None:
                    timing.record_tool_stage(
                        "tool_batch_start",
                        tool_name="batch",
                        tool_call_id=assistant_msg.message_id or "",
                        count=len(tool_calls),
                        turn=turn_count,
                    )
                for tc in tool_calls:
                    yield AgentEvent(
                        type=AgentEventType.TOOL_EXECUTION_START,
                        message_id=assistant_msg.message_id or "",
                        tool_call_id=tc.id,
                        tool_name=tc.name,
                        tool_args=tc.arguments,
                    )
                tool_outcomes, steering = await _execute_tool_calls(
                    context.tools,
                    tool_calls,
                    config,
                    assistant_msg.message_id or "",
                    context,
                )
                _refresh_context_tools(context, turn_count=turn_count)

                tool_result_messages: list[Message] = []
                follow_up_context_messages: list[Message] = []
                for outcome in tool_outcomes:
                    for result_msg in outcome.context_messages:
                        if result_msg.role == Role.TOOL_RESULT:
                            tool_result_messages.append(result_msg)
                        else:
                            follow_up_context_messages.append(result_msg)

                for result_msg in tool_result_messages + follow_up_context_messages:
                    context.messages.append(result_msg)
                    new_messages.append(result_msg)
                    yield AgentEvent(
                        type=AgentEventType.MESSAGE_START,
                        message=result_msg,
                        message_id=result_msg.message_id or assistant_msg.message_id or "",
                    )
                    yield AgentEvent(
                        type=AgentEventType.MESSAGE_END,
                        message=result_msg,
                        message_id=result_msg.message_id or assistant_msg.message_id or "",
                    )

                for outcome in tool_outcomes:
                    yield AgentEvent(
                        type=AgentEventType.TOOL_CALL_END,
                        message_id=assistant_msg.message_id or "",
                        tool_call_id=outcome.tool_call.id,
                        tool_name=outcome.tool_call.name,
                        tool_args=outcome.tool_call.arguments,
                    )
                    yield AgentEvent(
                        type=AgentEventType.TOOL_EXECUTION_END,
                        message_id=assistant_msg.message_id or "",
                        tool_call_id=outcome.tool_call.id,
                        tool_name=outcome.tool_call.name,
                        tool_args=outcome.tool_call.arguments,
                        tool_result=outcome.tool_result,
                        widget_id=str(outcome.tool_result.details.get("widget_id", "")),
                    )

                if timing is not None:
                    timing.record_tool_stage(
                        "tool_batch_done",
                        tool_name="batch",
                        tool_call_id=assistant_msg.message_id or "",
                        count=len(tool_calls),
                        turn=turn_count,
                    )

                if await _should_stop(config):
                    stop_reason = "stopped"
                    break

                steering_after_tools = steering

            yield AgentEvent(
                type=AgentEventType.TURN_END,
                message=assistant_msg,
                message_id=assistant_msg.message_id or "",
            )
            if timing is not None:
                timing.record_llm_stage(
                    "turn_done",
                    turn=turn_count,
                    has_tool_calls=has_more_tool_calls,
                    stop_reason=assistant_response.stop_reason,
                )

            if steering_after_tools:
                pending_messages = steering_after_tools
                steering_after_tools = None
            elif config.get_steering_messages:
                pending_messages = await config.get_steering_messages()
            else:
                pending_messages = []

        if stop_reason == "stopped":
            break
        if stop_reason == "error":
            break

        if config.get_follow_up_messages:
            follow_ups = await config.get_follow_up_messages()
            if follow_ups:
                pending_messages = follow_ups
                continue

        break

    yield AgentEvent(
        type=AgentEventType.AGENT_END,
        all_messages=new_messages,
        stop_reason=stop_reason,
    )


async def _execute_tool_calls(
    tools: list[AgentTool],
    tool_calls: list[ToolCall],
    config: AgentLoopConfig,
    message_id: str,
    context: AgentContext | None = None,
) -> tuple[list[ToolExecutionOutcome], list[Message] | None]:
    """
    并发执行工具调用，支持结束前 Steering 打断检查

    返回：
        (tool_execution_outcomes, steering_messages_or_None)
    """
    tool_map = {t.name: t for t in tools}
    timing = config.timing
    catalog = getattr(context, "tool_catalog", None)

    def _autoload_deferred_tool(tool_name: str, tool_call_id: str) -> AgentTool | None:
        if tool_name in tool_map:
            return tool_map[tool_name]
        load_tool_name = getattr(catalog, "load_tool_name", None)
        visible_tools = getattr(catalog, "visible_tools", None)
        if load_tool_name is None or visible_tools is None:
            return None
        tool = load_tool_name(tool_name)
        if tool is None:
            return None
        refreshed_tools = list(visible_tools())
        tool_map.clear()
        tool_map.update({refreshed_tool.name: refreshed_tool for refreshed_tool in refreshed_tools})
        if context is not None:
            context.tools = refreshed_tools
        if timing is not None:
            timing.record_tool_stage(
                "tool_catalog_autoload",
                tool_name=tool_name,
                tool_call_id=tool_call_id,
                visible_tool_count=len(refreshed_tools),
                loaded_tool_count=getattr(catalog, "loaded_tool_count", max(0, len(refreshed_tools) - 1)),
                deferred_tool_count=getattr(catalog, "deferred_tool_count", 0),
            )
        return tool

    for tool_call in tool_calls:
        _autoload_deferred_tool(tool_call.name, tool_call.id)

    def _tool_policy(tool: AgentTool | None):
        return getattr(tool, "execution_policy", None)

    def _is_read_only_call(tc: ToolCall) -> bool:
        policy = _tool_policy(tool_map.get(tc.name))
        return bool(policy and policy.read_only)

    def _resource_limit(tool: AgentTool) -> int:
        policy = _tool_policy(tool)
        resource = str(getattr(policy, "resource", "") or "default")
        configured = getattr(policy, "max_concurrency", None)
        if configured is not None:
            try:
                return max(1, int(configured))
            except (TypeError, ValueError):
                return 1
        return DEFAULT_READ_RESOURCE_LIMITS.get(resource, DEFAULT_READ_RESOURCE_LIMITS["default"])

    def _resource_name(tool: AgentTool) -> str:
        policy = _tool_policy(tool)
        return str(getattr(policy, "resource", "") or "default")

    def _build_read_semaphores() -> dict[str, asyncio.Semaphore]:
        limits: dict[str, int] = {}
        for tc in tool_calls:
            tool = tool_map.get(tc.name)
            if not tool:
                continue
            policy = _tool_policy(tool)
            if not policy or not policy.read_only:
                continue
            resource = _resource_name(tool)
            limit = _resource_limit(tool)
            limits[resource] = min(limits.get(resource, limit), limit)
        return {resource: asyncio.Semaphore(limit) for resource, limit in limits.items()}

    read_semaphores = _build_read_semaphores()

    async def _run_single_tool(tc: ToolCall) -> ToolExecutionOutcome:
        tool = tool_map.get(tc.name) or _autoload_deferred_tool(tc.name, tc.id)
        logger.info("[Tool] 开始执行: %s", tc.name)
        if timing is not None:
            policy = _tool_policy(tool)
            timing.add_counter("tool_calls")
            timing.record_tool_stage(
                "tool_start",
                tool_name=tc.name,
                tool_call_id=tc.id,
                read_only=bool(policy and policy.read_only),
                resource=str(getattr(policy, "resource", "") or ""),
            )
        started_at = time.perf_counter()

        if not tool:
            tool_search_hint = ""
            if "tool_search" in tool_map:
                tool_search_hint = (
                    " Use tool_search with intent keywords or select:<tool_name> "
                    "to load deferred tools first."
                )
            error_text = f"错误：工具 '{tc.name}' 不存在。可用工具: {', '.join(tool_map.keys())}"
            if tool_search_hint:
                error_text = f"{error_text}.{tool_search_hint}"
            result = AgentToolResult(
                content=[ToolResultContent(type="text", text=error_text)],
                details={"error": error_text},
                is_error=True,
            )
            if timing is not None:
                timing.record_tool_stage(
                    "tool_done",
                    tool_name=tc.name,
                    tool_call_id=tc.id,
                    duration_ms=round((time.perf_counter() - started_at) * 1000, 3),
                    is_error=True,
                )
            return ToolExecutionOutcome(
                tool_call=tc,
                tool_result=result,
                context_messages=[
                    Message(
                        role=Role.TOOL_RESULT,
                        content=error_text,
                        tool_call_id=tc.id,
                        tool_name=tc.name,
                        message_id=message_id,
                    )
                ],
                is_error=True,
                error_message=error_text,
            )

        try:
            result = await tool.execute(tc.id, tc.arguments)

            if result.details and result.details.get("_is_skill_activation"):
                ui_message = result.details.get("ui_message", "")
                user_msg = Message(
                    role=Role.USER,
                    content=ui_message,
                    message_id=message_id,
                )
                model_message_injection = result.details.get(
                    "model_message_injection", ""
                )
                meta_msg = Message(
                    role=Role.USER,
                    content=model_message_injection,
                    message_id=message_id,
                )
                if timing is not None:
                    timing.record_tool_stage(
                        "tool_done",
                        tool_name=tc.name,
                        tool_call_id=tc.id,
                        duration_ms=round((time.perf_counter() - started_at) * 1000, 3),
                        is_error=bool(result.is_error),
                    )
                return ToolExecutionOutcome(
                    tool_call=tc,
                    tool_result=result,
                    context_messages=[
                        Message(
                            role=Role.TOOL_RESULT,
                            content=json.dumps(result.details, ensure_ascii=False),
                            tool_call_id=tc.id,
                            tool_name=tc.name,
                            message_id=message_id,
                        ),
                        user_msg,
                        meta_msg,
                    ],
                )

            content_text = "\n".join(c.text for c in result.content if c.text)
            if timing is not None:
                timing.record_tool_stage(
                    "tool_done",
                    tool_name=tc.name,
                    tool_call_id=tc.id,
                    duration_ms=round((time.perf_counter() - started_at) * 1000, 3),
                    is_error=bool(result.is_error),
                )
            return ToolExecutionOutcome(
                tool_call=tc,
                tool_result=result,
                context_messages=[
                    Message(
                        role=Role.TOOL_RESULT,
                        content=content_text,
                        tool_call_id=tc.id,
                        tool_name=tc.name,
                        message_id=message_id,
                    )
                ],
                is_error=result.is_error,
                error_message=content_text if result.is_error else "",
            )
        except Exception as exc:
            logger.error("[Tool] %s 执行失败: %s", tc.name, exc)
            error_text = f"工具执行错误: {str(exc)}"
            error_result = AgentToolResult(
                content=[ToolResultContent(type="text", text=error_text)],
                details={"error": str(exc)},
                is_error=True,
            )
            if timing is not None:
                timing.record_tool_stage(
                    "tool_done",
                    tool_name=tc.name,
                    tool_call_id=tc.id,
                    duration_ms=round((time.perf_counter() - started_at) * 1000, 3),
                    is_error=True,
                )
            return ToolExecutionOutcome(
                tool_call=tc,
                tool_result=error_result,
                context_messages=[
                    Message(
                        role=Role.TOOL_RESULT,
                        content=error_text,
                        tool_call_id=tc.id,
                        tool_name=tc.name,
                        message_id=message_id,
                    )
                ],
                is_error=True,
                error_message=error_text,
            )

    async def _run_read_tool(tc: ToolCall) -> ToolExecutionOutcome:
        tool = tool_map.get(tc.name)
        if tool is None:
            return await _run_single_tool(tc)
        semaphore = read_semaphores.get(_resource_name(tool))
        if semaphore is None:
            return await _run_single_tool(tc)
        async with semaphore:
            return await _run_single_tool(tc)

    async def _flush_read_batch(
        pending: list[tuple[int, ToolCall]],
        outcomes_by_index: dict[int, ToolExecutionOutcome],
    ) -> None:
        if not pending:
            return
        if timing is not None:
            resources = sorted(
                {
                    _resource_name(tool_map[tc.name])
                    for _idx, tc in pending
                    if tc.name in tool_map
                }
            )
            timing.record_tool_stage(
                "tool_read_batch_start",
                tool_name="batch",
                tool_call_id=message_id,
                count=len(pending),
                resources=",".join(resources),
            )
        results = await asyncio.gather(*[_run_read_tool(tc) for _idx, tc in pending])
        for (idx, _tc), outcome in zip(pending, results):
            outcomes_by_index[idx] = outcome
        if timing is not None:
            timing.record_tool_stage(
                "tool_read_batch_done",
                tool_name="batch",
                tool_call_id=message_id,
                count=len(pending),
            )

    if timing is not None:
        timing.record_tool_stage(
            "tool_scheduler_plan",
            tool_name="batch",
            tool_call_id=message_id,
            count=len(tool_calls),
            read_only_count=sum(1 for tc in tool_calls if _is_read_only_call(tc)),
            serial_count=sum(1 for tc in tool_calls if not _is_read_only_call(tc)),
        )

    outcomes_by_index: dict[int, ToolExecutionOutcome] = {}
    pending_read_batch: list[tuple[int, ToolCall]] = []
    for index, tc in enumerate(tool_calls):
        if _is_read_only_call(tc):
            pending_read_batch.append((index, tc))
            continue

        await _flush_read_batch(pending_read_batch, outcomes_by_index)
        pending_read_batch = []
        outcomes_by_index[index] = await _run_single_tool(tc)

    await _flush_read_batch(pending_read_batch, outcomes_by_index)
    outcomes = [outcomes_by_index[index] for index in range(len(tool_calls))]

    steering_messages: list[Message] | None = None
    if config.get_steering_messages:
        steering = await config.get_steering_messages()
        if steering:
            steering_messages = steering

    return list(outcomes), steering_messages
