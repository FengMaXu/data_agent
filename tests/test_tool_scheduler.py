import asyncio

from src.agent.agent_loop import _execute_tool_calls
from src.agent.types import AgentLoopConfig, AgentTool, AgentToolResult
from src.ai.base_provider import ToolCall, ToolResultContent


def _run(coro):
    return asyncio.run(coro)


def _tool(
    name: str,
    execute,
    *,
    read_only: bool,
    resource: str = "test",
    max_concurrency: int | None = None,
) -> AgentTool:
    return AgentTool(
        name=name,
        description=name,
        parameters={"type": "object", "properties": {}},
        execute_fn=execute,
        read_only=read_only,
        resource=resource,
        max_concurrency=max_concurrency,
    )


async def _ok(text: str) -> AgentToolResult:
    return AgentToolResult(content=[ToolResultContent(type="text", text=text)])


def test_read_only_tools_in_same_segment_run_concurrently():
    started: list[str] = []
    both_started = asyncio.Event()

    async def execute(tool_call_id, _arguments):
        started.append(tool_call_id)
        if len(started) == 2:
            both_started.set()
        await asyncio.wait_for(both_started.wait(), timeout=1.0)
        return await _ok(tool_call_id)

    tools = [
        _tool("read_a", execute, read_only=True, resource="fs"),
        _tool("read_b", execute, read_only=True, resource="fs"),
    ]
    tool_calls = [
        ToolCall(id="call_a", name="read_a", arguments={}),
        ToolCall(id="call_b", name="read_b", arguments={}),
    ]

    outcomes, _steering = _run(
        _execute_tool_calls(tools, tool_calls, AgentLoopConfig(), "msg")
    )

    assert [outcome.tool_call.id for outcome in outcomes] == ["call_a", "call_b"]
    assert set(started) == {"call_a", "call_b"}


def test_write_tools_are_ordering_barriers_between_read_segments():
    read_a_done = asyncio.Event()
    write_done = asyncio.Event()
    events: list[str] = []

    async def read_a(_tool_call_id, _arguments):
        events.append("read_a")
        read_a_done.set()
        return await _ok("read_a")

    async def write_b(_tool_call_id, _arguments):
        assert read_a_done.is_set()
        events.append("write_b")
        write_done.set()
        return await _ok("write_b")

    async def read_c(_tool_call_id, _arguments):
        assert write_done.is_set()
        events.append("read_c")
        return await _ok("read_c")

    tools = [
        _tool("read_a", read_a, read_only=True, resource="fs"),
        _tool("write_b", write_b, read_only=False, resource="fs"),
        _tool("read_c", read_c, read_only=True, resource="fs"),
    ]
    tool_calls = [
        ToolCall(id="call_a", name="read_a", arguments={}),
        ToolCall(id="call_b", name="write_b", arguments={}),
        ToolCall(id="call_c", name="read_c", arguments={}),
    ]

    outcomes, _steering = _run(
        _execute_tool_calls(tools, tool_calls, AgentLoopConfig(), "msg")
    )

    assert [outcome.tool_call.id for outcome in outcomes] == [
        "call_a",
        "call_b",
        "call_c",
    ]
    assert events == ["read_a", "write_b", "read_c"]


def test_read_only_resource_concurrency_limit_is_respected():
    active = 0
    max_seen = 0
    lock = asyncio.Lock()

    async def execute(tool_call_id, _arguments):
        nonlocal active, max_seen
        async with lock:
            active += 1
            max_seen = max(max_seen, active)
        await asyncio.sleep(0.01)
        async with lock:
            active -= 1
        return await _ok(tool_call_id)

    tools = [
        _tool("read_a", execute, read_only=True, resource="db", max_concurrency=1),
        _tool("read_b", execute, read_only=True, resource="db", max_concurrency=1),
        _tool("read_c", execute, read_only=True, resource="db", max_concurrency=1),
    ]
    tool_calls = [
        ToolCall(id="call_a", name="read_a", arguments={}),
        ToolCall(id="call_b", name="read_b", arguments={}),
        ToolCall(id="call_c", name="read_c", arguments={}),
    ]

    outcomes, _steering = _run(
        _execute_tool_calls(tools, tool_calls, AgentLoopConfig(), "msg")
    )

    assert len(outcomes) == 3
    assert max_seen == 1
