import asyncio

import pytest

from src.resilience.retry import (
    RetryPolicy,
    async_retry,
    extract_retry_delay_seconds,
    is_retryable_exception,
    reset_retry_event_handler,
    set_retry_event_handler,
)


class StatusError(Exception):
    def __init__(self, status_code: int, message: str = "") -> None:
        super().__init__(message or f"status {status_code}")
        self.status_code = status_code


def test_retryable_status_codes():
    assert is_retryable_exception(StatusError(429))
    assert is_retryable_exception(StatusError(503))
    assert not is_retryable_exception(StatusError(404))


def test_retryable_connection_text():
    assert is_retryable_exception(Exception("Connection error."))
    assert is_retryable_exception(Exception("[database] MCP 未就绪"))
    assert not is_retryable_exception(Exception("SQL syntax error near FROM"))


def test_extract_retry_delay_from_text():
    assert extract_retry_delay_seconds("Please retry in 250ms") == pytest.approx(1.25)
    assert extract_retry_delay_seconds('"retryDelay": "2s"') == pytest.approx(3.0)


@pytest.mark.asyncio
async def test_async_retry_retries_then_succeeds(monkeypatch):
    attempts = 0
    sleeps: list[float] = []

    async def fake_sleep(delay: float) -> None:
        sleeps.append(delay)

    monkeypatch.setattr(asyncio, "sleep", fake_sleep)

    async def operation() -> str:
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise ConnectionError("temporary")
        return "ok"

    result = await async_retry(
        operation,
        policy=RetryPolicy(max_attempts=3, base_delay=0.1, jitter=0),
        operation_name="test.operation",
        logger=__import__("logging").getLogger("test"),
    )

    assert result == "ok"
    assert attempts == 3
    assert sleeps == [0.1, 0.2]


@pytest.mark.asyncio
async def test_async_retry_emits_retry_event(monkeypatch):
    events: list[dict] = []
    attempts = 0

    async def fake_sleep(delay: float) -> None:
        pass

    monkeypatch.setattr(asyncio, "sleep", fake_sleep)

    async def operation() -> str:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise ConnectionError("temporary")
        return "ok"

    token = set_retry_event_handler(lambda payload: events.append(payload))
    try:
        result = await async_retry(
            operation,
            policy=RetryPolicy(max_attempts=2, base_delay=0.1, jitter=0),
            operation_name="test.operation",
            logger=__import__("logging").getLogger("test"),
        )
    finally:
        reset_retry_event_handler(token)

    assert result == "ok"
    assert events == [{
        "operation": "test.operation",
        "attempt": 2,
        "max_attempts": 2,
        "delay_seconds": 0.1,
        "reason": "temporary",
    }]


@pytest.mark.asyncio
async def test_async_retry_does_not_retry_non_retryable(monkeypatch):
    attempts = 0

    async def fake_sleep(delay: float) -> None:
        raise AssertionError("should not sleep")

    monkeypatch.setattr(asyncio, "sleep", fake_sleep)

    async def operation() -> str:
        nonlocal attempts
        attempts += 1
        raise StatusError(404)

    with pytest.raises(StatusError):
        await async_retry(
            operation,
            policy=RetryPolicy(max_attempts=3, base_delay=0.1, jitter=0),
            operation_name="test.operation",
            logger=__import__("logging").getLogger("test"),
        )

    assert attempts == 1
