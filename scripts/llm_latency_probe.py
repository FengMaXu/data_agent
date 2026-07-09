from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.ai.base_provider import Message, Role, ToolDefinition  # noqa: E402
from src.ai.gateway import AIGateway  # noqa: E402
from src.config_manager import ConfigManager  # noqa: E402


@dataclass
class ProbeResult:
    attempt: int
    model: str
    base_url: str
    prompt_chars: int
    tool_mode: str
    ok: bool
    error: str
    time_to_message_start_ms: float | None
    time_to_first_text_ms: float | None
    time_to_first_tool_call_ms: float | None
    total_ms: float
    prompt_tokens: int
    completion_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    total_tokens: int
    text_chars: int
    tool_call_count: int


def _load_effective_config():
    config_manager = ConfigManager()
    config_manager.llm_profiles.apply_default_to(config_manager.ai_config)
    return config_manager.ai_config


def _dummy_tools() -> list[ToolDefinition]:
    return [
        ToolDefinition(
            name="read_workspace_file",
            description="Dummy tool schema for measuring model tool-call latency only.",
            parameters={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative workspace file path.",
                    }
                },
                "required": ["path"],
            },
        )
    ]


async def _run_once(
    *,
    attempt: int,
    model: str,
    prompt: str,
    temperature: float,
    max_tokens: int,
    tool_mode: str,
) -> ProbeResult:
    config = _load_effective_config()
    gateway = AIGateway(config)
    messages = [Message(role=Role.USER, content=prompt)]
    tools = _dummy_tools() if tool_mode == "dummy" else None

    started_at = time.perf_counter()
    message_start_at: float | None = None
    first_text_at: float | None = None
    first_tool_call_at: float | None = None
    final_response = None
    text_chars = 0
    tool_call_count = 0

    try:
        async for event in gateway.stream(
            model,
            messages,
            tools,
            temperature=temperature,
            max_tokens=max_tokens,
        ):
            now = time.perf_counter()
            if event.type == "message_start" and message_start_at is None:
                message_start_at = now
            elif event.type == "text_delta":
                if first_text_at is None:
                    first_text_at = now
                text_chars += len(event.text or "")
            elif event.type == "tool_call_start":
                if first_tool_call_at is None:
                    first_tool_call_at = now
                tool_call_count += 1
            elif event.type == "done":
                final_response = event.response
    except Exception as exc:
        total_ms = (time.perf_counter() - started_at) * 1000
        return ProbeResult(
            attempt=attempt,
            model=model,
            base_url=config.openai_base_url,
            prompt_chars=len(prompt),
            tool_mode=tool_mode,
            ok=False,
            error=f"{type(exc).__name__}: {exc}",
            time_to_message_start_ms=_elapsed_ms(started_at, message_start_at),
            time_to_first_text_ms=_elapsed_ms(started_at, first_text_at),
            time_to_first_tool_call_ms=_elapsed_ms(started_at, first_tool_call_at),
            total_ms=round(total_ms, 3),
            prompt_tokens=0,
            completion_tokens=0,
            cache_read_tokens=0,
            cache_write_tokens=0,
            total_tokens=0,
            text_chars=text_chars,
            tool_call_count=tool_call_count,
        )

    total_ms = (time.perf_counter() - started_at) * 1000
    usage = final_response.usage if final_response else None
    return ProbeResult(
        attempt=attempt,
        model=model,
        base_url=config.openai_base_url,
        prompt_chars=len(prompt),
        tool_mode=tool_mode,
        ok=True,
        error="",
        time_to_message_start_ms=_elapsed_ms(started_at, message_start_at),
        time_to_first_text_ms=_elapsed_ms(started_at, first_text_at),
        time_to_first_tool_call_ms=_elapsed_ms(started_at, first_tool_call_at),
        total_ms=round(total_ms, 3),
        prompt_tokens=usage.prompt_tokens if usage else 0,
        completion_tokens=usage.completion_tokens if usage else 0,
        cache_read_tokens=usage.cache_read_tokens if usage else 0,
        cache_write_tokens=usage.cache_write_tokens if usage else 0,
        total_tokens=usage.total_tokens if usage else 0,
        text_chars=text_chars,
        tool_call_count=tool_call_count,
    )


def _elapsed_ms(started_at: float, ended_at: float | None) -> float | None:
    if ended_at is None:
        return None
    return round((ended_at - started_at) * 1000, 3)


def _print_result(result: ProbeResult) -> None:
    print(json.dumps(asdict(result), ensure_ascii=False))


async def _main() -> int:
    config = _load_effective_config()
    parser = argparse.ArgumentParser(
        description="Measure raw LLM latency without the agent loop or local tools."
    )
    parser.add_argument("--model", default=config.default_model)
    parser.add_argument(
        "--prompt",
        default="请用一句中文回答：今天适合做一次简短的 LLM 延迟测试。",
    )
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--temperature", type=float, default=config.temperature)
    parser.add_argument("--max-tokens", type=int, default=128)
    parser.add_argument(
        "--tool-mode",
        choices=("none", "dummy"),
        default="none",
        help="Use 'dummy' to measure model function-call latency with one dummy tool schema.",
    )
    args = parser.parse_args()

    exit_code = 0
    for attempt in range(1, max(1, args.repeat) + 1):
        result = await _run_once(
            attempt=attempt,
            model=args.model,
            prompt=args.prompt,
            temperature=args.temperature,
            max_tokens=args.max_tokens,
            tool_mode=args.tool_mode,
        )
        _print_result(result)
        if not result.ok:
            exit_code = 1
    return exit_code


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
