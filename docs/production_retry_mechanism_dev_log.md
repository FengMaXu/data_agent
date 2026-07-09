# Production Retry Mechanism Dev Log

## 2026-04-27 - Phase 1: Core Retry Primitive and Critical Path

### Completed

Implemented the first production retry layer for transient infrastructure failures.

Files changed:

1. `src/resilience/retry.py`
2. `src/resilience/__init__.py`
3. `src/ai/openai_provider.py`
4. `src/mcp/manager.py`
5. `src/api/agent.py`
6. `tests/test_retry.py`
7. `tests/test_mcp_manager_reconcile.py`
8. `tests/test_agent_runtime_signature.py`
9. `docs/production_retry_mechanism_plan.md`

### What changed

Added a shared async retry helper with:

1. Exponential backoff.
2. Jitter.
3. Retryable HTTP/status classification.
4. Network, timeout, rate-limit, service-unavailable, and MCP-not-ready classification.
5. Parsing for server-provided retry delays such as `Retry-After`, `x-ratelimit-reset-after`, `Please retry in ...`, and `"retryDelay": "...s"`.
6. A cap for server-requested retry delays.

OpenAI-compatible request creation now uses the shared retry helper before stream chunks are consumed.

MCP tool calls now use bounded retries for MCP-not-ready and transport reconnect failures.

The existing session tool cache fix remains in place: MCP runtime generation is part of the session tool cache signature, so reconnects invalidate stale tools.

### Decision

Retry transient infrastructure failures, not semantic or business errors.

### Decision reasons

1. Retrying invalid SQL, bad tool arguments, auth failures, or missing resources creates delay without changing the result.
2. LLM request creation can be safely retried before any stream output is emitted.
3. MCP readiness and reconnect failures are often short-lived and should not force users to open a new chat window.
4. A shared retry primitive prevents each subsystem from inventing slightly different retry behavior.
5. The `D:\pi-mono` reference showed useful production practices: classify retryable status codes, parse server retry delays, cap long server-requested waits, and retry before stream output begins.

### Tradeoffs

The first phase logs retries but does not yet emit UI-level `auto_retry_start` or `auto_retry_end` events. That belongs in Phase 2 because it needs an SSE event-schema addition and frontend rendering.

MCP call retry now waits in shorter bounded chunks instead of one long 30-second wait. This improves recovery responsiveness while keeping total wait bounded by the retry policy.

### Verification

Commands run:

1. `python -m py_compile src\resilience\retry.py src\ai\openai_provider.py src\mcp\manager.py src\api\agent.py`
2. `python -m pytest tests\test_retry.py tests\test_mcp_manager_reconcile.py tests\test_agent_runtime_signature.py`

Results:

1. Python compile check passed.
2. Focused tests passed: 16 passed.

## 2026-04-27 - Phase 2: Retry Observability Events

### Completed

Added structured retry observability for chat runs.

Files changed:

1. `src/resilience/retry.py`
2. `src/api/agent.py`
3. `frontend/src/api/client.ts`
4. `frontend/src/components/ChatArea.tsx`
5. `tests/test_retry.py`

### What changed

The shared retry helper now emits a structured retry event whenever it schedules another attempt.

The chat request context installs a request-local retry event handler. Retry events from deep LLM or MCP code are routed back into the current SSE stream as:

```json
{
  "type": "auto_retry",
  "operation": "llm.openai.stream.create.deepseek-chat",
  "attempt": 2,
  "max_attempts": 4,
  "delay_seconds": 1.0,
  "reason": "Connection error."
}
```

The frontend now recognizes `auto_retry` events and displays a transient retry notice in the active assistant message while the run is still processing.

### Decision

Use `contextvars` for request-local retry events.

### Decision reasons

1. Retry happens inside deep infrastructure code, but SSE belongs to the active chat request.
2. Passing an event queue through every LLM, MCP, and tool call boundary would spread transport concerns across unrelated modules.
3. `contextvars` are copied into the agent task at creation time, so concurrent sessions can emit retry events to their own streams without global state collisions.
4. A structured `auto_retry` event keeps retry visibility out of the model's final answer content.

### Tradeoffs

The UI currently shows only the latest retry notice. It does not keep a full retry timeline. This keeps the first UI integration quiet and avoids overwhelming the chat surface.

### Verification

Commands run:

1. `python -m py_compile src\resilience\retry.py src\api\agent.py src\ai\openai_provider.py src\mcp\manager.py`
2. `python -m pytest tests\test_retry.py tests\test_mcp_manager_reconcile.py tests\test_agent_runtime_signature.py`
3. `npm run build` in `frontend`

Results:

1. Python compile check passed.
2. Focused backend tests passed: 17 passed.
3. Frontend TypeScript/Vite build passed. Vite reported the existing large chunk warning.
