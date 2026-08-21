import asyncio
import inspect
import json
import logging
import os
import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncGenerator
from uuid import uuid4

try:
    from fastapi import APIRouter, HTTPException, Request
except ImportError:  # test stubs may provide only the decorators used here
    from fastapi import APIRouter, HTTPException

    class Request:  # type: ignore[no-redef]
        pass
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from watchfiles import awatch

from src.ai.base_provider import Message, Role, ToolCall
from src.agent.agent_loop import agent_loop
from src.agent.context_builder import AgentContextBuilder
from src.agent.tool_search import ToolSearchCatalog
from src.agent.types import (
    AgentContext,
    AgentLoopConfig,
    AgentEventType,
    AgentTimingRecorder,
)
from src.config_manager import config_manager
from src.auth.service import ensure_local_user
from src.mcp.manager import mcp_manager
from src.persistence import chat_store
from src.prompts import load_system_prompt
from src.resilience.retry import reset_retry_event_handler, set_retry_event_handler
from src.semantic_startup import semantic_startup
from src.skills import (
    SkillRuntimeState,
    activate_skill_by_name,
    create_project_skill_manager,
    parse_skill_command,
)
from src.workspace.workspace_manager import WorkspaceManager

logger = logging.getLogger("data_agent.api.agent")

router = APIRouter(prefix="/agent", tags=["agent"])
context_builder = AgentContextBuilder()

SNAPSHOT_FILE_NAME = ".session_snapshot.json"
MAX_SESSIONS = 50
WATCHER_EXCLUDED_EXTS = {".py", ".pyc", ".log", ".tmp"}
PROGRESS_STAGES = (
    "understanding",
    "selecting_tool",
    "executing_query",
    "generating_answer",
)


class ChatRequest(BaseModel):
    prompt: str
    session_id: str = "default"
    attached_files: list[str] = []
    mcp_config: dict[str, Any] | None = None
    enabled_mcp_servers: list[str] | None = None


class SteerRequest(BaseModel):
    prompt: str
    session_id: str = "default"


class StopRequest(BaseModel):
    session_id: str = "default"


class ClarificationAnswerRequest(BaseModel):
    session_id: str = "default"
    clarification_id: str
    answer: str


class SkillInfo(BaseModel):
    name: str
    description: str
    when_to_use: str = ""
    location: str
    skill_dir: str
    source_scope: str
    allowed_tools: list[str] = []
    model: str | None = None


class SkillListResponse(BaseModel):
    status: str = "success"
    skills: list[SkillInfo] = []
    total: int = 0


class SessionMessageQueue:
    """浼氳瘽绾х敤鎴锋秷鎭槦鍒椼€?

    鍚屼竴鎵硅拷鍔犳秷鎭彲鍦?steering 妫€鏌ョ偣鎴栧嵆灏嗙粨鏉熸椂琚?follow-up 妫€鏌ョ偣娑堣垂銆?
    """

    def __init__(self):
        self._queue: asyncio.Queue[str] = asyncio.Queue()

    def put(self, message: str) -> None:
        self._queue.put_nowait(message)

    async def drain_messages(self) -> list[Message]:
        messages: list[Message] = []
        while not self._queue.empty():
            try:
                text = self._queue.get_nowait()
                messages.append(Message(role=Role.USER, content=text))
            except asyncio.QueueEmpty:
                break
        return messages

    async def get_steering_messages(self) -> list[Message]:
        return await self.drain_messages()

    async def get_follow_up_messages(self) -> list[Message]:
        return await self.drain_messages()


@dataclass
class PendingClarification:
    clarification_id: str
    question: str
    options: list[str] = field(default_factory=list)
    future: asyncio.Future[str] | None = None
    asked_at: float = field(default_factory=time.time)


@dataclass
class SessionRuntime:
    session_id: str
    context: AgentContext
    workspace: WorkspaceManager
    user_id: str = "local"
    input_queue: SessionMessageQueue = field(default_factory=SessionMessageQueue)
    widgets: dict[str, dict[str, Any]] = field(default_factory=dict)
    widget_partial_buffers: dict[str, str] = field(default_factory=dict)
    active_run_id: str | None = None
    active_run_task: asyncio.Task | None = None
    stop_requested: bool = False
    last_active: float = field(default_factory=time.time)
    pending_clarification: PendingClarification | None = None
    event_queue: asyncio.Queue | None = None
    cached_tools: list[Any] = field(default_factory=list)
    cached_runtime_services: Any | None = None
    cached_runtime_signature: str | None = None
    loaded_tool_names: set[str] = field(default_factory=set)

    def is_busy(self) -> bool:
        if self.active_run_id is None:
            return False
        if self.active_run_task is None:
            return True
        return not self.active_run_task.done()

    async def should_stop(self) -> bool:
        return self.stop_requested

    @property
    def snapshot_path(self) -> Path:
        return self.workspace.session_dir / SNAPSHOT_FILE_NAME


_session_runtimes: dict[str, SessionRuntime] = {}
_session_context: dict[str, AgentContext] = {}
_session_workspaces: dict[str, WorkspaceManager] = {}
_session_widgets: dict[str, dict[str, dict[str, Any]]] = {}
_session_last_active: dict[str, float] = {}
_session_queues: dict[str, SessionMessageQueue] = {}
_session_prepare_locks: dict[str, asyncio.Lock] = {}


def _runtime_key(user_id: str, session_id: str) -> str:
    if user_id == "local":
        return session_id
    return f"{user_id}:{session_id}"


def _request_user_id(request: Request | None) -> str:
    user = getattr(getattr(request, "state", None), "current_user", None)
    if user is not None:
        return str(user.id)
    return ensure_local_user().id


def _sync_runtime_views(runtime: SessionRuntime) -> None:
    _session_context[runtime.session_id] = runtime.context
    _session_workspaces[runtime.session_id] = runtime.workspace
    _session_widgets[runtime.session_id] = runtime.widgets
    _session_last_active[runtime.session_id] = runtime.last_active
    _session_queues[runtime.session_id] = runtime.input_queue


def _remove_runtime_views(session_id: str) -> None:
    _session_context.pop(session_id, None)
    _session_workspaces.pop(session_id, None)
    _session_queues.pop(session_id, None)
    _session_widgets.pop(session_id, None)
    _session_last_active.pop(session_id, None)


def _cancel_pending_clarification(runtime: SessionRuntime) -> None:
    pending = runtime.pending_clarification
    runtime.pending_clarification = None
    if pending and pending.future and not pending.future.done():
        pending.future.cancel()


def _build_web_clarification_callback(runtime: SessionRuntime):
    async def ask_user(question: str, options: list[str]) -> str:
        pending = runtime.pending_clarification
        if pending and pending.future and not pending.future.done():
            pending.future.cancel()

        loop = asyncio.get_running_loop()
        future: asyncio.Future[str] = loop.create_future()
        clarification = PendingClarification(
            clarification_id=f"clar_{uuid4().hex[:24]}",
            question=question,
            options=list(options or []),
            future=future,
        )
        runtime.pending_clarification = clarification
        runtime.last_active = time.time()
        _sync_runtime_views(runtime)

        if runtime.event_queue is not None:
            await runtime.event_queue.put(
                {
                    "type": "clarification_request",
                    "session_id": runtime.session_id,
                    "clarification_id": clarification.clarification_id,
                    "question": question,
                    "options": clarification.options,
                }
            )

        try:
            answer = await future
            return answer
        finally:
            if runtime.pending_clarification and runtime.pending_clarification.clarification_id == clarification.clarification_id:
                runtime.pending_clarification = None
                _sync_runtime_views(runtime)

    return ask_user


