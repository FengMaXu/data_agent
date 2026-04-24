import asyncio
import json
import sys
import tempfile
import types
from pathlib import Path
from types import SimpleNamespace


fastapi_stub = types.ModuleType("fastapi")


class _DummyAPIRouter:
    def __init__(self, *args, **kwargs):
        pass

    def get(self, *args, **kwargs):
        def decorator(fn):
            return fn
        return decorator

    def post(self, *args, **kwargs):
        def decorator(fn):
            return fn
        return decorator


class _DummyHTTPException(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


fastapi_stub.APIRouter = _DummyAPIRouter
fastapi_stub.HTTPException = _DummyHTTPException
sys.modules.setdefault("fastapi", fastapi_stub)

fastapi_responses_stub = types.ModuleType("fastapi.responses")
fastapi_responses_stub.StreamingResponse = lambda payload, **kwargs: payload
sys.modules.setdefault("fastapi.responses", fastapi_responses_stub)

sse_stub = types.ModuleType("sse_starlette.sse")
sse_stub.EventSourceResponse = lambda payload: payload
sys.modules.setdefault("sse_starlette.sse", sse_stub)

watchfiles_stub = types.ModuleType("watchfiles")


async def _fake_awatch(_path):
    if False:
        yield None


watchfiles_stub.awatch = _fake_awatch
sys.modules.setdefault("watchfiles", watchfiles_stub)

from src.ai.base_provider import Message, Role, ToolCall, ToolResultContent
from src.agent.types import AgentEvent, AgentEventType, AgentToolResult
from src.api import agent as agent_api


def _extract_event_types(events: list[dict]) -> list[str]:
    return [event["type"] for event in events]


def _assert_subsequence(actual: list[str], expected: list[str]) -> None:
    pos = 0
    for item in actual:
        if pos < len(expected) and item == expected[pos]:
            pos += 1
    assert pos == len(expected), f"expected subsequence {expected}, got {actual}"


def _reset_session(session_id: str) -> None:
    agent_api._cleanup_session_state(session_id)


def test_show_widget_sse_sequence(monkeypatch):
    session_id = "test_widget_sse_sequence"
    _reset_session(session_id)

    async def fake_build_session_tools(**kwargs):
        return [], SimpleNamespace(metadata={})

    async def fake_agent_loop(user_message, context, config, gateway):
        yield AgentEvent(
            type=AgentEventType.MESSAGE_START,
            message_id="msg_widget_1",
        )
        yield AgentEvent(
            type=AgentEventType.MESSAGE_UPDATE,
            message_id="msg_widget_1",
            text_delta="这里是分析结果：",
        )
        yield AgentEvent(
            type=AgentEventType.TOOL_CALL_START,
            message_id="msg_widget_1",
            tool_call_id="call_widget_1",
            tool_name="show_widget",
            tool_args={"kind": "metric_cards", "title": "销售趋势"},
        )
        yield AgentEvent(
            type=AgentEventType.TOOL_CALL_DELTA,
            message_id="msg_widget_1",
            tool_call_id="call_widget_1",
            tool_name="show_widget",
            partial_arguments='{"widget_id":"widget_sales","kind":"metric_cards","title":"销售趋势"',
        )
        yield AgentEvent(
            type=AgentEventType.TOOL_EXECUTION_END,
            message_id="msg_widget_1",
            tool_call_id="call_widget_1",
            tool_name="show_widget",
            tool_args={
                "widget_id": "widget_sales",
                "kind": "metric_cards",
                "title": "销售趋势",
            },
            tool_result=AgentToolResult(
                content=[ToolResultContent(type="text", text="已展示销售趋势组件")],
                details={
                    "widget_id": "widget_sales",
                    "kind": "metric_cards",
                    "title": "销售趋势",
                    "subtitle": "最近 3 个月",
                    "data": [
                        {"label": "本月", "value": 128},
                        {"label": "环比", "value": "+12%"},
                    ],
                    "series": [],
                    "columns": [],
                    "actions": [],
                    "metadata": {},
                },
            ),
        )
        yield AgentEvent(type=AgentEventType.AGENT_END, stop_reason="completed")

    monkeypatch.setattr(agent_api.config_manager, "gateway", object())
    monkeypatch.setattr(
        agent_api.config_manager,
        "ai_config",
        SimpleNamespace(default_model="claude-opus-4-6", temperature=0.0, max_tokens=1024),
    )
    monkeypatch.setattr(agent_api.config_manager, "build_session_tools", fake_build_session_tools)
    monkeypatch.setattr(agent_api, "load_system_prompt", lambda _root: "test system prompt")
    monkeypatch.setattr(agent_api, "agent_loop", fake_agent_loop)

    async def collect_events():
        events: list[dict] = []
        async for raw in agent_api.event_generator(
            prompt="请展示一个销售趋势组件",
            session_id=session_id,
            run_id="run_widget_1",
        ):
            events.append(json.loads(raw))
        return events

    events = asyncio.run(collect_events())

    event_types = _extract_event_types(events)
    _assert_subsequence(
        event_types,
        [
            "message_start",
            "text_delta",
            "tool_call",
            "widget_patch",
            "widget",
            "widget_done",
            "tool_result",
            "done",
        ],
    )

    widget_patch = next(event for event in events if event["type"] == "widget_patch")
    assert widget_patch["message_id"] == "msg_widget_1"
    assert widget_patch["tool_call_id"] == "call_widget_1"
    assert widget_patch["widget_id"] == "widget_sales"
    assert widget_patch["patch"]["title"] == "销售趋势"

    widget_event = next(event for event in events if event["type"] == "widget")
    assert widget_event["widget"]["widget_id"] == "widget_sales"
    assert widget_event["widget"]["kind"] == "metric_cards"
    assert widget_event["widget"]["title"] == "销售趋势"

    tool_result = next(event for event in events if event["type"] == "tool_result")
    assert tool_result["name"] == "show_widget"
    assert tool_result["content"] == "已展示销售趋势组件"
    assert tool_result["details"]["widget_id"] == "widget_sales"
    assert tool_result["arguments"]["title"] == "销售趋势"

    done_event = next(event for event in events if event["type"] == "done")
    assert done_event["reason"] == "completed"

    assert agent_api._session_widgets[session_id]["call_widget_1"]["status"] == "ready"
    _reset_session(session_id)


def test_show_widget_malformed_spec_emits_widget_error(monkeypatch):
    session_id = "test_widget_malformed"
    _reset_session(session_id)

    async def fake_build_session_tools(**kwargs):
        return [], SimpleNamespace(metadata={})

    async def fake_agent_loop(user_message, context, config, gateway):
        yield AgentEvent(
            type=AgentEventType.MESSAGE_START,
            message_id="msg_widget_bad_1",
        )
        yield AgentEvent(
            type=AgentEventType.TOOL_CALL_START,
            message_id="msg_widget_bad_1",
            tool_call_id="call_widget_bad_1",
            tool_name="show_widget",
            tool_args={"kind": "table"},
        )
        yield AgentEvent(
            type=AgentEventType.TOOL_CALL_DELTA,
            message_id="msg_widget_bad_1",
            tool_call_id="call_widget_bad_1",
            tool_name="show_widget",
            partial_arguments='{"widget_id":"widget_bad","kind":"table"',
        )
        yield AgentEvent(
            type=AgentEventType.TOOL_EXECUTION_END,
            message_id="msg_widget_bad_1",
            tool_call_id="call_widget_bad_1",
            tool_name="show_widget",
            tool_args={"widget_id": "widget_bad", "kind": "table"},
            tool_result=AgentToolResult(
                content=[ToolResultContent(type="text", text="show_widget 参数错误：title 不能为空")],
                details={
                    "widget_id": "widget_bad",
                    "error": "title 不能为空",
                    "input": {"widget_id": "widget_bad", "kind": "table"},
                },
                is_error=True,
            ),
        )
        yield AgentEvent(type=AgentEventType.AGENT_END, stop_reason="completed")

    monkeypatch.setattr(agent_api.config_manager, "gateway", object())
    monkeypatch.setattr(
        agent_api.config_manager,
        "ai_config",
        SimpleNamespace(default_model="claude-opus-4-6", temperature=0.0, max_tokens=1024),
    )
    monkeypatch.setattr(agent_api.config_manager, "build_session_tools", fake_build_session_tools)
    monkeypatch.setattr(agent_api, "load_system_prompt", lambda _root: "test system prompt")
    monkeypatch.setattr(agent_api, "agent_loop", fake_agent_loop)

    async def collect_events():
        events: list[dict] = []
        async for raw in agent_api.event_generator(
            prompt="展示一个不完整的表格组件",
            session_id=session_id,
            run_id="run_widget_bad",
        ):
            events.append(json.loads(raw))
        return events

    events = asyncio.run(collect_events())
    event_types = _extract_event_types(events)
    _assert_subsequence(
        event_types,
        [
            "message_start",
            "tool_call",
            "widget_patch",
            "widget_error",
            "tool_result",
            "done",
        ],
    )

    widget_error = next(event for event in events if event["type"] == "widget_error")
    assert widget_error["message_id"] == "msg_widget_bad_1"
    assert widget_error["tool_call_id"] == "call_widget_bad_1"
    assert widget_error["widget_id"] == "widget_bad"
    assert "title 不能为空" in widget_error["error"]

    tool_result = next(event for event in events if event["type"] == "tool_result")
    assert tool_result["name"] == "show_widget"
    assert tool_result["is_error"] is True
    assert tool_result["widget_id"] == "widget_bad"
    assert tool_result["details"]["error"] == "title 不能为空"
    assert tool_result["arguments"]["widget_id"] == "widget_bad"

    _reset_session(session_id)


def test_two_show_widgets_in_same_reply_do_not_cross(monkeypatch):
    session_id = "test_widget_two_widgets"
    _reset_session(session_id)

    async def fake_build_session_tools(**kwargs):
        return [], SimpleNamespace(metadata={})

    async def fake_agent_loop(user_message, context, config, gateway):
        yield AgentEvent(
            type=AgentEventType.MESSAGE_START,
            message_id="msg_widget_multi_1",
        )
        yield AgentEvent(
            type=AgentEventType.MESSAGE_UPDATE,
            message_id="msg_widget_multi_1",
            text_delta="下面展示两个组件：",
        )

        yield AgentEvent(
            type=AgentEventType.TOOL_CALL_START,
            message_id="msg_widget_multi_1",
            tool_call_id="call_widget_sales",
            tool_name="show_widget",
            tool_args={"kind": "metric_cards", "title": "销售指标"},
        )
        yield AgentEvent(
            type=AgentEventType.TOOL_CALL_DELTA,
            message_id="msg_widget_multi_1",
            tool_call_id="call_widget_sales",
            tool_name="show_widget",
            partial_arguments='{"widget_id":"widget_sales","kind":"metric_cards","title":"销售指标"',
        )

        yield AgentEvent(
            type=AgentEventType.TOOL_CALL_START,
            message_id="msg_widget_multi_1",
            tool_call_id="call_widget_region",
            tool_name="show_widget",
            tool_args={"kind": "table", "title": "区域分布"},
        )
        yield AgentEvent(
            type=AgentEventType.TOOL_CALL_DELTA,
            message_id="msg_widget_multi_1",
            tool_call_id="call_widget_region",
            tool_name="show_widget",
            partial_arguments='{"widget_id":"widget_region","kind":"table","title":"区域分布"',
        )

        yield AgentEvent(
            type=AgentEventType.TOOL_EXECUTION_END,
            message_id="msg_widget_multi_1",
            tool_call_id="call_widget_sales",
            tool_name="show_widget",
            tool_args={
                "widget_id": "widget_sales",
                "kind": "metric_cards",
                "title": "销售指标",
            },
            tool_result=AgentToolResult(
                content=[ToolResultContent(type="text", text="已展示销售指标组件")],
                details={
                    "widget_id": "widget_sales",
                    "kind": "metric_cards",
                    "title": "销售指标",
                    "subtitle": "本月概览",
                    "data": [{"label": "销售额", "value": 256}],
                    "series": [],
                    "columns": [],
                    "actions": [],
                    "metadata": {},
                },
            ),
        )
        yield AgentEvent(
            type=AgentEventType.TOOL_EXECUTION_END,
            message_id="msg_widget_multi_1",
            tool_call_id="call_widget_region",
            tool_name="show_widget",
            tool_args={
                "widget_id": "widget_region",
                "kind": "table",
                "title": "区域分布",
            },
            tool_result=AgentToolResult(
                content=[ToolResultContent(type="text", text="已展示区域分布组件")],
                details={
                    "widget_id": "widget_region",
                    "kind": "table",
                    "title": "区域分布",
                    "subtitle": "Top 2 区域",
                    "data": [
                        {"region": "华东", "amount": 120},
                        {"region": "华南", "amount": 98},
                    ],
                    "columns": [
                        {"key": "region", "label": "区域"},
                        {"key": "amount", "label": "金额"},
                    ],
                    "series": [],
                    "actions": [],
                    "metadata": {},
                },
            ),
        )
        yield AgentEvent(type=AgentEventType.AGENT_END, stop_reason="completed")

    monkeypatch.setattr(agent_api.config_manager, "gateway", object())
    monkeypatch.setattr(
        agent_api.config_manager,
        "ai_config",
        SimpleNamespace(default_model="claude-opus-4-6", temperature=0.0, max_tokens=1024),
    )
    monkeypatch.setattr(agent_api.config_manager, "build_session_tools", fake_build_session_tools)
    monkeypatch.setattr(agent_api, "load_system_prompt", lambda _root: "test system prompt")
    monkeypatch.setattr(agent_api, "agent_loop", fake_agent_loop)

    async def collect_events():
        events: list[dict] = []
        async for raw in agent_api.event_generator(
            prompt="展示销售指标和区域分布两个组件",
            session_id=session_id,
            run_id="run_widget_multi",
        ):
            events.append(json.loads(raw))
        return events

    events = asyncio.run(collect_events())

    tool_calls = [event for event in events if event["type"] == "tool_call"]
    assert len(tool_calls) == 2
    assert {event["tool_call_id"] for event in tool_calls} == {"call_widget_sales", "call_widget_region"}

    widget_patches = [event for event in events if event["type"] == "widget_patch"]
    assert len(widget_patches) == 2
    sales_patch = next(event for event in widget_patches if event["tool_call_id"] == "call_widget_sales")
    region_patch = next(event for event in widget_patches if event["tool_call_id"] == "call_widget_region")
    assert sales_patch["widget_id"] == "widget_sales"
    assert sales_patch["patch"]["title"] == "销售指标"
    assert region_patch["widget_id"] == "widget_region"
    assert region_patch["patch"]["title"] == "区域分布"

    widgets = [event for event in events if event["type"] == "widget"]
    assert len(widgets) == 2
    sales_widget = next(event for event in widgets if event["widget_id"] == "widget_sales")
    region_widget = next(event for event in widgets if event["widget_id"] == "widget_region")
    assert sales_widget["tool_call_id"] == "call_widget_sales"
    assert sales_widget["widget"]["kind"] == "metric_cards"
    assert sales_widget["widget"]["title"] == "销售指标"
    assert region_widget["tool_call_id"] == "call_widget_region"
    assert region_widget["widget"]["kind"] == "table"
    assert region_widget["widget"]["title"] == "区域分布"

    tool_results = [event for event in events if event["type"] == "tool_result"]
    assert len(tool_results) == 2
    sales_result = next(event for event in tool_results if event["tool_call_id"] == "call_widget_sales")
    region_result = next(event for event in tool_results if event["tool_call_id"] == "call_widget_region")
    assert sales_result["widget_id"] == "widget_sales"
    assert sales_result["details"]["title"] == "销售指标"
    assert region_result["widget_id"] == "widget_region"
    assert region_result["details"]["title"] == "区域分布"

    assert agent_api._session_widgets[session_id]["call_widget_sales"]["title"] == "销售指标"
    assert agent_api._session_widgets[session_id]["call_widget_region"]["title"] == "区域分布"
    assert agent_api._session_widgets[session_id]["call_widget_sales"]["widget_id"] != agent_api._session_widgets[session_id]["call_widget_region"]["widget_id"]

    event_types = _extract_event_types(events)
    _assert_subsequence(
        event_types,
        [
            "message_start",
            "text_delta",
            "tool_call",
            "widget_patch",
            "tool_call",
            "widget_patch",
            "widget",
            "widget_done",
            "tool_result",
            "widget",
            "widget_done",
            "tool_result",
            "done",
        ],
    )

    _reset_session(session_id)




def test_progress_events_for_direct_answer(monkeypatch):
    session_id = "test_progress_direct_answer"
    _reset_session(session_id)

    async def fake_build_session_tools(**kwargs):
        return [], SimpleNamespace(metadata={})

    async def fake_agent_loop(user_message, context, config, gateway):
        yield AgentEvent(
            type=AgentEventType.MESSAGE_START,
            message_id="msg_progress_direct",
        )
        yield AgentEvent(
            type=AgentEventType.MESSAGE_UPDATE,
            message_id="msg_progress_direct",
            text_delta="ok",
        )
        yield AgentEvent(type=AgentEventType.AGENT_END, stop_reason="completed")

    monkeypatch.setattr(agent_api.config_manager, "gateway", object())
    monkeypatch.setattr(
        agent_api.config_manager,
        "ai_config",
        SimpleNamespace(default_model="claude-opus-4-6", temperature=0.0, max_tokens=1024),
    )
    monkeypatch.setattr(agent_api.config_manager, "build_session_tools", fake_build_session_tools)
    monkeypatch.setattr(agent_api, "load_system_prompt", lambda _root: "test system prompt")
    monkeypatch.setattr(agent_api, "agent_loop", fake_agent_loop)

    async def collect_events():
        events: list[dict] = []
        async for raw in agent_api.event_generator(
            prompt="直接回复 ok",
            session_id=session_id,
            run_id="run_progress_direct",
        ):
            events.append(json.loads(raw))
        return events

    events = asyncio.run(collect_events())
    event_types = _extract_event_types(events)
    _assert_subsequence(
        event_types,
        [
            "progress",
            "progress",
            "message_start",
            "progress",
            "text_delta",
            "done",
        ],
    )

    progress_stages = [event["stage"] for event in events if event["type"] == "progress"]
    assert progress_stages == ["understanding", "selecting_tool", "generating_answer"]
    done_event = next(event for event in events if event["type"] == "done")
    assert done_event["reason"] == "completed"
    _reset_session(session_id)


def test_progress_events_for_tool_path_are_deduplicated(monkeypatch):
    session_id = "test_progress_tool_path"
    _reset_session(session_id)

    async def fake_build_session_tools(**kwargs):
        return [], SimpleNamespace(metadata={})

    async def fake_agent_loop(user_message, context, config, gateway):
        yield AgentEvent(
            type=AgentEventType.MESSAGE_START,
            message_id="msg_progress_tool",
        )
        yield AgentEvent(
            type=AgentEventType.TOOL_CALL_START,
            message_id="msg_progress_tool",
            tool_call_id="call_progress_1",
            tool_name="search",
            tool_args={"query": "sales"},
        )
        yield AgentEvent(
            type=AgentEventType.TOOL_EXECUTION_END,
            message_id="msg_progress_tool",
            tool_call_id="call_progress_1",
            tool_name="search",
            tool_args={"query": "sales"},
            tool_result=AgentToolResult(
                content=[ToolResultContent(type="text", text="result 1")],
                details={"rows": 1},
            ),
        )
        yield AgentEvent(
            type=AgentEventType.TOOL_CALL_START,
            message_id="msg_progress_tool",
            tool_call_id="call_progress_2",
            tool_name="search",
            tool_args={"query": "profit"},
        )
        yield AgentEvent(
            type=AgentEventType.TOOL_EXECUTION_END,
            message_id="msg_progress_tool",
            tool_call_id="call_progress_2",
            tool_name="search",
            tool_args={"query": "profit"},
            tool_result=AgentToolResult(
                content=[ToolResultContent(type="text", text="result 2")],
                details={"rows": 1},
            ),
        )
        yield AgentEvent(
            type=AgentEventType.MESSAGE_UPDATE,
            message_id="msg_progress_tool",
            text_delta="已完成分析",
        )
        yield AgentEvent(type=AgentEventType.AGENT_END, stop_reason="completed")

    monkeypatch.setattr(agent_api.config_manager, "gateway", object())
    monkeypatch.setattr(
        agent_api.config_manager,
        "ai_config",
        SimpleNamespace(default_model="claude-opus-4-6", temperature=0.0, max_tokens=1024),
    )
    monkeypatch.setattr(agent_api.config_manager, "build_session_tools", fake_build_session_tools)
    monkeypatch.setattr(agent_api, "load_system_prompt", lambda _root: "test system prompt")
    monkeypatch.setattr(agent_api, "agent_loop", fake_agent_loop)

    async def collect_events():
        events: list[dict] = []
        async for raw in agent_api.event_generator(
            prompt="查一下销售和利润",
            session_id=session_id,
            run_id="run_progress_tool",
        ):
            events.append(json.loads(raw))
        return events

    events = asyncio.run(collect_events())
    event_types = _extract_event_types(events)
    _assert_subsequence(
        event_types,
        [
            "progress",
            "progress",
            "message_start",
            "progress",
            "tool_call",
            "tool_result",
            "tool_call",
            "tool_result",
            "progress",
            "text_delta",
            "done",
        ],
    )

    progress_stages = [event["stage"] for event in events if event["type"] == "progress"]
    assert progress_stages == [
        "understanding",
        "selecting_tool",
        "executing_query",
        "generating_answer",
    ]
    assert progress_stages.count("executing_query") == 1
    _reset_session(session_id)


def test_progress_error_path_keeps_existing_error_flow(monkeypatch):
    session_id = "test_progress_error_path"
    _reset_session(session_id)

    async def fake_build_session_tools(**kwargs):
        return [], SimpleNamespace(metadata={})

    async def fake_agent_loop(user_message, context, config, gateway):
        yield AgentEvent(
            type=AgentEventType.MESSAGE_START,
            message_id="msg_progress_error",
        )
        yield AgentEvent(
            type=AgentEventType.ERROR,
            message_id="msg_progress_error",
            error="boom",
        )
        yield AgentEvent(type=AgentEventType.AGENT_END, stop_reason="error")

    monkeypatch.setattr(agent_api.config_manager, "gateway", object())
    monkeypatch.setattr(
        agent_api.config_manager,
        "ai_config",
        SimpleNamespace(default_model="claude-opus-4-6", temperature=0.0, max_tokens=1024),
    )
    monkeypatch.setattr(agent_api.config_manager, "build_session_tools", fake_build_session_tools)
    monkeypatch.setattr(agent_api, "load_system_prompt", lambda _root: "test system prompt")
    monkeypatch.setattr(agent_api, "agent_loop", fake_agent_loop)

    async def collect_events():
        events: list[dict] = []
        async for raw in agent_api.event_generator(
            prompt="触发错误",
            session_id=session_id,
            run_id="run_progress_error",
        ):
            events.append(json.loads(raw))
        return events

    events = asyncio.run(collect_events())
    progress_stages = [event["stage"] for event in events if event["type"] == "progress"]
    assert progress_stages == ["understanding", "selecting_tool"]
    assert any(event["type"] == "error" and event["error"] == "boom" for event in events)
    done_event = next(event for event in events if event["type"] == "done")
    assert done_event["reason"] == "error"
    _reset_session(session_id)


def test_clear_session_removes_widget_state(monkeypatch):
    session_id = "test_widget_clear"
    temp_dir = tempfile.TemporaryDirectory()
    workspace = SimpleNamespace(
        session_dir=Path(temp_dir.name),
        resolve_path=lambda relative_path: Path(temp_dir.name) / relative_path,
    )
    runtime = agent_api.SessionRuntime(
        session_id=session_id,
        context=SimpleNamespace(messages=[], active_skills=SimpleNamespace(to_dict=lambda: [])),
        workspace=workspace,
    )
    runtime.widgets["call_widget_clear"] = {"widget_id": "widget_sales", "status": "ready"}
    agent_api._session_runtimes[session_id] = runtime
    agent_api._sync_runtime_views(runtime)

    response = asyncio.run(agent_api.clear_session(session_id=session_id))

    assert response["status"] == "success"
    assert session_id not in agent_api._session_widgets
    assert session_id not in agent_api._session_context
    assert session_id not in agent_api._session_workspaces
    assert session_id not in agent_api._session_queues
    assert session_id not in agent_api._session_last_active
    temp_dir.cleanup()


def test_stop_endpoint_marks_running_session(monkeypatch):
    session_id = "test_stop_session"
    temp_dir = tempfile.TemporaryDirectory()
    runtime = agent_api.SessionRuntime(
        session_id=session_id,
        context=SimpleNamespace(messages=[], active_skills=SimpleNamespace(to_dict=lambda: [])),
        workspace=SimpleNamespace(session_dir=Path(temp_dir.name), resolve_path=lambda relative_path: Path(temp_dir.name) / relative_path),
    )
    runtime.active_run_id = "run_stop"
    runtime.active_run_task = SimpleNamespace(done=lambda: False)
    agent_api._session_runtimes[session_id] = runtime
    agent_api._sync_runtime_views(runtime)

    response = asyncio.run(agent_api.stop_agent(agent_api.StopRequest(session_id=session_id)))

    assert response["status"] == "success"
    assert response["stopped"] is True
    assert runtime.stop_requested is True
    _reset_session(session_id)
    temp_dir.cleanup()


def test_strip_unresolved_tool_calls_removes_dangling_calls():
    messages = [
        Message(role=Role.USER, content="first question", message_id="msg_user_1"),
        Message(
            role=Role.ASSISTANT,
            content="我来查询。",
            tool_calls=[
                ToolCall(id="call_done", name="tool_a", arguments={"q": 1}),
                ToolCall(id="call_pending", name="tool_b", arguments={"q": 2}),
            ],
            message_id="msg_assistant_1",
        ),
        Message(
            role=Role.TOOL_RESULT,
            content="done",
            tool_call_id="call_done",
            tool_name="tool_a",
            message_id="msg_assistant_1",
        ),
        Message(role=Role.USER, content="continue", message_id="msg_user_2"),
    ]

    sanitized_messages, removed_tool_call_ids = agent_api._strip_unresolved_tool_calls(
        messages
    )

    assert removed_tool_call_ids == ["call_pending"]
    assert len(sanitized_messages) == 4
    assert sanitized_messages[1].role == Role.ASSISTANT
    assert sanitized_messages[1].tool_calls is not None
    assert [tool_call.id for tool_call in sanitized_messages[1].tool_calls] == [
        "call_done"
    ]
    assert sanitized_messages[-1].content == "continue"


def test_load_session_snapshot_strips_unresolved_tool_calls():
    with tempfile.TemporaryDirectory() as temp_root:
        session_dir = Path(temp_root)
        snapshot_path = session_dir / agent_api.SNAPSHOT_FILE_NAME
        snapshot_path.write_text(
            json.dumps(
                {
                    "session_id": "session_snapshot_cleanup",
                    "updated_at": 1,
                    "messages": [
                        {
                            "role": "assistant",
                            "content": "我来查询。",
                            "tool_calls": [
                                {
                                    "id": "call_pending",
                                    "name": "qcc-company_get_company_registration_info",
                                    "arguments": {"searchKey": "深圳市日盛新材料有限公司"},
                                }
                            ],
                            "tool_call_id": None,
                            "tool_name": None,
                            "name": None,
                            "message_id": "msg_assistant_pending",
                        },
                        {
                            "role": "user",
                            "content": "继续",
                            "tool_calls": [],
                            "tool_call_id": None,
                            "tool_name": None,
                            "name": None,
                            "message_id": "msg_user_continue",
                        },
                    ],
                    "active_skills": [],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        messages, active_skills = agent_api._load_session_snapshot(
            SimpleNamespace(session_dir=session_dir)
        )

    assert len(messages) == 2
    assert messages[0].role == Role.ASSISTANT
    assert messages[0].tool_calls is None
    assert messages[0].content == "我来查询。"
    assert messages[1].role == Role.USER
    assert active_skills.to_dict() == []


def test_attached_files_are_scoped_to_session_workspace(monkeypatch):
    session_id = "test_attached_files"
    _reset_session(session_id)

    with tempfile.TemporaryDirectory() as temp_root:
        original_workspace_cls = agent_api.WorkspaceManager

        class _TempWorkspaceManager(original_workspace_cls):
            def __init__(self, root_dir=None, session_id=None):
                super().__init__(root_dir=temp_root, session_id=session_id)

        monkeypatch.setattr(agent_api, "WorkspaceManager", _TempWorkspaceManager)
        monkeypatch.setattr(agent_api.config_manager, "gateway", object())
        monkeypatch.setattr(
            agent_api.config_manager,
            "ai_config",
            SimpleNamespace(default_model="claude-opus-4-6", temperature=0.0, max_tokens=1024),
        )

        captured = {}

        async def fake_build_session_tools(**kwargs):
            return [], SimpleNamespace(metadata={})

        async def fake_agent_loop(user_message, context, config, gateway):
            captured["prompt"] = user_message
            yield AgentEvent(type=AgentEventType.AGENT_END, stop_reason="completed")

        monkeypatch.setattr(agent_api.config_manager, "build_session_tools", fake_build_session_tools)
        monkeypatch.setattr(agent_api, "load_system_prompt", lambda _root: "test system prompt")
        monkeypatch.setattr(agent_api, "agent_loop", fake_agent_loop)

        runtime = agent_api._ensure_session_runtime(session_id)
        runtime.workspace.write_file("data/report.txt", "hello from session")

        async def collect_events():
            async for _raw in agent_api.event_generator(
                prompt="请结合附件回答",
                session_id=session_id,
                attached_files=[f"{session_id}/data/report.txt"],
                run_id="run_attach",
            ):
                pass

        asyncio.run(collect_events())
        assert "hello from session" in captured["prompt"]
        _reset_session(session_id)


def test_web_runtime_injects_clarification_callback(monkeypatch):
    session_id = "test_clarification_injection"
    _reset_session(session_id)

    captured_overrides = {}

    async def fake_build_session_tools(**kwargs):
        captured_overrides.update(kwargs.get("runtime_overrides") or {})
        return [], SimpleNamespace(metadata={})

    async def fake_agent_loop(user_message, context, config, gateway):
        yield AgentEvent(type=AgentEventType.AGENT_END, stop_reason="completed")

    monkeypatch.setattr(agent_api.config_manager, "gateway", object())
    monkeypatch.setattr(
        agent_api.config_manager,
        "ai_config",
        SimpleNamespace(default_model="claude-opus-4-6", temperature=0.0, max_tokens=1024),
    )
    monkeypatch.setattr(agent_api.config_manager, "build_session_tools", fake_build_session_tools)
    monkeypatch.setattr(agent_api, "load_system_prompt", lambda _root: "test system prompt")
    monkeypatch.setattr(agent_api, "agent_loop", fake_agent_loop)

    async def collect_events():
        events: list[dict] = []
        async for raw in agent_api.event_generator(
            prompt="触发一次普通对话",
            session_id=session_id,
            run_id="run_clarification_injection",
        ):
            events.append(json.loads(raw))
        return events

    events = asyncio.run(collect_events())

    assert callable(captured_overrides.get("clarification_callback"))
    done_event = next(event for event in events if event["type"] == "done")
    assert done_event["reason"] == "completed"
    _reset_session(session_id)


def test_answer_clarification_resolves_pending_future():
    session_id = "test_answer_clarification"
    _reset_session(session_id)
    runtime = agent_api._ensure_session_runtime(session_id)

    loop = asyncio.new_event_loop()
    try:
        future = loop.create_future()
        runtime.pending_clarification = agent_api.PendingClarification(
            clarification_id="clar_test_1",
            question="请选择统计口径",
            options=["按月", "按年"],
            future=future,
        )
        runtime.event_queue = asyncio.Queue()

        result = loop.run_until_complete(
            agent_api.answer_clarification(
                agent_api.ClarificationAnswerRequest(
                    session_id=session_id,
                    clarification_id="clar_test_1",
                    answer="按月",
                )
            )
        )

        assert result["status"] == "success"
        assert future.done() is True
    finally:
        loop.close()
        _reset_session(session_id)


def test_agent_chat_rejects_busy_session():
    session_id = "busy_session"
    temp_dir = tempfile.TemporaryDirectory()
    runtime = agent_api.SessionRuntime(
        session_id=session_id,
        context=SimpleNamespace(messages=[], active_skills=SimpleNamespace(to_dict=lambda: [])),
        workspace=SimpleNamespace(session_dir=Path(temp_dir.name), resolve_path=lambda relative_path: Path(temp_dir.name) / relative_path),
    )
    runtime.active_run_id = "run_busy"
    runtime.active_run_task = SimpleNamespace(done=lambda: False)
    agent_api._session_runtimes[session_id] = runtime
    agent_api._sync_runtime_views(runtime)

    try:
        asyncio.run(agent_api.agent_chat(agent_api.ChatRequest(prompt="hi", session_id=session_id)))
        raise AssertionError("expected HTTPException")
    except agent_api.HTTPException as exc:
        assert exc.status_code == 409
    finally:
        _reset_session(session_id)
        temp_dir.cleanup()


def test_clear_session_shuts_down_cached_runtime_services():
    session_id = "test_cached_runtime_shutdown"
    _reset_session(session_id)

    class DummyRegistry:
        def __init__(self):
            self.shutdown_calls = 0

        async def shutdown(self):
            self.shutdown_calls += 1

    registry = DummyRegistry()
    temp_dir = tempfile.TemporaryDirectory()
    runtime = agent_api.SessionRuntime(
        session_id=session_id,
        context=SimpleNamespace(messages=[], active_skills=SimpleNamespace(to_dict=lambda: [])),
        workspace=SimpleNamespace(session_dir=Path(temp_dir.name), resolve_path=lambda relative_path: Path(temp_dir.name) / relative_path),
    )
    runtime.cached_runtime_services = SimpleNamespace(metadata={"mcp_registry": registry})
    runtime.cached_tools = [object()]
    runtime.cached_runtime_signature = "sig"
    agent_api._session_runtimes[session_id] = runtime
    agent_api._sync_runtime_views(runtime)

    response = asyncio.run(agent_api.clear_session(session_id=session_id))

    assert response["status"] == "success"
    assert registry.shutdown_calls == 1
    temp_dir.cleanup()


def test_event_generator_reuses_cached_session_tools(monkeypatch):
    session_id = "test_cached_session_tools"
    _reset_session(session_id)

    call_counter = {"build_session_tools": 0}

    class DummyRegistry:
        def __init__(self):
            self.shutdown_calls = 0

        async def shutdown(self):
            self.shutdown_calls += 1

    async def fake_build_session_tools(**kwargs):
        call_counter["build_session_tools"] += 1
        registry = DummyRegistry()
        return [SimpleNamespace(name="search_query_patterns")], SimpleNamespace(metadata={"mcp_registry": registry})

    async def fake_agent_loop(user_message, context, config, gateway):
        yield AgentEvent(type=AgentEventType.AGENT_END, stop_reason="completed")

    monkeypatch.setattr(agent_api.config_manager, "gateway", object())
    monkeypatch.setattr(
        agent_api.config_manager,
        "ai_config",
        SimpleNamespace(default_model="claude-opus-4-6", temperature=0.0, max_tokens=1024),
    )
    monkeypatch.setattr(agent_api.config_manager, "build_session_tools", fake_build_session_tools)
    monkeypatch.setattr(agent_api, "load_system_prompt", lambda _root: "test system prompt")
    monkeypatch.setattr(agent_api, "agent_loop", fake_agent_loop)

    async def run_once(run_id: str):
        async for _raw in agent_api.event_generator(
            prompt="测试缓存",
            session_id=session_id,
            run_id=run_id,
        ):
            pass

    asyncio.run(run_once("run-cache-1"))
    asyncio.run(run_once("run-cache-2"))

    runtime = agent_api._session_runtimes[session_id]
    assert call_counter["build_session_tools"] == 1
    assert runtime.cached_runtime_signature is not None
    _reset_session(session_id)
