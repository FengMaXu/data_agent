from __future__ import annotations

import asyncio
import inspect
import logging
import random
import re
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Awaitable, Callable, TypeVar

T = TypeVar("T")

RetryEventHandler = Callable[[dict[str, Any]], Awaitable[None] | None]
_retry_event_handler: ContextVar[RetryEventHandler | None] = ContextVar(
    "retry_event_handler",
    default=None,
)

RETRYABLE_STATUS_CODES = {408, 409, 425, 429, 500, 502, 503, 504}
NON_RETRYABLE_STATUS_CODES = {400, 401, 403, 404, 422}
RETRYABLE_TEXT_PATTERN = re.compile(
    r"connection.?error|connection.?refused|connection.?reset|"
    r"timed?.?out|timeout|rate.?limit|overloaded|service.?unavailable|"
    r"upstream.?connect|temporar(?:y|ily)|other.?side.?closed|"
    r"MCP\s*未就绪|MCP\s*重连超时",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class RetryPolicy:
    max_attempts: int = 3
    base_delay: float = 0.5
    multiplier: float = 2.0
    max_delay: float = 8.0
    jitter: float = 0.2
    max_server_delay: float = 60.0


def get_status_code(exc: BaseException) -> int | None:
    for attr in ("status_code", "status"):
        value = getattr(exc, attr, None)
        if isinstance(value, int):
            return value

    response = getattr(exc, "response", None)
    value = getattr(response, "status_code", None)
    if isinstance(value, int):
        return value
    value = getattr(response, "status", None)
    if isinstance(value, int):
        return value
    return None


def is_retryable_exception(exc: BaseException) -> bool:
    if isinstance(exc, (asyncio.CancelledError, KeyboardInterrupt)):
        return False

    status = get_status_code(exc)
    if status in NON_RETRYABLE_STATUS_CODES:
        return False
    if status in RETRYABLE_STATUS_CODES:
        return True

    if isinstance(exc, (TimeoutError, asyncio.TimeoutError, ConnectionError)):
        return True

    name = type(exc).__name__.lower()
    if any(part in name for part in ("timeout", "connection", "rate", "server")):
        return True

    return bool(RETRYABLE_TEXT_PATTERN.search(str(exc)))


def extract_retry_delay_seconds(
    error_text: str,
    headers: Any | None = None,
) -> float | None:
    header_delay = _extract_header_delay(headers)
    if header_delay is not None:
        return header_delay

    duration_match = re.search(
        r"reset after (?:(\d+)h)?(?:(\d+)m)?(\d+(?:\.\d+)?)s",
        error_text,
        re.IGNORECASE,
    )
    if duration_match:
        hours = int(duration_match.group(1) or 0)
        minutes = int(duration_match.group(2) or 0)
        seconds = float(duration_match.group(3))
        return max(0.0, hours * 3600 + minutes * 60 + seconds + 1.0)

    retry_in_match = re.search(
        r"Please retry in ([0-9.]+)\s*(ms|s)",
        error_text,
        re.IGNORECASE,
    )
    if retry_in_match:
        value = float(retry_in_match.group(1))
        return _normalize_unit_delay(value, retry_in_match.group(2))

    retry_delay_match = re.search(
        r'"retryDelay"\s*:\s*"([0-9.]+)\s*(ms|s)"',
        error_text,
        re.IGNORECASE,
    )
    if retry_delay_match:
        value = float(retry_delay_match.group(1))
        return _normalize_unit_delay(value, retry_delay_match.group(2))

    return None


def retry_delay_for_exception(
    exc: BaseException,
    policy: RetryPolicy,
    attempt_index: int,
) -> float:
    headers = getattr(getattr(exc, "response", None), "headers", None)
    server_delay = extract_retry_delay_seconds(str(exc), headers=headers)
    if server_delay is not None:
        if policy.max_server_delay > 0 and server_delay > policy.max_server_delay:
            return policy.max_server_delay
        return min(server_delay, policy.max_delay)

    delay = policy.base_delay * (policy.multiplier ** attempt_index)
    delay = min(delay, policy.max_delay)
    if policy.jitter <= 0:
        return delay
    spread = delay * policy.jitter
    return max(0.0, delay + random.uniform(-spread, spread))


async def async_retry(
    operation: Callable[[], Awaitable[T]],
    *,
    policy: RetryPolicy,
    operation_name: str,
    logger: logging.Logger,
    is_retryable: Callable[[BaseException], bool] = is_retryable_exception,
) -> T:
    attempts = max(1, policy.max_attempts)
    last_exc: BaseException | None = None

    for attempt in range(1, attempts + 1):
        try:
            return await operation()
        except Exception as exc:
            last_exc = exc
            if attempt >= attempts or not is_retryable(exc):
                raise

            delay = retry_delay_for_exception(exc, policy, attempt - 1)
            await _emit_retry_event(
                {
                    "operation": operation_name,
                    "attempt": attempt + 1,
                    "max_attempts": attempts,
                    "delay_seconds": round(delay, 3),
                    "reason": _short_reason(exc),
                }
            )
            logger.warning(
                "[Retry] operation=%s attempt=%d/%d delay=%.2fs reason=%s",
                operation_name,
                attempt + 1,
                attempts,
                delay,
                _short_reason(exc),
            )
            await asyncio.sleep(delay)

    assert last_exc is not None
    raise last_exc


def set_retry_event_handler(handler: RetryEventHandler | None):
    return _retry_event_handler.set(handler)


def reset_retry_event_handler(token: Any) -> None:
    _retry_event_handler.reset(token)


async def _emit_retry_event(payload: dict[str, Any]) -> None:
    handler = _retry_event_handler.get()
    if handler is None:
        return
    result = handler(payload)
    if inspect.isawaitable(result):
        await result


def _extract_header_delay(headers: Any | None) -> float | None:
    if not headers:
        return None

    retry_after = _header_get(headers, "retry-after")
    if retry_after:
        numeric = _parse_float(retry_after)
        if numeric is not None:
            return max(0.0, numeric + 1.0)
        try:
            retry_at = parsedate_to_datetime(retry_after)
            if retry_at.tzinfo is None:
                retry_at = retry_at.replace(tzinfo=timezone.utc)
            return max(0.0, (retry_at - datetime.now(timezone.utc)).total_seconds() + 1.0)
        except (TypeError, ValueError, IndexError, OverflowError):
            pass

    reset_after = _header_get(headers, "x-ratelimit-reset-after")
    if reset_after:
        numeric = _parse_float(reset_after)
        if numeric is not None:
            return max(0.0, numeric + 1.0)

    reset = _header_get(headers, "x-ratelimit-reset")
    if reset:
        numeric = _parse_float(reset)
        if numeric is not None:
            return max(0.0, numeric - datetime.now(timezone.utc).timestamp() + 1.0)

    return None


def _header_get(headers: Any, key: str) -> str | None:
    getter = getattr(headers, "get", None)
    if callable(getter):
        value = getter(key) or getter(key.title())
        return str(value) if value is not None else None
    return None


def _normalize_unit_delay(value: float, unit: str) -> float:
    seconds = value / 1000.0 if unit.lower() == "ms" else value
    return max(0.0, seconds + 1.0)


def _parse_float(value: str) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


def _short_reason(exc: BaseException) -> str:
    reason = str(exc).replace("\n", " ").strip()
    return reason[:240] if reason else type(exc).__name__
