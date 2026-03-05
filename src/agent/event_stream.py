"""
EventStream —— 异步事件推送器
基于 asyncio.Queue，支持 push / async iteration / result

借鉴 pi-mono 的 EventStream 设计
"""

from __future__ import annotations

import asyncio
from typing import Any, Generic, TypeVar

T = TypeVar("T")  # Event type
R = TypeVar("R")  # Result type


class EventStream(Generic[T, R]):
    """
    异步事件流

    Producer 端调用 push(event) 推送事件，end(result) 结束流。
    Consumer 端通过 async for event in stream 消费事件。

    用法：
        stream = EventStream()
        # producer
        stream.push(event1)
        stream.push(event2)
        stream.end(result)
        # consumer
        async for event in stream:
            handle(event)
        final = await stream.result()
    """

    def __init__(self):
        self._queue: asyncio.Queue[T | None] = asyncio.Queue()
        self._result_future: asyncio.Future[R] = asyncio.get_event_loop().get_future()
        self._ended = False
        self._result_value: R | None = None

    def __init__(self):
        self._queue: asyncio.Queue[T | None] = asyncio.Queue()
        self._ended = False
        self._result_value: R | None = None
        self._result_event = asyncio.Event()

    def push(self, event: T) -> None:
        """推送一个事件"""
        if self._ended:
            return
        self._queue.put_nowait(event)

    def end(self, result: R) -> None:
        """结束事件流，设置最终结果"""
        if self._ended:
            return
        self._ended = True
        self._result_value = result
        self._result_event.set()
        self._queue.put_nowait(None)  # sentinel

    async def __aiter__(self):
        """异步迭代事件"""
        while True:
            event = await self._queue.get()
            if event is None:
                break
            yield event

    async def result(self) -> R:
        """等待并获取最终结果"""
        await self._result_event.wait()
        return self._result_value  # type: ignore
