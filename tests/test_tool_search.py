import asyncio
import json

from src.agent.tool_search import TOOL_SEARCH_TOOL_NAME, ToolSearchCatalog
from src.agent.types import AgentTool, AgentToolResult
from src.ai.base_provider import ToolResultContent


def _tool(name: str, description: str, *, label: str = "") -> AgentTool:
    async def execute(_tool_call_id, _arguments):
        return AgentToolResult(content=[ToolResultContent(type="text", text="ok")])

    return AgentTool(
        name=name,
        label=label or name,
        description=description,
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "SQL or natural language query",
                }
            },
        },
        execute_fn=execute,
    )


def _run_search(catalog: ToolSearchCatalog, query: str, max_results: int = 6):
    return _run_search_args(catalog, {"query": query, "max_results": max_results})


def _run_search_args(catalog: ToolSearchCatalog, arguments: dict):
    result = asyncio.run(
        catalog.execute("call_search", arguments)
    )
    return json.loads(result.content[0].text), result


def test_tool_search_select_loads_exact_tools():
    catalog = ToolSearchCatalog(
        [
            _tool("execute_sql", "Execute read-only SQL query against the database."),
            _tool("show_widget", "Display KPI cards, tables, charts, and widgets."),
        ]
    )

    assert [tool.name for tool in catalog.visible_tools()] == [TOOL_SEARCH_TOOL_NAME]

    payload, result = _run_search(catalog, "select:execute_sql,show_widget")

    assert result.is_error is False
    assert payload["newly_loaded_tools"] == ["execute_sql", "show_widget"]
    assert [tool.name for tool in catalog.visible_tools()] == [
        TOOL_SEARCH_TOOL_NAME,
        "execute_sql",
        "show_widget",
    ]


def test_tool_search_uses_initial_loaded_names_and_reports_changes():
    changes = []
    catalog = ToolSearchCatalog(
        [
            _tool("execute_sql", "Execute read-only SQL query against the database."),
            _tool("show_widget", "Display KPI cards, tables, charts, and widgets."),
        ],
        initial_loaded_names=["execute_sql"],
        on_loaded_change=lambda names: changes.append(set(names)),
    )

    assert [tool.name for tool in catalog.visible_tools()] == [
        TOOL_SEARCH_TOOL_NAME,
        "execute_sql",
    ]

    loaded_tool = catalog.load_tool_name("show_widget")

    assert loaded_tool is not None
    assert loaded_tool.name == "show_widget"
    assert catalog.loaded_tool_names == {"execute_sql", "show_widget"}
    assert changes[-1] == {"execute_sql", "show_widget"}


def test_tool_search_select_ignores_keyword_result_limit():
    tools = [
        _tool(f"tool_{index}", f"Tool {index}.")
        for index in range(8)
    ]
    catalog = ToolSearchCatalog(tools)

    query = "select:" + ",".join(tool.name for tool in tools)
    payload, result = _run_search(catalog, query, max_results=1)

    assert result.is_error is False
    assert payload["newly_loaded_tools"] == [tool.name for tool in tools]
    assert payload["omitted_names"] == []
    assert [tool.name for tool in catalog.visible_tools()] == [
        TOOL_SEARCH_TOOL_NAME,
        *[tool.name for tool in tools],
    ]


def test_tool_search_select_reports_hard_cap_omissions():
    tools = [
        _tool(f"tool_{index}", f"Tool {index}.")
        for index in range(14)
    ]
    catalog = ToolSearchCatalog(tools)

    query = "select:" + ",".join(tool.name for tool in tools)
    payload, result = _run_search(catalog, query)

    assert result.is_error is False
    assert payload["newly_loaded_tools"] == [tool.name for tool in tools[:12]]
    assert payload["omitted_names"] == [tool.name for tool in tools[12:]]
    assert payload["omitted_by_query"] == {query: [tool.name for tool in tools[12:]]}


def test_tool_search_keyword_query_ranks_matching_tool():
    catalog = ToolSearchCatalog(
        [
            _tool("execute_sql", "Execute read-only SQL query against the database."),
            _tool("export_sql_to_csv", "Export SQL query results to a workspace CSV file."),
            _tool("show_widget", "Display KPI cards, tables, charts, and widgets."),
        ]
    )

    payload, _result = _run_search(catalog, "+SQL export", max_results=1)

    assert payload["matched_tools"][0]["name"] == "export_sql_to_csv"
    assert payload["newly_loaded_tools"] == ["export_sql_to_csv"]


def test_tool_search_queries_load_multiple_independent_matches():
    catalog = ToolSearchCatalog(
        [
            _tool("execute_sql", "Execute read-only SQL query against the database."),
            _tool("show_widget", "Display KPI cards, tables, charts, and widgets."),
            _tool("export_sql_to_csv", "Export SQL query results to a workspace CSV file."),
        ]
    )

    payload, result = _run_search_args(
        catalog,
        {"queries": ["database SQL", "charts widgets"], "max_results": 1},
    )

    assert result.is_error is False
    assert payload["queries"] == ["database SQL", "charts widgets"]
    assert [match["name"] for match in payload["matched_tools"]] == [
        "execute_sql",
        "show_widget",
    ]
    assert payload["newly_loaded_tools"] == ["execute_sql", "show_widget"]
    assert [tool.name for tool in catalog.visible_tools()] == [
        TOOL_SEARCH_TOOL_NAME,
        "execute_sql",
        "show_widget",
    ]


def test_tool_search_matches_chinese_intent():
    catalog = ToolSearchCatalog(
        [
            _tool(
                "execute_sql",
                "执行只读 SQL 查询，用于销售额、同比、环比和明细数据分析。",
                label="执行 SQL 查询",
            ),
            _tool("show_widget", "Display charts and tables in the chat UI."),
        ]
    )

    payload, _result = _run_search(catalog, "销售额同比分析", max_results=1)

    assert payload["matched_tools"][0]["name"] == "execute_sql"
    assert payload["newly_loaded_tools"] == ["execute_sql"]


def test_tool_search_empty_query_is_error():
    catalog = ToolSearchCatalog([_tool("execute_sql", "Execute SQL.")])

    result = asyncio.run(catalog.execute("call_search", {"query": ""}))

    assert result.is_error is True
    assert result.details["error"] == "empty_query"