def _build_skill_manager():
    return create_project_skill_manager(config_manager.project_root)


def _format_sse_payload(data: dict[str, Any]) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def _emit_progress_event(
    event_queue: asyncio.Queue,
    session_id: str,
    emitted_stages: set[str],
    stage: str,
) -> bool:
    if stage not in PROGRESS_STAGES or stage in emitted_stages:
        return False
    emitted_stages.add(stage)
    event_queue.put_nowait(
        {
            "type": "progress",
            "session_id": session_id,
            "stage": stage,
        }
    )
    return True


def _record_active_skill(context: AgentContext, details: dict) -> dict:
    state = context.active_skills.record_activation(details)
    return state.to_dict()


def _apply_slash_skill_activation(prompt: str, context: AgentContext) -> str:
    parsed = parse_skill_command(prompt)
    if not parsed:
        return prompt

    try:
        details = activate_skill_by_name(
            _build_skill_manager(),
            parsed.skill_name,
            source="slash_command",
            command_text=parsed.raw_command,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    context.messages.append(Message(role=Role.USER, content=details["ui_message"]))
    context.messages.append(
        Message(role=Role.USER, content=details["model_message_injection"])
    )
    _record_active_skill(context, details)

    if parsed.remainder:
        return parsed.remainder
    return f"Skill activated: {parsed.skill_name}. Continue with this skill."


def _runtime_signature(
    mcp_config: dict[str, Any] | None,
    enabled_mcp_servers: list[str] | None,
    provider_fingerprint: str = "",
    python_runtime: dict[str, Any] | None = None,
    mcp_runtime: list[dict[str, Any]] | None = None,
) -> str:
    payload = {
        "mcp_config": mcp_config or {},
        "enabled_mcp_servers": (
            None if enabled_mcp_servers is None else sorted(enabled_mcp_servers)
        ),
        "provider_fingerprint": provider_fingerprint,
        "python_runtime": python_runtime or {},
        "mcp_runtime": mcp_runtime or [],
    }
    return json.dumps(payload, sort_keys=True, ensure_ascii=False)


def _invalidate_session_tool_cache(runtime: SessionRuntime) -> None:
    runtime.cached_tools = []
    runtime.cached_runtime_services = None
    runtime.cached_runtime_signature = None


def _remember_loaded_tools(runtime: SessionRuntime, loaded_names: set[str]) -> None:
    runtime.loaded_tool_names = set(loaded_names)


async def _shutdown_runtime_services(runtime_services: Any | None) -> None:
    if runtime_services is None:
        return

    metadata = getattr(runtime_services, "metadata", None)
    if not isinstance(metadata, dict):
        return

    mcp_registry = metadata.get("mcp_registry")
    if mcp_registry is None:
        return

    shutdown = getattr(mcp_registry, "shutdown", None)
    if shutdown is None:
        return

    result = shutdown()
    if inspect.isawaitable(result):
        await result


def _get_prepare_lock(runtime: SessionRuntime) -> asyncio.Lock:
    key = _runtime_key(runtime.user_id, runtime.session_id)
    lock = _session_prepare_locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _session_prepare_locks[key] = lock
    return lock


async def _prepare_session_runtime(
    runtime: SessionRuntime,
    *,
    mcp_config: dict[str, Any] | None = None,
    enabled_mcp_servers: list[str] | None = None,
    timing: AgentTimingRecorder | None = None,
) -> dict[str, Any]:
    runtime_overrides = {"mcp_config": mcp_config} if mcp_config else {}
    python_runtime = config_manager.get_python_runtime_config()
    runtime_overrides["python_runtime"] = python_runtime
    runtime_overrides["clarification_callback"] = _build_web_clarification_callback(runtime)
    runtime_signature = _runtime_signature(
        mcp_config,
        enabled_mcp_servers,
        provider_fingerprint=config_manager.tool_assembly.provider_fingerprint,
        python_runtime=python_runtime,
        mcp_runtime=mcp_manager.runtime_fingerprint(enabled_mcp_servers),
    )

    async with _get_prepare_lock(runtime):
        cache_hit = runtime.cached_runtime_signature == runtime_signature and bool(runtime.cached_tools)
        if cache_hit:
            if timing is not None:
                timing.mark_once("session_tools_start")
                timing.set_value("session_tools_cache", "hit")
                timing.mark_once(
                    "session_tools_ready",
                    tool_count=len(runtime.cached_tools),
                    cache="hit",
                )
            tools = runtime.cached_tools
            runtime_services = runtime.cached_runtime_services
        else:
            if timing is not None:
                timing.set_value("session_tools_cache", "miss")
            if runtime.cached_runtime_services is not None:
                await _shutdown_runtime_services(runtime.cached_runtime_services)
                _invalidate_session_tool_cache(runtime)
            tools, runtime_services = await config_manager.build_session_tools(
                session_id=runtime.session_id,
                workspace=runtime.workspace,
                runtime_overrides=runtime_overrides,
                enabled_mcp_servers=enabled_mcp_servers,
                timing=timing,
            )
            runtime.cached_tools = tools
            runtime.cached_runtime_services = runtime_services
            runtime.cached_runtime_signature = runtime_signature

        existing_catalog = getattr(runtime.context, "tool_catalog", None)
        existing_loaded_names = getattr(existing_catalog, "loaded_tool_names", set())
        initial_loaded_names = set(runtime.loaded_tool_names) | set(existing_loaded_names)
        tool_catalog = ToolSearchCatalog(
            tools,
            initial_loaded_names=initial_loaded_names,
            timing=timing,
            on_loaded_change=lambda names: _remember_loaded_tools(runtime, names),
        )
        _remember_loaded_tools(runtime, tool_catalog.loaded_tool_names)
        model_tools = tool_catalog.visible_tools()
        known_tools = tool_catalog.known_tools()
        if timing is not None:
            timing.set_value("full_tool_count", tool_catalog.total_tool_count)
            timing.set_value("model_tool_count", len(model_tools))
            timing.set_value("deferred_tool_count", tool_catalog.deferred_tool_count)

        build_result = context_builder.build(
            system_prompt=load_system_prompt(config_manager.project_root),
            messages=_sanitize_context_messages_for_model(runtime, reason="prepare"),
            tools=model_tools,
            known_tools=known_tools,
            tool_catalog=tool_catalog,
            active_skills=runtime.context.active_skills,
            timing=timing,
        )
        runtime.context = build_result.context
        runtime.last_active = time.time()
        _sync_runtime_views(runtime)
        if timing is not None:
            timing.mark_once(
                "context_ready",
                tool_count=len(model_tools),
                full_tool_count=tool_catalog.total_tool_count,
                deferred_tool_count=tool_catalog.deferred_tool_count,
                message_count=build_result.message_count,
            )
        logger.info(
            "[Context] prepared session runtime: session=%s model_tools=%s full_tools=%s deferred_tools=%s cache=%s",
            runtime.session_id,
            len(model_tools),
            tool_catalog.total_tool_count,
            tool_catalog.deferred_tool_count,
            "hit" if cache_hit else "miss",
        )
        return {
            "prepared": True,
            "cache": "hit" if cache_hit else "miss",
            "tool_count": tool_catalog.total_tool_count,
            "model_tool_count": len(model_tools),
            "deferred_tool_count": tool_catalog.deferred_tool_count,
            "tool_search_enabled": True,
            "runtime_services": runtime_services,
        }


def _generate_run_id() -> str:
    return f"run_{uuid4().hex[:24]}"


def _serialize_tool_call(tool_call: ToolCall) -> dict[str, Any]:
    return {
        "id": tool_call.id,
        "name": tool_call.name,
        "arguments": tool_call.arguments,
    }


def _deserialize_tool_call(data: dict[str, Any]) -> ToolCall:
    return ToolCall(
        id=str(data.get("id", "")),
        name=str(data.get("name", "")),
        arguments=dict(data.get("arguments") or {}),
    )


def _serialize_message(message: Message) -> dict[str, Any]:
    return {
        "role": message.role.value if hasattr(message.role, "value") else str(message.role),
        "content": message.content,
        "tool_calls": [
            _serialize_tool_call(tool_call) for tool_call in (message.tool_calls or [])
        ],
        "tool_call_id": message.tool_call_id,
        "tool_name": message.tool_name,
        "name": message.name,
        "message_id": message.message_id,
        "reasoning_content": message.reasoning_content,
    }


def _deserialize_message(data: dict[str, Any]) -> Message:
    tool_calls = data.get("tool_calls") or None
    return Message(
        role=Role(str(data.get("role", Role.USER.value))),
        content=str(data.get("content", "")),
        tool_calls=[_deserialize_tool_call(item) for item in tool_calls] if tool_calls else None,
        tool_call_id=data.get("tool_call_id"),
        tool_name=data.get("tool_name"),
        name=data.get("name"),
        message_id=data.get("message_id"),
        reasoning_content=data.get("reasoning_content"),
    )


def _strip_unresolved_tool_calls(
    messages: list[Message],
) -> tuple[list[Message], list[str]]:
    sanitized_messages: list[Message] = []
    removed_tool_call_ids: list[str] = []
    index = 0

    while index < len(messages):
        message = messages[index]
        if message.role != Role.ASSISTANT or not message.tool_calls:
            if message.role != Role.TOOL_RESULT:
                sanitized_messages.append(message)
            elif message.tool_call_id:
                removed_tool_call_ids.append(str(message.tool_call_id))
            index += 1
            continue

        following_tool_results: list[Message] = []
        next_index = index + 1
        while (
            next_index < len(messages)
            and messages[next_index].role == Role.TOOL_RESULT
        ):
            following_tool_results.append(messages[next_index])
            next_index += 1

        following_tool_call_ids = {
            str(tool_result.tool_call_id)
            for tool_result in following_tool_results
            if tool_result.tool_call_id
        }
        resolved_tool_calls = [
            tool_call
            for tool_call in message.tool_calls
            if tool_call.id and tool_call.id in following_tool_call_ids
        ]
        if len(resolved_tool_calls) == len(message.tool_calls):
            sanitized_messages.append(message)
            sanitized_messages.extend(following_tool_results)
            index = next_index
            continue

        removed_tool_call_ids.extend(
            tool_call.id
            for tool_call in message.tool_calls
            if not tool_call.id or tool_call.id not in following_tool_call_ids
        )
        resolved_tool_call_ids = {tool_call.id for tool_call in resolved_tool_calls}
        removed_tool_call_ids.extend(
            str(tool_result.tool_call_id)
            for tool_result in following_tool_results
            if tool_result.tool_call_id
            and str(tool_result.tool_call_id) not in resolved_tool_call_ids
        )

        if resolved_tool_calls or message.content:
            sanitized_messages.append(
                Message(
                    role=message.role,
                    content=message.content,
                    tool_calls=resolved_tool_calls or None,
                    tool_call_id=message.tool_call_id,
                    tool_name=message.tool_name,
                    name=message.name,
                    message_id=message.message_id,
                    reasoning_content=message.reasoning_content,
                )
            )
        sanitized_messages.extend(
            tool_result
            for tool_result in following_tool_results
            if tool_result.tool_call_id
            and str(tool_result.tool_call_id) in resolved_tool_call_ids
        )
        index = next_index

    deduped_removed_tool_call_ids = list(dict.fromkeys(removed_tool_call_ids))
    return sanitized_messages, deduped_removed_tool_call_ids


def _sanitize_context_messages_for_model(
    runtime: SessionRuntime,
    *,
    reason: str,
) -> list[Message]:
    sanitized_messages, removed_tool_call_ids = _strip_unresolved_tool_calls(
        runtime.context.messages
    )
    if not removed_tool_call_ids:
        return runtime.context.messages
    runtime.context.messages = sanitized_messages
    logger.info(
        "[Session] 清理模型上下文中的未完成 tool_call: session=%s reason=%s removed=%s",
        runtime.session_id,
        reason,
        ",".join(removed_tool_call_ids),
    )
    return sanitized_messages


def _sanitize_runtime_messages(
    runtime: SessionRuntime,
    *,
    reason: str,
    phase: str,
) -> None:
    sanitized_messages, removed_tool_call_ids = _strip_unresolved_tool_calls(
        runtime.context.messages
    )
    if not removed_tool_call_ids:
        return
    runtime.context.messages = sanitized_messages
    logger.info(
        "[Session] %s 娓呯悊鏈畬鎴?tool_call: session=%s reason=%s removed=%s",
        phase,
        runtime.session_id,
        reason,
        ",".join(removed_tool_call_ids),
    )


def _load_session_snapshot(
    workspace: WorkspaceManager,
    *,
    user_id: str | None = None,
    session_id: str | None = None,
) -> tuple[list[Message], SkillRuntimeState]:
    effective_user_id = user_id or ensure_local_user().id
    effective_session_id = session_id or workspace.session_dir.name
    record = chat_store.get_session(effective_user_id, effective_session_id)
    if record is not None and record.context_messages:
        messages = [
            _deserialize_message(item)
            for item in record.context_messages
            if isinstance(item, dict)
        ]
        messages, removed_tool_call_ids = _strip_unresolved_tool_calls(messages)
        if removed_tool_call_ids:
            logger.warning(
                "[Session] Restored DB snapshot with unresolved tool calls removed: %s removed=%s",
                effective_session_id,
                ",".join(removed_tool_call_ids),
            )
        return messages, SkillRuntimeState.from_dict(record.active_skills)

    snapshot_path = workspace.session_dir / SNAPSHOT_FILE_NAME
    if not snapshot_path.exists():
        return [], SkillRuntimeState()

    try:
        payload = json.loads(snapshot_path.read_text(encoding="utf-8"))
        messages = [
            _deserialize_message(item)
            for item in list(payload.get("messages") or [])
            if isinstance(item, dict)
        ]
        messages, removed_tool_call_ids = _strip_unresolved_tool_calls(messages)
        if removed_tool_call_ids:
            logger.warning(
                "[Session] 鎭㈠蹇収鏃舵竻鐞嗘湭瀹屾垚 tool_call: %s removed=%s",
                workspace.session_dir.name,
                ",".join(removed_tool_call_ids),
            )
        active_skills = SkillRuntimeState.from_dict(payload.get("active_skills") or [])
        logger.info("[Session] 宸叉仮澶嶄細璇濆揩鐓? %s", workspace.session_dir.name)
        return messages, active_skills
    except Exception as exc:
        logger.warning("[Session] 璇诲彇浼氳瘽蹇収澶辫触 %s: %s", snapshot_path, exc)
        return [], SkillRuntimeState()


def _persist_session_snapshot(runtime: SessionRuntime) -> None:
    chat_store.update_context_snapshot(
        runtime.user_id,
        runtime.session_id,
        [_serialize_message(message) for message in runtime.context.messages],
        runtime.context.active_skills.to_dict(),
    )


def _clear_session_snapshot(runtime: SessionRuntime) -> None:
    try:
        if runtime.snapshot_path.exists():
            runtime.snapshot_path.unlink()
    except Exception as exc:
        logger.warning("[Session] 鍒犻櫎浼氳瘽蹇収澶辫触 %s: %s", runtime.snapshot_path, exc)


def _ensure_session_runtime(session_id: str, user_id: str | None = None) -> SessionRuntime:
    effective_user_id = user_id or ensure_local_user().id
    key = _runtime_key(effective_user_id, session_id)
    runtime = _session_runtimes.get(key)
    if runtime is not None:
        runtime.last_active = time.time()
        _sync_runtime_views(runtime)
        return runtime

    chat_store.ensure_session(effective_user_id, session_id)
    workspace = WorkspaceManager(session_id=session_id)
    restored_messages, restored_skills = _load_session_snapshot(
        workspace,
        user_id=effective_user_id,
        session_id=session_id,
    )
    runtime = SessionRuntime(
        user_id=effective_user_id,
        session_id=session_id,
        context=AgentContext(
            system_prompt=load_system_prompt(config_manager.project_root),
            messages=restored_messages,
            active_skills=restored_skills,
        ),
        workspace=workspace,
    )
    _session_runtimes[key] = runtime
    _sync_runtime_views(runtime)
    logger.info("[Session] 宸茶杞戒細璇濊繍琛屾椂: %s", session_id)
    return runtime


def _ensure_session_widget_store(session_id: str) -> dict[str, dict[str, Any]]:
    return _ensure_session_runtime(session_id).widgets


async def _cleanup_session_state_async(session_id: str, user_id: str | None = None) -> None:
    key = _runtime_key(user_id or ensure_local_user().id, session_id)
    runtime = _session_runtimes.pop(key, None)
    if runtime is None and key != session_id:
        runtime = _session_runtimes.pop(session_id, None)
    if runtime is not None:
        runtime.active_run_id = None
        runtime.active_run_task = None
        runtime.stop_requested = False
        cached_runtime_services = runtime.cached_runtime_services
        _invalidate_session_tool_cache(runtime)
        await _shutdown_runtime_services(cached_runtime_services)
    _session_prepare_locks.pop(key, None)
    _remove_runtime_views(session_id)


def _cleanup_session_state(session_id: str, user_id: str | None = None) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        asyncio.run(_cleanup_session_state_async(session_id, user_id))
    else:
        loop.create_task(_cleanup_session_state_async(session_id, user_id))


def _lru_cleanup_sessions() -> None:
    if len(_session_runtimes) <= MAX_SESSIONS:
        return

    removable = sorted(
        (runtime for runtime in _session_runtimes.values() if not runtime.is_busy()),
        key=lambda item: item.last_active,
    )
    to_remove = max(1, len(_session_runtimes) - MAX_SESSIONS)
    for runtime in removable[:to_remove]:
        _cleanup_session_state(runtime.session_id, runtime.user_id)
        logger.info("[LRU] 娓呯悊闈炴椿璺冧細璇? %s", runtime.session_id)


def _build_widget_error_text(tool_result: Any) -> str:
    if tool_result and getattr(tool_result, "content", None):
        text = "\n".join(c.text for c in tool_result.content if c.text)
        if text:
            return text
    return "缁勪欢娓叉煋澶辫触"


def _build_tool_result_text(tool_result: Any) -> str:
    if not tool_result:
        return ""
    return "\n".join(c.text for c in tool_result.content if c.text)


def _build_tool_result_details(tool_result: Any) -> dict[str, Any]:
    return dict(getattr(tool_result, "details", {}) or {})


def _message_id_for_event(event: Any) -> str:
    return getattr(event, "message_id", "") or ""


def _widget_store_key(message_id: str, tool_call_id: str, widget_id: str | None) -> str:
    if tool_call_id:
        return tool_call_id
    return f"{message_id}:{widget_id or 'widget'}"


def _tool_widget_id(tool_name: str, details: dict[str, Any], tool_call_id: str) -> str | None:
    if tool_name != "show_widget":
        return None
    return str(details.get("widget_id") or tool_call_id)


def _build_widget_patch_from_partial(partial_arguments: str) -> dict[str, Any]:
    patch: dict[str, Any] = {}
    if not partial_arguments:
        return patch

    for key in ["widget_id", "kind", "title", "subtitle"]:
        marker = f'"{key}"'
        idx = partial_arguments.rfind(marker)
        if idx == -1:
            continue
        tail = partial_arguments[idx:]
        colon_idx = tail.find(":")
        if colon_idx == -1:
            continue
        value_part = tail[colon_idx + 1 :].lstrip()
        if not value_part.startswith('"'):
            continue
        end_quote = value_part.find('"', 1)
        if end_quote == -1:
            continue
        raw_value = value_part[1:end_quote]
        patch[key] = raw_value.replace('\\"', '"')

    return patch


async def _enqueue_widget_preview(
    event_queue: asyncio.Queue,
    runtime: SessionRuntime,
    message_id: str,
    tool_call_id: str,
    tool_name: str,
    partial_arguments: str,
) -> None:
    if tool_name != "show_widget":
        return

    accumulated = runtime.widget_partial_buffers.get(tool_call_id, "") + (partial_arguments or "")
    runtime.widget_partial_buffers[tool_call_id] = accumulated
    patch = _build_widget_patch_from_partial(accumulated)
    widget_id = str(patch.get("widget_id") or tool_call_id)
    store_key = _widget_store_key(message_id, tool_call_id, widget_id)
    current = runtime.widgets.get(store_key, {})
    runtime.widgets[store_key] = {
        **current,
        **patch,
        "widget_id": widget_id,
        "tool_call_id": tool_call_id,
        "message_id": message_id,
        "status": "previewing",
        "session_id": runtime.session_id,
    }
    _sync_runtime_views(runtime)
    await event_queue.put(
        {
            "type": "widget_patch",
            "session_id": runtime.session_id,
            "message_id": message_id,
            "tool_call_id": tool_call_id,
            "widget_id": widget_id,
            "tool_name": tool_name,
            "patch": patch,
        }
    )


async def _watch_workspace(workspace_dir: Path, event_queue: asyncio.Queue):
    logger.info("[Watcher] 寮€濮嬬洃鎺у伐浣滃尯: %s", workspace_dir)
    try:
        async for changes in awatch(workspace_dir):
            relevant = any(
                Path(path).suffix.lower() not in WATCHER_EXCLUDED_EXTS
                for _change_type, path in changes
            )
            if not relevant:
                continue

            await asyncio.sleep(0.5)
            await event_queue.put({"type": "workspace_updated", "tool": "watcher"})
    except asyncio.CancelledError:
        logger.info("[Watcher] workspace watcher cancelled")
    except Exception as exc:
        logger.error("[Watcher] 鐩戞帶鍑洪敊: %s", exc)


def _resolve_attached_file_path(runtime: SessionRuntime, rel_path: str) -> tuple[Path, str]:
    cleaned = os.path.normpath(rel_path).replace("\\", "/")
    if cleaned.startswith("../") or cleaned == "..":
        raise ValueError("闄勪欢璺緞闈炴硶")

    parts = [part for part in Path(cleaned).parts if part not in {".", ""}]
    if parts and parts[0] == runtime.session_id:
        relative_parts = parts[1:]
    else:
        allowed_roots = {"data", "scripts", "output"}
        if parts and parts[0] not in allowed_roots:
            raise ValueError("Attachment must come from the current session workspace")
        relative_parts = parts

    session_relative = "/".join(relative_parts)
    full_path = runtime.workspace.resolve_path(session_relative)
    display_path = f"{runtime.session_id}/{session_relative}" if session_relative else runtime.session_id
    return full_path, display_path


def _build_attached_file_prompt(
    runtime: SessionRuntime,
    attached_files: list[str],
    timing: AgentTimingRecorder | None = None,
) -> str:
    file_contexts: list[str] = []
    for rel_path in attached_files:
        try:
            full_path, display_path = _resolve_attached_file_path(runtime, rel_path)
            if full_path.exists() and full_path.is_file():
                content = full_path.read_text(encoding="utf-8", errors="replace")
                if len(content) > 5000:
                    preview = content[:2000]
                    file_contexts.append(
                        f"--- 闄勪欢: {display_path} (鏂囦欢杈冨ぇ锛屼粎鎻愪緵鍓?000瀛楃棰勮) ---\n"
                        f"{preview}\n\n"
                        f"[閲嶈鎻愮ず锛氳鏂囦欢瀹屾暣澶у皬涓?{len(content)} 瀛楃銆備负閬垮厤涓婁笅鏂囪秴闄愶紝鐩墠浠呭睍绀轰簡寮€澶撮儴鍒嗐€傝鍔″繀浣跨敤 `read_file`, `grep_search` 绛夊伐浣滃尯宸ュ叿鏉ヨ鍙栨垨鎼滅储鍏抽敭淇℃伅锛屼笉瑕佸嚟鍊熸埅鏂殑鏂囨湰杩涜鐚滄祴銆俔\n"
                        f"--- 闄勪欢缁撴潫 ---"
                    )
                else:
                    file_contexts.append(
                        f"--- 闄勪欢: {display_path} ---\n{content}\n--- 闄勪欢缁撴潫 ---"
                    )
        except Exception as exc:
            logger.warning("[Context] 璇诲彇闄勪欢澶辫触 %s: %s", rel_path, exc)

    if timing is not None:
        timing.mark_once(
            "attachments_read_done",
            attachment_count=len(attached_files),
            attachment_context_count=len(file_contexts),
        )
    return "\n\n".join(file_contexts)


async def event_generator(
    prompt: str,
    session_id: str = "default",
    attached_files: list[str] | None = None,
    mcp_config: dict[str, Any] | None = None,
    enabled_mcp_servers: list[str] | None = None,
    run_id: str | None = None,
    user_id: str | None = None,
) -> AsyncGenerator[str, None]:
    config_manager.llm_profiles.apply_default_to(config_manager.ai_config)
    gateway = config_manager.gateway
    ai_config = config_manager.ai_config

    if not gateway:
        yield json.dumps(
            {"type": "error", "session_id": session_id, "error": "Gateway 鏈垵濮嬪寲"},
            ensure_ascii=False,
        )
        yield json.dumps(
            {"type": "done", "session_id": session_id, "reason": "error"},
            ensure_ascii=False,
        )
        return

    effective_user_id = user_id or ensure_local_user().id
    runtime = _ensure_session_runtime(session_id, effective_user_id)
    claimed_run_id = run_id or runtime.active_run_id or _generate_run_id()
    if runtime.active_run_id is not None and runtime.active_run_id != claimed_run_id:
        yield json.dumps(
            {"type": "error", "session_id": session_id, "error": "浼氳瘽宸叉湁杩愯涓殑浠诲姟"},
            ensure_ascii=False,
        )
        yield json.dumps(
            {"type": "done", "session_id": session_id, "reason": "error"},
            ensure_ascii=False,
        )
        return

    timing = AgentTimingRecorder(req=claimed_run_id, session=session_id)
    timing.mark_once("request_start")
    timing.mark_once("workspace_ready", workspace=str(runtime.workspace.session_dir))
    runtime.context.timing = timing

    runtime.active_run_id = claimed_run_id
    runtime.stop_requested = False
    runtime.last_active = time.time()
    _lru_cleanup_sessions()
    _sync_runtime_views(runtime)

    event_queue: asyncio.Queue = asyncio.Queue()
    runtime.event_queue = event_queue
    emitted_progress_stages: set[str] = set()

    def finish_active_run() -> None:
        if runtime.active_run_id == claimed_run_id:
            runtime.active_run_id = None
            runtime.active_run_task = None
            runtime.stop_requested = False
            runtime.widget_partial_buffers.clear()
            runtime.last_active = time.time()
            _cancel_pending_clarification(runtime)
            runtime.event_queue = None
            _sync_runtime_views(runtime)

    try:
        yield json.dumps(
            {
                "type": "run_start",
                "session_id": session_id,
                "run_id": claimed_run_id,
            },
            ensure_ascii=False,
        )
        timing.set_value("first_sse_type", "run_start")
        timing.mark_once("first_sse")
        yield json.dumps(
            {
                "type": "status",
                "session_id": session_id,
                "run_id": claimed_run_id,
                "phase": "preparing",
                "message": "正在准备运行环境",
            },
            ensure_ascii=False,
        )
        timing.mark_once("first_visible_text")
        yield json.dumps(
            {
                "type": "text_delta",
                "session_id": session_id,
                "ephemeral": True,
                "content": "收到，我正在分析请求并检索可用工具。\n\n",
            },
            ensure_ascii=False,
        )
    except GeneratorExit:
        finish_active_run()
        raise

    async def emit_retry_event(payload: dict[str, Any]) -> None:
        timing.add_counter("retry_attempts")
        await event_queue.put(
            {
                "type": "auto_retry",
                "session_id": session_id,
                **payload,
            }
        )

    def emit_progress(stage: str) -> None:
        _emit_progress_event(event_queue, session_id, emitted_progress_stages, stage)

    session_runtime_services = None
    agent_task: asyncio.Task | None = None
    watcher_task: asyncio.Task | None = None
    terminal_status = "completed"
    terminal_reason = "completed"

    try:
        prepare_result = await _prepare_session_runtime(
            runtime,
            mcp_config=mcp_config,
            enabled_mcp_servers=enabled_mcp_servers,
            timing=timing,
        )
        session_runtime_services = prepare_result.get("runtime_services")

        active_skill_count_before = len(runtime.context.active_skills.list_active_skills())
        enriched_prompt = _apply_slash_skill_activation(prompt, runtime.context)
        slash_activated_skills = [
            s.to_dict()
            for s in runtime.context.active_skills.list_active_skills()[active_skill_count_before:]
        ]

        if attached_files:
            file_context = _build_attached_file_prompt(runtime, attached_files, timing)
            if file_context:
                enriched_prompt = (
                    "The user attached the following reference files. Use them when answering.\n\n"
                    + file_context
                    + f"\n\nUser question: {enriched_prompt}"
                )
        else:
            timing.mark_once("attachments_read_done", attachment_count=0, attachment_context_count=0)

        config = AgentLoopConfig(
            model=ai_config.default_model,
            temperature=ai_config.temperature,
            max_tokens=ai_config.max_tokens,
            get_steering_messages=runtime.input_queue.get_steering_messages,
            get_follow_up_messages=runtime.input_queue.get_follow_up_messages,
            should_stop=runtime.should_stop,
            timing=timing,
        )

        emit_progress("understanding")
        await event_queue.put(
            {
                "type": "status",
                "session_id": session_id,
                "run_id": claimed_run_id,
                "phase": "calling_model",
                "message": "正在连接模型",
            }
        )

        async def run_agent() -> None:
            nonlocal terminal_reason, terminal_status
            terminal_emitted = False
            local_terminal_reason = "completed"
            assistant_text_started = False
            tool_heartbeat_tasks: dict[str, asyncio.Task] = {}

            async def emit_tool_heartbeat(
                *,
                message_id: str,
                tool_call_id: str,
                tool_name: str,
            ) -> None:
                started_at = time.perf_counter()
                phase = "validating_sql" if tool_name == "execute_sql" else "running"
                await event_queue.put(
                    {
                        "type": "tool_progress",
                        "session_id": session_id,
                        "message_id": message_id,
                        "tool_call_id": tool_call_id,
                        "name": tool_name,
                        "phase": phase,
                        "elapsed_ms": 0,
                    }
                )
                try:
                    while True:
                        await asyncio.sleep(1.0)
                        elapsed_ms = round((time.perf_counter() - started_at) * 1000)
                        await event_queue.put(
                            {
                                "type": "tool_progress",
                                "session_id": session_id,
                                "message_id": message_id,
                                "tool_call_id": tool_call_id,
                                "name": tool_name,
                                "phase": "running_query" if tool_name == "execute_sql" else "running",
                                "elapsed_ms": elapsed_ms,
                            }
                        )
                except asyncio.CancelledError:
                    return

            async def stop_tool_heartbeat(tool_call_id: str) -> None:
                task = tool_heartbeat_tasks.pop(tool_call_id, None)
                if task is None:
                    return
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)

            async def emit_done(reason: str) -> None:
                nonlocal terminal_emitted
                if terminal_emitted:
                    return
                terminal_emitted = True
                await event_queue.put(
                    {
                        "type": "workspace_updated",
                        "session_id": session_id,
                        "tool": "agent_done",
                    }
                )
                await event_queue.put(
                    {
                        "type": "done",
                        "session_id": session_id,
                        "run_id": claimed_run_id,
                        "reason": reason,
                    }
                )

            try:
                for skill_state in slash_activated_skills:
                    await event_queue.put(
                        {
                            "type": "skill_activated",
                            "session_id": session_id,
                            "skill": skill_state,
                        }
                    )

                timing.mark_once("agent_run_start")
                async for event in agent_loop(enriched_prompt, runtime.context, config, gateway):
                    if event.type == AgentEventType.AGENT_END:
                        local_terminal_reason = event.stop_reason or (
                            "stopped" if runtime.stop_requested else "completed"
                        )
                        terminal_reason = local_terminal_reason
                        terminal_status = "error" if local_terminal_reason == "error" else local_terminal_reason
                        timing.mark_once(
                            "agent_done",
                            status=terminal_status,
                            reason=local_terminal_reason,
                        )
                        continue

                    if event.type == AgentEventType.MESSAGE_START:
                        emit_progress("selecting_tool")
                        if not timing.has_milestone("first_sse"):
                            timing.set_value("first_sse_type", "message_start")
                            timing.mark_once("first_sse")
                        if event.message is None and event.message_id:
                            await event_queue.put(
                                {
                                    "type": "message_start",
                                    "session_id": session_id,
                                    "message_id": event.message_id,
                                }
                            )
                        elif event.message and event.message.role == Role.ASSISTANT:
                            await event_queue.put(
                                {
                                    "type": "message_start",
                                    "session_id": session_id,
                                    "message_id": event.message.message_id or event.message_id,
                                }
                            )
                    elif event.type == AgentEventType.MESSAGE_UPDATE:
                        if event.text_delta:
                            assistant_text_started = True
                            emit_progress("generating_answer")
                            if not timing.has_milestone("first_sse"):
                                timing.set_value("first_sse_type", "text_delta")
                                timing.mark_once("first_sse")
                            timing.mark_once("first_text")
                            await event_queue.put(
                                {
                                    "type": "text_delta",
                                    "session_id": session_id,
                                    "message_id": event.message_id,
                                    "content": event.text_delta,
                                }
                            )
                    elif event.type == AgentEventType.REASONING_UPDATE:
                        if event.reasoning_delta:
                            if not timing.has_milestone("first_sse"):
                                timing.set_value("first_sse_type", "reasoning_delta")
                                timing.mark_once("first_sse")
                            await event_queue.put(
                                {
                                    "type": "reasoning_delta",
                                    "session_id": session_id,
                                    "message_id": event.message_id,
                                    "content": event.reasoning_delta,
                                }
                            )
                    elif event.type == AgentEventType.TOOL_CALL_START:
                        emit_progress("selecting_tool")
                        if not assistant_text_started:
                            emit_progress("executing_query")
                        if not timing.has_milestone("first_sse"):
                            timing.set_value("first_sse_type", "tool_call")
                            timing.mark_once("first_sse")
                        timing.mark_once("first_tool_call")
                        await event_queue.put(
                            {
                                "type": "tool_call",
                                "session_id": session_id,
                                "message_id": event.message_id,
                                "tool_call_id": event.tool_call_id,
                                "widget_id": event.widget_id or event.tool_call_id,
                                "name": event.tool_name,
                                "arguments": event.tool_args or {},
                            }
                        )
                    elif event.type == AgentEventType.TOOL_CALL_DELTA:
                        if not timing.has_milestone("first_sse"):
                            timing.set_value("first_sse_type", "tool_call_delta")
                            timing.mark_once("first_sse")
                        await _enqueue_widget_preview(
                            event_queue,
                            runtime,
                            event.message_id,
                            event.tool_call_id,
                            event.tool_name,
                            event.partial_arguments,
                        )
                    elif event.type == AgentEventType.TOOL_EXECUTION_START:
                        emit_progress("executing_query")
                        await event_queue.put(
                            {
                                "type": "status",
                                "session_id": session_id,
                                "run_id": claimed_run_id,
                                "phase": "running_tool",
                                "message": f"正在执行工具 {event.tool_name}",
                            }
                        )
                        if event.tool_call_id not in tool_heartbeat_tasks:
                            tool_heartbeat_tasks[event.tool_call_id] = asyncio.create_task(
                                emit_tool_heartbeat(
                                    message_id=event.message_id,
                                    tool_call_id=event.tool_call_id,
                                    tool_name=event.tool_name,
                                )
                            )
                    elif event.type == AgentEventType.TOOL_EXECUTION_END:
                        await stop_tool_heartbeat(event.tool_call_id)
                        details = _build_tool_result_details(event.tool_result)
                        message_id = _message_id_for_event(event)
                        widget_id = _tool_widget_id(event.tool_name, details, event.tool_call_id)
                        store_key = _widget_store_key(message_id, event.tool_call_id, widget_id)
                        runtime.widget_partial_buffers.pop(event.tool_call_id, None)

                        if event.tool_name == "show_widget":
                            if event.tool_result and not event.tool_result.is_error:
                                widget_state = {
                                    **runtime.widgets.get(store_key, {}),
                                    **details,
                                    "widget_id": widget_id,
                                    "tool_call_id": event.tool_call_id,
                                    "message_id": message_id,
                                    "status": "ready",
                                    "session_id": session_id,
                                }
                                runtime.widgets[store_key] = widget_state
                                await event_queue.put(
                                    {
                                        "type": "widget",
                                        "session_id": session_id,
                                        "message_id": message_id,
                                        "tool_call_id": event.tool_call_id,
                                        "widget_id": widget_id,
                                        "tool_name": event.tool_name,
                                        "widget": widget_state,
                                    }
                                )
                                await event_queue.put(
                                    {
                                        "type": "widget_done",
                                        "session_id": session_id,
                                        "message_id": message_id,
                                        "tool_call_id": event.tool_call_id,
                                        "widget_id": widget_id,
                                    }
                                )
                            else:
                                error_text = _build_widget_error_text(event.tool_result)
                                runtime.widgets[store_key] = {
                                    **runtime.widgets.get(store_key, {}),
                                    "widget_id": widget_id,
                                    "tool_call_id": event.tool_call_id,
                                    "message_id": message_id,
                                    "status": "error",
                                    "error": error_text,
                                    "session_id": session_id,
                                }
                                await event_queue.put(
                                    {
                                        "type": "widget_error",
                                        "session_id": session_id,
                                        "message_id": message_id,
                                        "tool_call_id": event.tool_call_id,
                                        "widget_id": widget_id,
                                        "error": error_text,
                                    }
                                )

                        if (
                            event.tool_name == "activate_skill"
                            and event.tool_result
                            and event.tool_result.content
                        ):
                            content_text = _build_tool_result_text(event.tool_result)
                            try:
                                details_json = json.loads(content_text)
                                if details_json.get("_is_skill_activation"):
                                    skill_dict = _record_active_skill(runtime.context, details_json)
                                    await event_queue.put(
                                        {
                                            "type": "skill_activated",
                                            "session_id": session_id,
                                            "skill": skill_dict,
                                        }
                                    )
                            except json.JSONDecodeError:
                                logger.warning("[Skill] 鏃犳硶瑙ｆ瀽 activate_skill 宸ュ叿缁撴灉")

                        _sync_runtime_views(runtime)
                        await event_queue.put(
                            {
                                "type": "tool_progress",
                                "session_id": session_id,
                                "message_id": message_id,
                                "tool_call_id": event.tool_call_id,
                                "name": event.tool_name,
                                "phase": "done" if not (event.tool_result and event.tool_result.is_error) else "error",
                                "elapsed_ms": details.get("elapsed_ms"),
                            }
                        )
                        await event_queue.put(
                            {
                                "type": "tool_result",
                                "session_id": session_id,
                                "message_id": message_id,
                                "tool_call_id": event.tool_call_id,
                                "widget_id": widget_id,
                                "name": event.tool_name,
                                "arguments": event.tool_args or {},
                                "content": _build_tool_result_text(event.tool_result),
                                "details": details,
                                "is_error": bool(event.tool_result.is_error) if event.tool_result else False,
                            }
                        )
                    elif event.type == AgentEventType.ERROR:
                        local_terminal_reason = "error"
                        terminal_reason = "error"
                        terminal_status = "error"
                        timing.mark_once("request_error", error=event.error)
                        await event_queue.put(
                            {
                                "type": "error",
                                "session_id": session_id,
                                "error": event.error,
                            }
                        )

                if local_terminal_reason == "stopped":
                    _sanitize_runtime_messages(
                        runtime,
                        reason=local_terminal_reason,
                        phase="缁撴潫鎸佷箙鍖栧墠",
                    )
                _persist_session_snapshot(runtime)
                for task in list(tool_heartbeat_tasks.values()):
                    task.cancel()
                if tool_heartbeat_tasks:
                    await asyncio.gather(*tool_heartbeat_tasks.values(), return_exceptions=True)
                    tool_heartbeat_tasks.clear()
                await emit_done(local_terminal_reason)
            except asyncio.CancelledError:
                local_terminal_reason = "stopped" if runtime.stop_requested else "error"
                terminal_reason = local_terminal_reason
                terminal_status = "error" if local_terminal_reason == "error" else local_terminal_reason
                if local_terminal_reason == "error":
                    timing.mark_once("request_error", error="Agent run was cancelled")
                    await event_queue.put(
                        {
                            "type": "error",
                            "session_id": session_id,
                            "error": "Agent run was cancelled",
                        }
                    )
                else:
                    _sanitize_runtime_messages(
                        runtime,
                        reason=local_terminal_reason,
                        phase="鍋滄鎸佷箙鍖栧墠",
                    )
                _persist_session_snapshot(runtime)
                for task in list(tool_heartbeat_tasks.values()):
                    task.cancel()
                if tool_heartbeat_tasks:
                    await asyncio.gather(*tool_heartbeat_tasks.values(), return_exceptions=True)
                    tool_heartbeat_tasks.clear()
                timing.mark_once("agent_done", status=terminal_status, reason=local_terminal_reason)
                await emit_done(local_terminal_reason)
            except Exception as exc:
                logger.error("Agent Loop Task Error: %s", exc)
                terminal_reason = "error"
                terminal_status = "error"
                timing.mark_once("request_error", error=str(exc))
                _sanitize_runtime_messages(
                    runtime,
                    reason="error",
                    phase="错误持久化前",
                )
                _persist_session_snapshot(runtime)
                for task in list(tool_heartbeat_tasks.values()):
                    task.cancel()
                if tool_heartbeat_tasks:
                    await asyncio.gather(*tool_heartbeat_tasks.values(), return_exceptions=True)
                    tool_heartbeat_tasks.clear()
                await event_queue.put(
                    {"type": "error", "session_id": session_id, "error": str(exc)}
                )
                timing.mark_once("agent_done", status="error", reason="error")
                await emit_done("error")

        retry_token = set_retry_event_handler(emit_retry_event)
        try:
            agent_task = asyncio.create_task(run_agent())
        finally:
            reset_retry_event_handler(retry_token)
        runtime.active_run_task = agent_task
        _sync_runtime_views(runtime)
        watcher_task = asyncio.create_task(_watch_workspace(runtime.workspace.session_dir, event_queue))

        while True:
            event_data = await event_queue.get()
            event_type = event_data.get("type")
            if event_type and not timing.has_milestone("first_sse"):
                timing.set_value("first_sse_type", event_type)
                timing.mark_once("first_sse")
            yield json.dumps(event_data, ensure_ascii=False)
            if event_data.get("type") in {"done", "error"} and event_data.get("reason") == "error":
                break
            if event_data.get("type") == "done":
                break
    finally:
        if agent_task is not None and not agent_task.done():
            agent_task.cancel()
        if watcher_task is not None and not watcher_task.done():
            watcher_task.cancel()
        if agent_task is not None or watcher_task is not None:
            await asyncio.gather(
                *(task for task in [agent_task, watcher_task] if task is not None),
                return_exceptions=True,
            )

        if runtime.cached_runtime_services is not session_runtime_services:
            pass  # MCP 鐢熷懡鍛ㄦ湡鐢?MCPManager 绠＄悊锛屾棤闇€ session 绾ф竻鐞?

        timing.mark_once("request_done", status=terminal_status, reason=terminal_reason)
        timing.log_summary(status=terminal_status, reason=terminal_reason)
        runtime.context.timing = None
        finish_active_run()


