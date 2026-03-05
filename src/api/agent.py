import json
import logging
from typing import Any, AsyncGenerator
import asyncio

from fastapi import APIRouter
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from src.ai.base_provider import Message, Role
from src.agent.agent_loop import agent_loop
from src.agent.types import AgentContext, AgentLoopConfig, AgentEventType
from src.config_manager import config_manager
from src.prompts import SYSTEM_PROMPT

logger = logging.getLogger("data_agent.api.agent")

router = APIRouter(prefix="/agent", tags=["agent"])


class ChatRequest(BaseModel):
    prompt: str
    session_id: str = "default"


class SteerRequest(BaseModel):
    prompt: str
    session_id: str = "default"


# 简单的内存会话存储（生产环境应使用 Redis 或数据库）
_session_context: dict[str, AgentContext] = {}


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


async def event_generator(
    prompt: str, session_id: str = "default"
) -> AsyncGenerator[str, None]:
    """
    将 AgentLoop 事件转换为 SSE 数据流格式。
    由于 SSE 需要文本，我们将事件序列化为 JSON。
    """
    gateway = config_manager.gateway
    tools = config_manager.tools
    ai_config = config_manager.ai_config

    if not gateway:
        yield '{"type": "error", "error": "Gateway 未初始化"}\n\n'
        return

    # 获取或创建会话上下文
    if session_id not in _session_context:
        _session_context[session_id] = AgentContext(
            system_prompt=SYSTEM_PROMPT,
            tools=tools,
            messages=[],
        )
    else:
        # 如果工具热更新了，需要同步进现有的上下文
        _session_context[session_id].tools = tools

    if session_id not in _session_queues:
        _session_queues[session_id] = SteeringQueue()

    context = _session_context[session_id]
    queue = _session_queues[session_id]

    config = AgentLoopConfig(
        model=ai_config.default_model,
        temperature=ai_config.temperature,
        max_tokens=ai_config.max_tokens,
        get_steering_messages=queue.get_steering_messages,
    )

    try:
        async for event in agent_loop(prompt, context, config, gateway):
            if event.type == AgentEventType.MESSAGE_UPDATE:
                if event.text_delta:
                    yield json.dumps(
                        {"type": "text_delta", "content": event.text_delta},
                        ensure_ascii=False,
                    )

            elif event.type == AgentEventType.MESSAGE_START:
                if event.message and event.message.tool_calls:
                    for tc in event.message.tool_calls:
                        tool_data = {
                            "type": "tool_call",
                            "name": tc.name,
                            "arguments": tc.arguments,
                        }
                        yield json.dumps(tool_data, ensure_ascii=False)

            elif event.type == AgentEventType.MESSAGE_END:
                if event.message and event.message.role == "tool_result":
                    res_data = {
                        "type": "tool_result",
                        "name": event.message.tool_name,
                        "content": event.message.content,
                    }
                    yield json.dumps(res_data, ensure_ascii=False)

            elif event.type == AgentEventType.ERROR:
                yield json.dumps(
                    {"type": "error", "error": event.error}, ensure_ascii=False
                )

        # 结束标志
        yield json.dumps({"type": "done"}, ensure_ascii=False)

    except Exception as e:
        logger.error(f"处理 Agent 会话时发生异常: {e}")
        yield json.dumps({"type": "error", "error": str(e)}, ensure_ascii=False)


@router.post("/chat")
async def agent_chat(req: ChatRequest):
    """
    发送消息并获取流式的 Agent 结果。
    """
    logger.info(f"收到聊天请求: {req.prompt[:50]}... [Session: {req.session_id}]")
    return EventSourceResponse(event_generator(req.prompt, req.session_id))


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
    return {"status": "success", "message": f"会话 {session_id} 已重置"}
