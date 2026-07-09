import asyncio

from src.ai.base_provider import AssistantResponse, Role, StreamEvent, ToolCall, ToolResultContent
from src.agent.agent_loop import agent_loop
from src.agent.tool_search import ToolSearchCatalog
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


def _skill_activation_tool():
    async def execute(_tool_call_id, _arguments):
        details = {
            "_is_skill_activation": True,
            "command_name": "dashboard",
            "ui_message": '<command-message>The "dashboard" skill is loading</command-message>',
            "model_message_injection": '<skill_content name="dashboard">Use dashboard instructions.</skill_content>',
        }
        return AgentToolResult(
            content=[ToolResultContent(type="text", text="activated")],
            details=details,
            is_error=False,
        )

    return AgentTool(
        name="activate_skill",
        description="activate skill",
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


def test_agent_loop_show_widget_continues_like_regular_tool():
    gateway = FakeGateway(
        [
            [
                StreamEvent(type="message_start", message_id="msg_1"),
                StreamEvent(
                    type="tool_call_start",
                    message_id="msg_1",
                    tool_call=ToolCall(id="call_1", name="show_widget", arguments={}),
                ),
                StreamEvent(
                    type="done",
                    message_id="msg_1",
                    response=AssistantResponse(
                        content="",
                        tool_calls=[ToolCall(id="call_1", name="show_widget", arguments={})],
                        stop_reason="tool_use",
                        message_id="msg_1",
                    ),
                ),
            ],
            [
                StreamEvent(type="message_start", message_id="msg_2"),
                StreamEvent(type="text_delta", message_id="msg_2", text="finished"),
                StreamEvent(
                    type="done",
                    message_id="msg_2",
                    response=AssistantResponse(content="finished", message_id="msg_2"),
                ),
            ],
        ]
    )
    timing = AgentTimingRecorder(req="run_widget", session="session_widget")
    config = AgentLoopConfig(model="claude-opus-4-6", timing=timing)
    context = AgentContext(
        system_prompt="system",
        tools=[_tool("show_widget", text="shown")],
        timing=timing,
    )

    _collect(agent_loop("show chart", context, config, gateway))

    assert gateway.calls == 2
    assert timing.counters["turns"] == 2
    assert timing.counters["llm_calls"] == 2
    assert any(stage["stage"] == "tool_done" for stage in timing.tool_stages)
    assert not any(stage["stage"] == "terminal_tool_done" for stage in timing.tool_stages)


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


def test_agent_loop_refreshes_visible_tools_after_tool_search():
    class RecordingGateway(FakeGateway):
        def __init__(self, sequences):
            super().__init__(sequences)
            self.tool_names = []

        async def stream(self, model, messages, tools, **kwargs):
            self.tool_names.append([tool.name for tool in tools or []])
            async for event in super().stream(model, messages, tools, **kwargs):
                yield event

    gateway = RecordingGateway(
        [
            [
                StreamEvent(type="message_start", message_id="msg_1"),
                StreamEvent(
                    type="tool_call_start",
                    message_id="msg_1",
                    tool_call=ToolCall(
                        id="call_search",
                        name="tool_search",
                        arguments={"query": "select:lookup_data"},
                    ),
                ),
                StreamEvent(
                    type="done",
                    message_id="msg_1",
                    response=AssistantResponse(
                        content="",
                        tool_calls=[
                            ToolCall(
                                id="call_search",
                                name="tool_search",
                                arguments={"query": "select:lookup_data"},
                            )
                        ],
                        stop_reason="tool_use",
                        message_id="msg_1",
                    ),
                ),
            ],
            [
                StreamEvent(type="message_start", message_id="msg_2"),
                StreamEvent(
                    type="tool_call_start",
                    message_id="msg_2",
                    tool_call=ToolCall(id="call_lookup", name="lookup_data", arguments={}),
                ),
                StreamEvent(
                    type="done",
                    message_id="msg_2",
                    response=AssistantResponse(
                        content="",
                        tool_calls=[
                            ToolCall(id="call_lookup", name="lookup_data", arguments={})
                        ],
                        stop_reason="tool_use",
                        message_id="msg_2",
                    ),
                ),
            ],
            [
                StreamEvent(type="message_start", message_id="msg_3"),
                StreamEvent(type="text_delta", message_id="msg_3", text="done"),
                StreamEvent(
                    type="done",
                    message_id="msg_3",
                    response=AssistantResponse(content="done", message_id="msg_3"),
                ),
            ],
        ]
    )
    timing = AgentTimingRecorder(req="run_tool_search", session="session_tool_search")
    catalog = ToolSearchCatalog([_tool("lookup_data", text="42")], timing=timing)
    context = AgentContext(
        system_prompt="system",
        tools=catalog.visible_tools(),
        tool_catalog=catalog,
        timing=timing,
    )
    config = AgentLoopConfig(model="claude-opus-4-6", timing=timing)

    _collect(agent_loop("question", context, config, gateway))

    assert gateway.tool_names[0] == ["tool_search"]
    assert gateway.tool_names[1] == ["tool_search", "lookup_data"]
    assert timing.counters["tool_calls"] == 2
    assert any(stage["stage"] == "tool_search_match" for stage in timing.tool_stages)
    assert any(stage["stage"] == "tool_catalog_refresh" for stage in timing.tool_stages)


def test_agent_loop_autoloads_known_deferred_tool_call():
    class RecordingGateway(FakeGateway):
        def __init__(self, sequences):
            super().__init__(sequences)
            self.tool_names = []

        async def stream(self, model, messages, tools, **kwargs):
            self.tool_names.append([tool.name for tool in tools or []])
            async for event in super().stream(model, messages, tools, **kwargs):
                yield event

    gateway = RecordingGateway(
        [
            [
                StreamEvent(type="message_start", message_id="msg_1"),
                StreamEvent(
                    type="tool_call_start",
                    message_id="msg_1",
                    tool_call=ToolCall(id="call_lookup", name="lookup_data", arguments={}),
                ),
                StreamEvent(
                    type="done",
                    message_id="msg_1",
                    response=AssistantResponse(
                        content="",
                        tool_calls=[
                            ToolCall(id="call_lookup", name="lookup_data", arguments={})
                        ],
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
    timing = AgentTimingRecorder(req="run_tool_autoload", session="session_tool_autoload")
    catalog = ToolSearchCatalog([_tool("lookup_data", text="42")], timing=timing)
    context = AgentContext(
        system_prompt="system",
        tools=catalog.visible_tools(),
        tool_catalog=catalog,
        timing=timing,
    )
    config = AgentLoopConfig(model="claude-opus-4-6", timing=timing)

    _collect(agent_loop("question", context, config, gateway))

    assert gateway.tool_names[0] == ["tool_search"]
    assert context.tools[1].name == "lookup_data"
    assert catalog.loaded_tool_names == {"lookup_data"}
    assert any(stage["stage"] == "tool_catalog_autoload" for stage in timing.tool_stages)
    assert all(
        not stage.get("is_error")
        for stage in timing.tool_stages
        if stage["stage"] == "tool_done"
    )


def test_agent_loop_keeps_parallel_tool_results_adjacent_before_skill_injection():
    class RecordingGateway(FakeGateway):
        def __init__(self, sequences):
            super().__init__(sequences)
            self.message_snapshots = []

        async def stream(self, model, messages, tools, **kwargs):
            self.message_snapshots.append(list(messages))
            async for event in super().stream(model, messages, tools, **kwargs):
                yield event

    tool_calls = [
        ToolCall(id="call_skill", name="activate_skill", arguments={"command": "dashboard"}),
        ToolCall(id="call_patterns", name="search_query_patterns", arguments={}),
        ToolCall(id="call_db", name="introspect_database", arguments={}),
    ]
    gateway = RecordingGateway(
        [
            [
                StreamEvent(type="message_start", message_id="msg_1"),
                *[
                    StreamEvent(
                        type="tool_call_start",
                        message_id="msg_1",
                        tool_call=tool_call,
                    )
                    for tool_call in tool_calls
                ],
                StreamEvent(
                    type="done",
                    message_id="msg_1",
                    response=AssistantResponse(
                        content="",
                        tool_calls=tool_calls,
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
    timing = AgentTimingRecorder(req="run_skill_order", session="session_skill_order")
    config = AgentLoopConfig(model="claude-opus-4-6", timing=timing)
    context = AgentContext(
        system_prompt="system",
        tools=[
            _skill_activation_tool(),
            _tool("search_query_patterns", text="patterns"),
            _tool("introspect_database", text="schema"),
        ],
        timing=timing,
    )

    _collect(agent_loop("question", context, config, gateway))

    second_call_messages = gateway.message_snapshots[1]
    assistant_index = next(
        index
        for index, message in enumerate(second_call_messages)
        if message.role == Role.ASSISTANT and message.tool_calls
    )
    assert [message.role for message in second_call_messages[assistant_index + 1:assistant_index + 4]] == [
        Role.TOOL_RESULT,
        Role.TOOL_RESULT,
        Role.TOOL_RESULT,
    ]
    assert [
        message.tool_call_id
        for message in second_call_messages[assistant_index + 1:assistant_index + 4]
    ] == ["call_skill", "call_patterns", "call_db"]
    assert [message.role for message in second_call_messages[assistant_index + 4:assistant_index + 6]] == [
        Role.USER,
        Role.USER,
    ]
