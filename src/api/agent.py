import json
import logging
import os
from pathlib import Path
from typing import Any, AsyncGenerator
import asyncio
import time
from watchfiles import awatch

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from src.ai.base_provider import Message, Role
from src.agent.agent_loop import agent_loop
from src.agent.types import AgentContext, AgentLoopConfig, AgentEventType
from src.config_manager import config_manager
from src.prompts import load_system_prompt
from src.skills import (
    ActiveSkillState,
    SkillRuntimeState,
    activate_skill_by_name,
    create_project_skill_manager,
    parse_skill_command,
)
from src.workspace.workspace_manager import WorkspaceManager

logger = logging.getLogger("data_agent.api.agent")

router = APIRouter(prefix="/agent", tags=["agent"])


class ChatRequest(BaseModel):
    prompt: str
    session_id: str = "default"
    attached_files: list[str] = []  # 用户附带的工作区文件路径列表
    mcp_config: dict[str, Any] | None = None
    enabled_mcp_servers: list[str] | None = None


class SteerRequest(BaseModel):
    prompt: str
    session_id: str = "default"


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


def _build_skill_manager():
    return create_project_skill_manager(config_manager.project_root)


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
    return f"已激活 skill: {parsed.skill_name}。请按照该 skill 执行当前任务。"


# 简单的内存会话存储（生产环境应使用 Redis 或数据库）
_session_context: dict[str, AgentContext] = {}
_session_workspaces: dict[str, WorkspaceManager] = {}


# 会话活跃时间追踪（用于 LRU 清理）
_session_last_active: dict[str, float] = {}

MAX_SESSIONS = 50


def _lru_cleanup_sessions():
    """当会话数超过 MAX_SESSIONS 时，清理最旧的非活跃会话（仅释放内存引用）"""
    total = max(len(_session_context), len(_session_workspaces), len(_session_queues))
    if total <= MAX_SESSIONS:
        return

    # 按最后活跃时间排序，清理最旧的
    sorted_sessions = sorted(_session_last_active.items(), key=lambda x: x[1])
    to_remove = max(1, len(sorted_sessions) - MAX_SESSIONS)
    for sid, _ in sorted_sessions[:to_remove]:
        _session_context.pop(sid, None)
        _session_workspaces.pop(sid, None)
        _session_queues.pop(sid, None)
        _session_last_active.pop(sid, None)
        logger.info(f"[LRU] 清理非活跃会话: {sid}")


class SteeringQueue:
    """用户消息队列，支持 Agent 运行中的打断与追加"""

    def __init__(self):
        self._queue: asyncio.Queue[str] = asyncio.Queue()

    def put(self, message: str) -> None:
        self._queue.put_nowait(message)

    async def get_steering_messages(self) -> list[Message]:
        messages = []
        while not self._queue.empty():
            try:
                text = self._queue.get_nowait()
                messages.append(Message(role=Role.USER, content=text))
            except asyncio.QueueEmpty:
                break
        return messages


_session_queues: dict[str, SteeringQueue] = {}


WATCHER_EXCLUDED_EXTS = {".py", ".pyc", ".log", ".tmp"}


async def _watch_workspace(workspace_dir: Path, queue: asyncio.Queue):
    """
    监控工作区目录变化，并向队列推送更新事件
    """
    logger.info(f"[Watcher] 开始监控工作区: {workspace_dir}")
    try:
        async for changes in awatch(workspace_dir):
            # 过滤：仅当变化文件不属于排除后缀时才推送
            relevant = any(
                Path(path).suffix.lower() not in WATCHER_EXCLUDED_EXTS
                for _change_type, path in changes
            )
            if not relevant:
                continue

            # 增加一个微小的延迟（500ms），给系统一个刷新文件索引和完成写入的时间
            await asyncio.sleep(0.5)

            # 推送刷新消息
            await queue.put({"type": "workspace_updated", "tool": "watcher"})
    except asyncio.CancelledError:
        logger.info("[Watcher] 监控任务已取消")
    except Exception as e:
        logger.error(f"[Watcher] 监控出错: {e}")


