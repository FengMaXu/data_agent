from src.agent.context_builder import AgentContextBuilder
from src.agent.types import AgentTool
from src.ai.base_provider import Message, Role, ToolCall, ToolResultContent


def _tool(name: str) -> AgentTool:
    async def execute(_tool_call_id, _arguments):
        from src.agent.types import AgentToolResult

        return AgentToolResult(content=[ToolResultContent(text="ok")])

    return AgentTool(
        name=name,
        description=name,
        parameters={"type": "object", "properties": {}},
        execute_fn=execute,
    )


def test_context_builder_removes_unavailable_tool_calls_and_results():
    builder = AgentContextBuilder()
    messages = [
        Message(role=Role.SYSTEM, content="old system"),
        Message(role=Role.USER, content="question"),
        Message(
            role=Role.ASSISTANT,
            content="",
            tool_calls=[ToolCall(id="missing-call", name="missing_tool", arguments={})],
        ),
        Message(
            role=Role.TOOL_RESULT,
            content="tool missing",
            tool_call_id="missing-call",
            tool_name="missing_tool",
        ),
        Message(role=Role.ASSISTANT, content="answer"),
    ]

    result = builder.build(
        system_prompt="new system",
        messages=messages,
        tools=[_tool("execute_sql")],
    )

    assert result.removed_tool_call_ids == ["missing-call"]
    assert [message.role for message in result.context.messages] == [
        Role.USER,
        Role.ASSISTANT,
    ]
    assert result.context.system_prompt == "new system"


def test_context_builder_uses_known_tools_for_history_sanitization():
    builder = AgentContextBuilder()
    messages = [
        Message(role=Role.USER, content="question"),
        Message(
            role=Role.ASSISTANT,
            content="",
            tool_calls=[ToolCall(id="sql-call", name="execute_sql", arguments={})],
        ),
        Message(
            role=Role.TOOL_RESULT,
            content="rows",
            tool_call_id="sql-call",
            tool_name="execute_sql",
        ),
    ]

    result = builder.build(
        system_prompt="system",
        messages=messages,
        tools=[_tool("tool_search")],
        known_tools=[_tool("tool_search"), _tool("execute_sql")],
    )

    assert result.removed_tool_call_ids == []
    assert result.tool_count == 1
    assert result.known_tool_count == 2
    assert result.context.tools[0].name == "tool_search"
    assert result.context.messages[1].tool_calls[0].name == "execute_sql"
    assert result.context.messages[2].tool_name == "execute_sql"
