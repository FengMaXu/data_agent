"""
Agent 核心类型定义
借鉴 pi-mono/packages/agent/src/types.ts
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING, Any, Awaitable, Callable, Protocol

from src.ai.base_provider import (
    AssistantResponse,
    Message,
    Role,
    ToolCall,
    ToolDefinition,
    ToolResultContent,
)

if TYPE_CHECKING:
    from src.skills.runtime import SkillRuntimeState


def _new_skill_runtime():
    from src.skills.runtime import SkillRuntimeState
    return SkillRuntimeState()


# ─────────────────────────────────────────────
# Agent Tool 协议
# ─────────────────────────────────────────────


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

    # 最大循环轮次（0 表示不限次数）
    max_turns: int = 0


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
    TOOL_EXECUTION_START = "tool_execution_start"
    TOOL_EXECUTION_END = "tool_execution_end"
    ERROR = "error"


@dataclass
class AgentEvent:
    """Agent 生命周期事件"""

    type: AgentEventType

    # 消息相关
    message: Message | None = None

    # 文本增量
    text_delta: str = ""

    # 工具执行相关
    tool_call_id: str = ""
    tool_name: str = ""
    tool_args: dict[str, Any] | None = None
    tool_result: AgentToolResult | None = None

    # Agent 结束时的全部新消息
    all_messages: list[Message] | None = None

    # 错误信息
    error: str = ""