@router.get("/skills", response_model=SkillListResponse)
async def list_skills():
    manager = _build_skill_manager()
    skills = [SkillInfo(**skill.__dict__) for skill in manager.list_skills()]
    return SkillListResponse(status="success", skills=skills, total=len(skills))


@router.post("/sessions/{session_id}/prepare")
async def prepare_agent_session(session_id: str, request: Request = None):
    user_id = _request_user_id(request)
    runtime = _ensure_session_runtime(session_id, user_id)
    if runtime.is_busy():
        return {
            "status": "busy",
            "prepared": False,
            "session_id": session_id,
            "message": "Session is running",
        }

    prepare_id = f"prepare_{uuid4().hex[:16]}"
    timing = AgentTimingRecorder(req=prepare_id, session=session_id)
    timing.mark_once("request_start")
    timing.mark_once("workspace_ready", workspace=str(runtime.workspace.session_dir))
    try:
        result = await _prepare_session_runtime(runtime, timing=timing)
        timing.mark_once("request_done", status="completed", reason="prepare")
        timing.log_summary(status="completed", reason="prepare")
        return {
            "status": "ready",
            "prepared": True,
            "session_id": session_id,
            "cache": result["cache"],
            "tool_count": result["tool_count"],
            "model_tool_count": result["model_tool_count"],
            "deferred_tool_count": result["deferred_tool_count"],
            "tool_search_enabled": result["tool_search_enabled"],
        }
    except Exception as exc:
        timing.mark_once("request_error", error=str(exc))
        timing.mark_once("request_done", status="error", reason="prepare")
        timing.log_summary(status="error", reason="prepare")
        logger.exception("[Prepare] failed: session=%s", session_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/chat")
async def agent_chat(req: ChatRequest, request: Request = None):
    user_id = _request_user_id(request)
    runtime = _ensure_session_runtime(req.session_id, user_id)
    if runtime.is_busy():
        raise HTTPException(status_code=409, detail="当前 session 正在执行，请稍后或使用 steer/stop")

    startup_status = semantic_startup.status()
    if startup_status.get("status") in {"checking", "ingesting", "failed"}:
        raise HTTPException(
            status_code=503,
            detail={
                "code": startup_status.get("errorCode") or "semantic_catalog_not_ready",
                "status": startup_status.get("status"),
            },
        )

    run_id = _generate_run_id()
    runtime.active_run_id = run_id
    runtime.stop_requested = False
    runtime.last_active = time.time()
    _sync_runtime_views(runtime)

    logger.info(
        "[Timing][Chat] req=%s session=%s stage=request_start elapsed_ms=0.0 attachments=%s",
        run_id,
        req.session_id,
        len(req.attached_files),
    )
    logger.info(
        "[Timing][Chat] req=%s session=%s stage=agent_chat_received elapsed_ms=0.0 enabled_mcp_servers=%s",
        run_id,
        req.session_id,
        len(req.enabled_mcp_servers or []),
    )
    logger.info(
        "鏀跺埌鑱婂ぉ璇锋眰 [Session: %s] [闄勪欢: %s涓猐 [Run: %s]",
        req.session_id,
        len(req.attached_files),
        run_id,
    )

    async def sse_stream() -> AsyncGenerator[str, None]:
        async for payload in event_generator(
            req.prompt,
            req.session_id,
            req.attached_files,
            req.mcp_config,
            req.enabled_mcp_servers,
            run_id,
            user_id,
        ):
            yield _format_sse_payload(json.loads(payload))

    return StreamingResponse(
        sse_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )



@router.post("/stop")
async def stop_agent(req: StopRequest, request: Request = None):
    user_id = _request_user_id(request)
    runtime = _session_runtimes.get(_runtime_key(user_id, req.session_id))
    if runtime is None or not runtime.is_busy():
        return {"status": "success", "message": "褰撳墠 session 娌℃湁杩愯涓殑浠诲姟", "stopped": False}

    runtime.stop_requested = True
    runtime.last_active = time.time()
    if runtime.active_run_task is not None and hasattr(runtime.active_run_task, "cancel"):
        runtime.active_run_task.cancel()
    _sync_runtime_views(runtime)
    logger.info("[Stop] 宸茬櫥璁板仠姝㈣姹?[%s]", req.session_id)
    return {
        "status": "success",
        "message": "鍋滄淇″彿宸茬櫥璁帮紝灏嗗湪涓嬩竴涓畨鍏ㄦ鏌ョ偣鍋滄",
        "stopped": True,
    }


@router.post("/clarification")
async def answer_clarification(req: ClarificationAnswerRequest, request: Request = None):
    user_id = _request_user_id(request)
    runtime = _session_runtimes.get(_runtime_key(user_id, req.session_id))
    if runtime is None or runtime.pending_clarification is None:
        raise HTTPException(status_code=404, detail="褰撳墠娌℃湁寰呭鐞嗙殑婢勬竻闂")

    pending = runtime.pending_clarification
    if pending.clarification_id != req.clarification_id:
        raise HTTPException(status_code=409, detail="Clarification request is expired or mismatched")

    answer = req.answer.strip()
    if not answer:
        raise HTTPException(status_code=400, detail="鍥炵瓟涓嶈兘涓虹┖")

    runtime.last_active = time.time()
    if pending.future is not None and not pending.future.done():
        pending.future.set_result(answer)

    if runtime.event_queue is not None:
        await runtime.event_queue.put(
            {
                "type": "clarification_answered",
                "session_id": req.session_id,
                "clarification_id": req.clarification_id,
                "answer": answer,
            }
        )

    _sync_runtime_views(runtime)
    logger.info("[Clarification] 宸叉敹鍒扮敤鎴峰洖绛?[%s]", req.session_id)
    return {"status": "success"}


@router.post("/steer")
async def steer_agent(req: SteerRequest, request: Request = None):
    user_id = _request_user_id(request)
    runtime = _ensure_session_runtime(req.session_id, user_id)
    runtime.input_queue.put(req.prompt)
    runtime.last_active = time.time()
    _sync_runtime_views(runtime)
    logger.info("Steer 宸叉帹鍏ユ秷鎭?[%s]: %s", req.session_id, req.prompt[:50])
    return {"status": "success"}


@router.post("/clear")
async def clear_session(session_id: str = "default", request: Request = None):
    user_id = _request_user_id(request)
    runtime = _session_runtimes.get(_runtime_key(user_id, session_id))
    if runtime and runtime.is_busy():
        raise HTTPException(status_code=409, detail="Current session is running and cannot be cleared")

    if runtime is not None:
        runtime.context.messages.clear()
        runtime.context.active_skills = SkillRuntimeState()
        runtime.widgets.clear()
        runtime.widget_partial_buffers.clear()
        runtime.pending_clarification = None
        _clear_session_snapshot(runtime)
    _cleanup_session_state(session_id, user_id)
    record = chat_store.clear_session_content(user_id, session_id)

    return {
        "status": "success",
        "message": f"Session {session_id} cleared",
        "session_id": session_id,
        "conversation_version": record.conversation_version,
        "messages": [],
        "attached_files": [],
    }

@router.post("/workspace/cleanup")
async def cleanup_workspaces():
    workspace_root = Path(os.getcwd()) / "workspace"
    if not workspace_root.exists():
        return {"status": "success", "deleted": 0, "message": "宸ヤ綔鍖虹洰褰曚笉瀛樺湪"}

    deleted_count = 0
    now = time.time()
    max_age_seconds = 7 * 24 * 3600

    try:
        for session_dir in workspace_root.iterdir():
            if not session_dir.is_dir():
                continue

            try:
                file_count = 0
                for item in session_dir.rglob("*"):
                    if item.is_file() and item.name != SNAPSHOT_FILE_NAME:
                        file_count += 1

                if file_count == 0:
                    dir_age = now - session_dir.stat().st_mtime
                    if dir_age > max_age_seconds:
                        import shutil

                        shutil.rmtree(session_dir)
                        deleted_count += 1
                        logger.info("[Workspace] 娓呯悊绌哄伐浣滃尯: %s", session_dir.name)
            except Exception as exc:
                logger.warning("[Workspace] 妫€鏌ョ洰褰曞け璐?%s: %s", session_dir, exc)

        return {
            "status": "success",
            "deleted": deleted_count,
            "message": f"Cleaned {deleted_count} empty workspace directories",
        }
    except Exception as exc:
        return {"status": "error", "message": str(exc)}
