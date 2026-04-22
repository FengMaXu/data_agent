"""
Agent 核心类型定义
借鉴 pi-mono/packages/agent/src/types.ts
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING, Any, Awaitable, Callable

from src.ai.base_provider import Message, ToolDefinition, ToolResultContent

if TYPE_CHECKING:
    from src.skills.runtime import SkillRuntimeState


def _new_skill_runtime():
    from src.skills.runtime import SkillRuntimeState

    return SkillRuntimeState()


def _sanitize_timing_value(value: Any) -> str:
    if value is None:
        return ""
    text = str(value)
    return text.replace("\n", " ").replace("\r", " ")


@dataclass
class AgentTimingRecorder:
    """请求级 timing 记录器，仅用于日志埋点。"""

    req: str
    session: str
    started_at: float = field(default_factory=time.perf_counter)
    logger: logging.Logger = field(
        default_factory=lambda: logging.getLogger("data_agent.agent.timing")
    )
    milestones: dict[str, float] = field(default_factory=dict)
    counters: dict[str, int] = field(default_factory=dict)
    values: dict[str, float | str] = field(default_factory=dict)
    llm_stages: list[dict[str, Any]] = field(default_factory=list)
    tool_stages: list[dict[str, Any]] = field(default_factory=list)
    mcp_stages: list[dict[str, Any]] = field(default_factory=list)

    def now_ms(self) -> float:
        return (time.perf_counter() - self.started_at) * 1000

    def mark(self, stage: str, *, logger_name: str = "Chat", **extra: Any) -> float:
        elapsed_ms = self.now_ms()
        self.milestones.setdefault(stage, elapsed_ms)
        self._emit(logger_name, stage, elapsed_ms, **extra)
        return elapsed_ms

    def mark_once(self, stage: str, *, logger_name: str = "Chat", **extra: Any) -> float:
        if stage in self.milestones:
            return self.milestones[stage]
        return self.mark(stage, logger_name=logger_name, **extra)

    def measure_since(self, stage: str, current_stage: str, *, logger_name: str = "Chat", **extra: Any) -> float:
        current_ms = self.now_ms()
        self.milestones.setdefault(current_stage, current_ms)
        elapsed_ms = current_ms - self.milestones.get(stage, current_ms)
        self._emit(logger_name, current_stage, elapsed_ms, since=stage, **extra)
        return elapsed_ms

    def milestone_ms(self, stage: str) -> float | None:
        return self.milestones.get(stage)

    def add_counter(self, name: str, amount: int = 1) -> int:
        self.counters[name] = self.counters.get(name, 0) + amount
        return self.counters[name]

    def set_value(self, name: str, value: float | str) -> None:
        self.values[name] = value

    def get_value(self, name: str, default: Any = None) -> Any:
        return self.values.get(name, default)

    def has_milestone(self, stage: str) -> bool:
        return stage in self.milestones

    def elapsed_between(self, start_stage: str, end_stage: str) -> float | None:
        start = self.milestones.get(start_stage)
        end = self.milestones.get(end_stage)
        if start is None or end is None:
            return None
        return end - start

    def record_llm_stage(self, stage: str, *, turn: int, **extra: Any) -> float:
        elapsed_ms = self.now_ms()
        payload = {"turn": turn, "stage": stage, "elapsed_ms": round(elapsed_ms, 3), **extra}
        self.llm_stages.append(payload)
        self._emit("LLM", stage, elapsed_ms, turn=turn, **extra)
        return elapsed_ms

    def record_tool_stage(self, stage: str, *, tool_name: str = "", tool_call_id: str = "", **extra: Any) -> float:
        elapsed_ms = self.now_ms()
        payload = {
            "tool_name": tool_name,
            "tool_call_id": tool_call_id,
            "stage": stage,
            "elapsed_ms": round(elapsed_ms, 3),
            **extra,
        }
        self.tool_stages.append(payload)
        self._emit(
            "Tool",
            stage,
            elapsed_ms,
            tool=tool_name,
            tool_call_id=tool_call_id,
            **extra,
        )
        return elapsed_ms

    def record_mcp_stage(self, stage: str, *, server: str = "", **extra: Any) -> float:
        elapsed_ms = self.now_ms()
        payload = {
            "server": server,
            "stage": stage,
            "elapsed_ms": round(elapsed_ms, 3),
            **extra,
        }
        self.mcp_stages.append(payload)
        self._emit("MCP", stage, elapsed_ms, server=server, **extra)
        return elapsed_ms

    def summary(self, *, status: str) -> dict[str, Any]:
        tool_durations = [
            float(item.get("duration_ms", 0.0))
            for item in self.tool_stages
            if item.get("stage") == "tool_done" and item.get("duration_ms") is not None
        ]
        total_ms = self.now_ms()
        summary = {
            "req": self.req,
            "session": self.session,
            "status": status,
            "total_ms": round(total_ms, 3),
            "first_sse_ms": self._milestone_value("first_sse"),
            "first_text_ms": self._milestone_value("first_text"),
            "first_tool_ms": self._milestone_value("first_tool_call"),
            "attachments_ms": self._elapsed_value("request_start", "attachments_read_done"),
            "session_tools_ms": self._elapsed_value("session_tools_start", "session_tools_ready"),
            "agent_runtime_ms": self._elapsed_value("agent_run_start", "agent_done"),
            "turns": self.counters.get("turns", 0),
            "llm_calls": self.counters.get("llm_calls", 0),
            "tool_calls": self.counters.get("tool_calls", 0),
            "tool_ms_total": round(sum(tool_durations), 3),
            "tool_ms_max": round(max(tool_durations), 3) if tool_durations else 0.0,
            "first_sse_type": self.get_value("first_sse_type", ""),
        }
        for key, value in self.values.items():
            if key not in summary:
                summary[key] = value
        return summary

    def log_summary(self, *, status: str, **extra: Any) -> dict[str, Any]:
        payload = self.summary(status=status)
        payload.update(extra)
        self.logger.info(
            "[Timing][Chat] %s",
            " ".join(
                f"{key}={_sanitize_timing_value(value)}" for key, value in payload.items()
            ),
        )
        return payload

    def _milestone_value(self, stage: str) -> float | None:
        value = self.milestones.get(stage)
        return round(value, 3) if value is not None else None

    def _elapsed_value(self, start_stage: str, end_stage: str) -> float | None:
        value = self.elapsed_between(start_stage, end_stage)
        return round(value, 3) if value is not None else None

    def _emit(self, logger_name: str, stage: str, elapsed_ms: float, **extra: Any) -> None:
        payload = {
            "req": self.req,
            "session": self.session,
            "stage": stage,
            "elapsed_ms": round(elapsed_ms, 3),
        }
        payload.update({key: value for key, value in extra.items() if value is not None})
        self.logger.info(
            f"[Timing][{logger_name}] %s",
            " ".join(
                f"{key}={_sanitize_timing_value(value)}" for key, value in payload.items()
            ),
        )


@dataclass
class AgentToolResult:
    """工具执行结果"""

    content: list[ToolResultContent]
    details: dict[str, Any] = field(default_factory=dict)
    is_error: bool = False


class AgentTool:
    """
    Agent 可用工具
    每个工具需要提供 name, description, parameters(JSON Schema),
    以及一个 async execute 函数
    """

    def __init__(
        self,
        name: str,
        description: str,
        parameters: dict[str, Any],
        execute_fn: Callable[..., Awaitable[AgentToolResult]],
        label: str = "",
    ):
        self.name = name
        self.description = description
        self.parameters = parameters
        self.execute_fn = execute_fn
        self.label = label or name

    async def execute(
        self,
        tool_call_id: str,
        arguments: dict[str, Any],
    ) -> AgentToolResult:
        """执行工具"""
        return await self.execute_fn(tool_call_id, arguments)

    def to_definition(self) -> ToolDefinition:
        """转为 LLM 可用的工具定义"""
        return ToolDefinition(
            name=self.name,
            description=self.description,
            parameters=self.parameters,
        )


# ─────────────────────────────────────────────
# Agent Context
# ─────────────────────────────────────────────


@dataclass
class AgentContext:
    """Agent 运行上下文"""

    system_prompt: str
    messages: list[Message] = field(default_factory=list)
    tools: list[AgentTool] = field(default_factory=list)
    active_skills: SkillRuntimeState = field(default_factory=_new_skill_runtime)
    timing: AgentTimingRecorder | None = None


# ─────────────────────────────────────────────
# Agent Loop Config
# ─────────────────────────────────────────────


@dataclass
class AgentLoopConfig:
    """Agent Loop 配置"""

    # 使用的模型名
    model: str = "gpt-4o-mini"

    # 请求参数
    temperature: float = 0.0
    max_tokens: int = 4096

    # Steering 队列回调：返回用户"打断"消息（在工具执行间隙调用）
    get_steering_messages: Callable[[], Awaitable[list[Message]]] | None = None

    # Follow-up 队列回调：返回用户"追加"消息（Agent 即将停止时调用）
    get_follow_up_messages: Callable[[], Awaitable[list[Message]]] | None = None

    # Cooperative stop 检查回调
    should_stop: Callable[[], Awaitable[bool]] | None = None

    # 最大循环轮次（0 表示不限次数）
    max_turns: int = 0
    timing: AgentTimingRecorder | None = None


# ─────────────────────────────────────────────
# Agent Events
# ─────────────────────────────────────────────


class AgentEventType(str, Enum):
    """Agent 事件类型"""

    AGENT_START = "agent_start"
    AGENT_END = "agent_end"
    TURN_START = "turn_start"
    TURN_END = "turn_end"
    MESSAGE_START = "message_start"
    MESSAGE_UPDATE = "message_update"
    MESSAGE_END = "message_end"
    TOOL_CALL_START = "tool_call_start"
    TOOL_CALL_DELTA = "tool_call_delta"
    TOOL_CALL_END = "tool_call_end"
    TOOL_EXECUTION_START = "tool_execution_start"
    TOOL_EXECUTION_END = "tool_execution_end"
    ERROR = "error"


@dataclass
class AgentEvent:
    """Agent 生命周期事件"""

    type: AgentEventType

    # 消息相关
    message: Message | None = None
    message_id: str = ""

    # 文本增量
    text_delta: str = ""

    # 工具调用相关
    tool_call_id: str = ""
    tool_name: str = ""
    tool_args: dict[str, Any] | None = None
    partial_arguments: str = ""
    widget_id: str = ""

    # 工具执行相关
    tool_result: AgentToolResult | None = None

    # Agent 结束时的全部新消息
    all_messages: list[Message] | None = None
    stop_reason: str = ""

    # 错误信息
    error: str = ""


@dataclass
class ToolExecutionOutcome:
    """工具执行后的上下文消息与原始结果。"""

    tool_call: Any
    tool_result: AgentToolResult
    context_messages: list[Message]
    is_error: bool = False
    error_message: str = ""
