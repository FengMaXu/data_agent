import asyncio

from src.ai.base_provider import AssistantResponse, StreamEvent, ToolCall, ToolResultContent
from src.agent.agent_loop import agent_loop
from src.agent.types import (
    AgentContext,
    AgentLoopConfig,
    AgentTimingRecorder,
    AgentTool,
    AgentToolResult,
)


class FakeGateway:
    def __init__(self, sequences):
        self.sequences = sequences
        self.calls = 0

    async def stream(self, *args, **kwargs):
        sequence = self.sequences[self.calls]
        self.calls += 1
        for event in sequence:
            yield event


def _tool(name, text="tool-ok", fail=False):
    async def execute(_tool_call_id, _arguments):
        if fail:
            raise RuntimeError("boom")
        return AgentToolResult(
            content=[ToolResultContent(type="text", text=text)],
            details={},
            is_error=False,
        )

    return AgentTool(
        name=name,
        description=name,
        parameters={"type": "object", "properties": {}},
        execute_fn=execute,
    )


def _collect(async_iter):
    async def run():
        return [event async for event in async_iter]

    return asyncio.run(run())


def test_agent_loop_records_text_only_timing():
    gateway = FakeGateway(
        [
            [
                StreamEvent(type="message_start", message_id="msg_1"),
                StreamEvent(type="text_delta", message_id="msg_1", text="hello"),
                StreamEvent(
                    type="done",
                    message_id="msg_1",
                    response=AssistantResponse(content="hello", message_id="msg_1"),
                ),
            ]
        ]
    )
    timing = AgentTimingRecorder(req="run_text", session="session_text")
    config = AgentLoopConfig(model="claude-opus-4-6", timing=timing)
    context = AgentContext(system_prompt="system", timing=timing)

    _collect(agent_loop("hi", context, config, gateway))

    assert timing.counters["turns"] == 1
    assert timing.counters["llm_calls"] == 1
    assert timing.counters.get("tool_calls", 0) == 0
    assert any(stage["stage"] == "llm_first_text" for stage in timing.llm_stages)
    assert any(stage["stage"] == "turn_done" for stage in timing.llm_stages)


def test_agent_loop_multi_turn_tool_timing():
    gateway = FakeGateway(
        [
            [
                StreamEvent(type="message_start", message_id="msg_1"),
                StreamEvent(
                    type="tool_call_start",
                    message_id="msg_1",
                    tool_call=ToolCall(id="call_1", name="lookup", arguments={}),
                ),
                StreamEvent(
                    type="done",
                    message_id="msg_1",
                    response=AssistantResponse(
                        content="",
                        tool_calls=[ToolCall(id="call_1", name="lookup", arguments={})],
                        stop_reason="tool_use",
                        message_id="msg_1",
                    ),
                ),
            ],
            [
                StreamEvent(type="message_start", message_id="msg_2"),
                StreamEvent(type="text_delta", message_id="msg_2", text="done"),
                StreamEvent(
                    type="done",
                    message_id="msg_2",
                    response=AssistantResponse(content="done", message_id="msg_2"),
                ),
            ],
        ]
    )
    timing = AgentTimingRecorder(req="run_loop", session="session_loop")
    config = AgentLoopConfig(model="claude-opus-4-6", timing=timing)
    context = AgentContext(
        system_prompt="system",
        tools=[_tool("lookup", text="42")],
        timing=timing,
    )

    _collect(agent_loop("question", context, config, gateway))

    assert timing.counters["turns"] == 2
    assert timing.counters["llm_calls"] == 2
    assert timing.counters["tool_calls"] == 1
    assert any(stage["stage"] == "llm_first_tool_call" for stage in timing.llm_stages)
    assert any(stage["stage"] == "llm_first_text" for stage in timing.llm_stages)
    assert any(stage["stage"] == "tool_done" for stage in timing.tool_stages)
    assert any(stage["stage"] == "tool_batch_start" for stage in timing.tool_stages)


def test_agent_loop_tool_failure_records_error_timing():
    gateway = FakeGateway(
        [
            [
                StreamEvent(type="message_start", message_id="msg_1"),
                StreamEvent(
                    type="tool_call_start",
                    message_id="msg_1",
                    tool_call=ToolCall(id="call_1", name="lookup", arguments={}),
                ),
                StreamEvent(
                    type="done",
                    message_id="msg_1",
                    response=AssistantResponse(
                        content="",
                        tool_calls=[ToolCall(id="call_1", name="lookup", arguments={})],
                        stop_reason="tool_use",
                        message_id="msg_1",
                    ),
                ),
            ],
            [
                StreamEvent(type="message_start", message_id="msg_2"),
                StreamEvent(type="text_delta", message_id="msg_2", text="recovered"),
                StreamEvent(
                    type="done",
                    message_id="msg_2",
                    response=AssistantResponse(content="recovered", message_id="msg_2"),
                ),
            ],
        ]
    )
    timing = AgentTimingRecorder(req="run_fail", session="session_fail")
    config = AgentLoopConfig(model="claude-opus-4-6", timing=timing)
    context = AgentContext(
        system_prompt="system",
        tools=[_tool("lookup", fail=True)],
        timing=timing,
    )

    _collect(agent_loop("question", context, config, gateway))

    failed_tools = [stage for stage in timing.tool_stages if stage["stage"] == "tool_done"]
    assert failed_tools
    assert any(stage.get("is_error") for stage in failed_tools)
