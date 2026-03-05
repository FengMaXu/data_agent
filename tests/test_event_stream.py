"""
EventStream 单元测试
"""

import asyncio
import pytest
import pytest_asyncio

from src.agent.event_stream import EventStream


@pytest.mark.asyncio
async def test_basic_push_and_iterate():
    """测试基本的推送和迭代"""
    stream = EventStream()

    # Producer
    stream.push("event_1")
    stream.push("event_2")
    stream.push("event_3")
    stream.end("done")

    # Consumer
    events = []
    async for event in stream:
        events.append(event)

    assert events == ["event_1", "event_2", "event_3"]
    assert await stream.result() == "done"


@pytest.mark.asyncio
async def test_async_producer_consumer():
    """测试异步生产者消费者"""
    stream = EventStream()
    received = []

    async def producer():
        for i in range(5):
            await asyncio.sleep(0.01)
            stream.push(f"event_{i}")
        stream.end("all_done")

    async def consumer():
        async for event in stream:
            received.append(event)

    await asyncio.gather(producer(), consumer())

    assert len(received) == 5
    assert received[0] == "event_0"
    assert received[-1] == "event_4"
    assert await stream.result() == "all_done"


@pytest.mark.asyncio
async def test_end_prevents_further_push():
    """测试结束后不再接受新事件"""
    stream = EventStream()

    stream.push("before")
    stream.end("result")
    stream.push("after")  # 应该被忽略

    events = []
    async for event in stream:
        events.append(event)

    assert events == ["before"]


@pytest.mark.asyncio
async def test_result_waits():
    """测试 result() 等待流结束"""
    stream = EventStream()

    async def delayed_end():
        await asyncio.sleep(0.05)
        stream.end(42)

    asyncio.create_task(delayed_end())
    result = await stream.result()
    assert result == 42