async def event_generator(
    prompt: str,
    session_id: str = "default",
    attached_files: list[str] | None = None,
    mcp_config: dict[str, Any] | None = None,
    enabled_mcp_servers: list[str] | None = None,
) -> AsyncGenerator[str, None]:
    """
    将 AgentLoop 事件转换为 SSE 数据流格式。
    由于 SSE 需要文本，我们将事件序列化为 JSON。
    """
    gateway = config_manager.gateway
    ai_config = config_manager.ai_config

    if not gateway:
        yield '{"type": "error", "error": "Gateway 未初始化"}\n\n'
        return

    # 获取或创建会话专用的 WorkspaceManager
    if session_id not in _session_workspaces:
        _session_workspaces[session_id] = WorkspaceManager(session_id=session_id)
        logger.info(f"[Workspace] 为会话 {session_id} 创建新工作区")

    workspace = _session_workspaces[session_id]

    # 追踪会话活跃时间并触发 LRU 清理
    _session_last_active[session_id] = time.time()
    _lru_cleanup_sessions()

    runtime_overrides = {"mcp_config": mcp_config} if mcp_config else {}

    existing_context = _session_context.get(session_id)
    existing_messages = existing_context.messages if existing_context else []
    existing_active_skills = existing_context.active_skills if existing_context else None
    tools, session_runtime_services = await config_manager.build_session_tools(
        session_id=session_id,
        workspace=workspace,
        runtime_overrides=runtime_overrides,
        enabled_mcp_servers=enabled_mcp_servers,
    )
    _session_context[session_id] = AgentContext(
        system_prompt=load_system_prompt(config_manager.project_root),
        tools=tools,
        messages=existing_messages,
        active_skills=existing_active_skills if existing_active_skills is not None else SkillRuntimeState(),
    )
    logger.info(f"[Context] 为会话 {session_id} 装配了 {len(tools)} 个工具")

    if session_id not in _session_queues:
        _session_queues[session_id] = SteeringQueue()

    context = _session_context[session_id]
    active_skill_count_before = len(context.active_skills.list_active_skills())
    enriched_prompt = _apply_slash_skill_activation(prompt, context)
    slash_activated_skills = [
        s.to_dict() for s in context.active_skills.list_active_skills()[active_skill_count_before:]
    ]
    queue = _session_queues[session_id]

    # ── 读取用户附带的工作区文件并拼接到 prompt 前 ──
    if attached_files:
        workspace_root = Path(os.getcwd()) / "workspace"
        file_contexts: list[str] = []
        for rel_path in attached_files:
            try:
                cleaned = os.path.normpath(rel_path)
                full_path = (workspace_root / cleaned).resolve()
                # 安全检查
                full_path.relative_to(workspace_root.resolve())
                if full_path.exists() and full_path.is_file():
                    content = full_path.read_text(encoding="utf-8", errors="replace")

                    if len(content) > 5000:
                        preview = content[:2000]
                        file_contexts.append(
                            f"--- 附件: {rel_path} (文件较大，仅提供前2000字符预览) ---\n"
                            f"{preview}\n\n"
                            f"[重要提示：该文件完整大小为 {len(content)} 字符。为避免上下文超限，目前仅展示了开头部分。请务必使用 `read_file`, `grep_search` 等工作区工具来读取或搜索关键信息，不要凭借截断的文本进行猜测。]\n"
                            f"--- 附件结束 ---"
                        )
                        logger.info(
                            f"[Context] 已读取附件大文件预览: {rel_path} ({len(content)} chars)"
                        )
                    else:
                        file_contexts.append(
                            f"--- 附件: {rel_path} ---\n{content}\n--- 附件结束 ---"
                        )
                        logger.info(
                            f"[Context] 已读取附件全部内容: {rel_path} ({len(content)} chars)"
                        )
            except Exception as e:
                logger.warning(f"[Context] 读取附件失败 {rel_path}: {e}")
        if file_contexts:
            enriched_prompt = (
                "以下是用户附带的参考文件内容，请结合这些文件回答问题：\n\n"
                + "\n\n".join(file_contexts)
                + f"\n\n用户问题：{enriched_prompt}"
            )

    config = AgentLoopConfig(
        model=ai_config.default_model,
        temperature=ai_config.temperature,
        max_tokens=ai_config.max_tokens,
        get_steering_messages=queue.get_steering_messages,
    )

    queue = asyncio.Queue()

    # ── 启动并发任务 ──
    # 1. Agent 主循环任务
    async def run_agent():
        try:
            for skill_state in slash_activated_skills:
                await queue.put(
                    {
                        "type": "skill_activated",
                        "skill": skill_state,
                    }
                )
            async for event in agent_loop(enriched_prompt, context, config, gateway):
                if event.type == AgentEventType.MESSAGE_UPDATE:
                    if event.text_delta:
                        await queue.put(
                            {"type": "text_delta", "content": event.text_delta}
                        )
                elif event.type == AgentEventType.MESSAGE_START:
                    if event.message and event.message.tool_calls:
                        for tc in event.message.tool_calls:
                            await queue.put(
                                {
                                    "type": "tool_call",
                                    "name": tc.name,
                                    "arguments": tc.arguments,
                                }
                            )
                elif event.type == AgentEventType.MESSAGE_END:
                    if event.message and event.message.role == "tool_result":
                        if (
                            event.message.tool_name == "activate_skill"
                            and event.message.content
                        ):
                            try:
                                details = json.loads(event.message.content)
                                if details.get("_is_skill_activation"):
                                    skill_dict = _record_active_skill(context, details)
                                    await queue.put(
                                        {
                                            "type": "skill_activated",
                                            "skill": skill_dict,
                                        }
                                    )
                            except json.JSONDecodeError:
                                logger.warning("[Skill] 无法解析 activate_skill 工具结果")
                        await queue.put(
                            {
                                "type": "tool_result",
                                "name": event.message.tool_name,
                                "content": event.message.content,
                            }
                        )
                elif event.type == AgentEventType.ERROR:
                    await queue.put({"type": "error", "error": event.error})

            # 正常结束：先推送一次 workspace_updated 确保前端捕获最终文件状态
            await queue.put({"type": "workspace_updated", "tool": "agent_done"})
            await queue.put({"type": "done"})
        except Exception as e:
            logger.error(f"Agent Loop Task Error: {e}")
            await queue.put({"type": "error", "error": str(e)})

    agent_task = asyncio.create_task(run_agent())

    # 2. 工作区监控任务
    watcher_task = asyncio.create_task(_watch_workspace(workspace.session_dir, queue))

    try:
        # ── 产出 SSE 事件流 ──
        while True:
            event_data = await queue.get()
            yield json.dumps(event_data, ensure_ascii=False)

            if event_data.get("type") == "done" or event_data.get("type") == "error":
                break

    finally:
        # 清理任务
        if not agent_task.done():
            agent_task.cancel()
        if not watcher_task.done():
            watcher_task.cancel()
        await asyncio.gather(agent_task, watcher_task, return_exceptions=True)

        registry = session_runtime_services.metadata.get("mcp_registry")
        if registry is not None:
            await registry.shutdown()


@router.get("/skills", response_model=SkillListResponse)
async def list_skills():
    manager = _build_skill_manager()
    skills = [SkillInfo(**skill.__dict__) for skill in manager.list_skills()]
    return SkillListResponse(status="success", skills=skills, total=len(skills))


@router.post("/chat")
async def agent_chat(req: ChatRequest):
    """
    发送消息并获取流式的 Agent 结果。
    """
    logger.info(
        f"收到聊天请求: {req.prompt[:50]}... [Session: {req.session_id}] [附件: {len(req.attached_files)}个]"
    )
    return EventSourceResponse(
        event_generator(
            req.prompt,
            req.session_id,
            req.attached_files,
            req.mcp_config,
            req.enabled_mcp_servers,
        )
    )


@router.post("/stop")
async def stop_agent():
    """
    中断当前的 Agent，需要通过 steering 来打断。
    此处仅作为 API 的占位，TODO: 结合 steering_queue 实现真实的打断。
    """
    # TODO: 实现向 SteeringQueue 推送打断信号
    return {"status": "success", "message": "停止信号已发送"}


@router.post("/steer")
async def steer_agent(req: SteerRequest):
    """
    打断/追加机制。当大模型在思考时，插入一条补充消息。
    """
    if req.session_id not in _session_queues:
        _session_queues[req.session_id] = SteeringQueue()
    _session_queues[req.session_id].put(req.prompt)
    logger.info(f"Steer 已推入消息 [{req.session_id}]: {req.prompt[:50]}")
    return {"status": "success"}


@router.post("/clear")
async def clear_session(session_id: str = "default"):
    """清空当前会话的上下文历史记录"""
    if session_id in _session_context:
        del _session_context[session_id]
    if session_id in _session_queues:
        del _session_queues[session_id]
    # 释放内存引用（不删磁盘文件）
    if session_id in _session_workspaces:
        del _session_workspaces[session_id]
    _session_last_active.pop(session_id, None)
    return {"status": "success", "message": f"会话 {session_id} 已重置"}


@router.post("/workspace/cleanup")
async def cleanup_workspaces():
    """清理空的和过期的 workspace 目录"""
    from datetime import timedelta
    import time

    workspace_root = Path(os.getcwd()) / "workspace"
    if not workspace_root.exists():
        return {"status": "success", "deleted": 0, "message": "工作区目录不存在"}

    deleted_count = 0
    now = time.time()
    # 清理 7 天前的空目录
    max_age_seconds = 7 * 24 * 3600

    try:
        for session_dir in workspace_root.iterdir():
            if not session_dir.is_dir():
                continue

            # 检查是否为空目录（只包含空的子目录）
            try:
                file_count = 0
                for item in session_dir.rglob("*"):
                    if item.is_file():
                        file_count += 1

                if file_count == 0:
                    # 检查目录年龄
                    dir_age = now - session_dir.stat().st_mtime
                    if dir_age > max_age_seconds:
                        import shutil

                        shutil.rmtree(session_dir)
                        deleted_count += 1
                        logger.info(f"[Workspace] 清理空工作区: {session_dir.name}")
            except Exception as e:
                logger.warning(f"[Workspace] 检查目录失败 {session_dir}: {e}")

        return {
            "status": "success",
            "deleted": deleted_count,
            "message": f"已清理 {deleted_count} 个空工作区目录",
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}
