# Production Retry Mechanism Plan

## Goals

Build a production-grade retry mechanism for Data Agent queries.

The retry system must:

1. Recover from transient infrastructure failures.
2. Avoid retrying deterministic business errors.
3. Keep retries observable in logs and timing data.
4. Keep user-facing behavior predictable.
5. Use one shared retry primitive instead of scattered one-off loops.

## Non-Goals

1. Do not blindly retry invalid SQL, permission errors, missing tables, or bad request payloads.
2. Do not hide persistent outages behind very long waits.
3. Do not retry after a stream has already emitted partial LLM content unless the caller can safely replay.
4. Do not add a distributed queue or durable workflow engine in the first phase.

## Error Taxonomy

### Retryable

1. Network connection errors.
2. Request timeouts.
3. LLM rate limits.
4. LLM 5xx or temporary service unavailable errors.
5. MCP not-ready during startup or reconnect.
6. MCP transport disconnects.

### Not Retryable

1. SQL syntax and schema errors.
2. SQL guard violations.
3. Authentication and authorization errors.
4. Missing API keys.
5. 4xx request validation errors except 408, 409, 425, and 429.
6. Tool argument validation errors.

## Retry Policy

Use exponential backoff with jitter.

Default policy:

1. Attempts: 3 total attempts for ordinary calls.
2. Base delay: 0.5 seconds.
3. Multiplier: 2.
4. Max delay: 8 seconds.
5. Jitter: 20%.

Specialized policies:

1. LLM request creation: 4 attempts, base delay 1 second, max delay 12 seconds.
2. MCP tool calls: 3 attempts, base delay 0.5 seconds, max delay 4 seconds.
3. SQL execution: no extra SQL-level retry for semantic errors; rely on MCP transport retry.

## Architecture

## Reference From `D:\pi-mono`

The reference project uses a few production patterns worth adopting:

1. Retry only before streaming output begins.
2. Treat 429, 500, 502, 503, and 504 as retryable.
3. Treat network failures and overloaded/service unavailable text as retryable.
4. Prefer server-provided retry delays when available.
5. Cap server-requested delays so one request cannot hang the whole user flow.
6. Surface retry lifecycle through events in UI-capable clients.

This project will adopt the first five points in Phase 1. UI retry lifecycle events are deferred to Phase 2 because the current SSE protocol needs a small event-schema addition.

### Shared Module

Add `src/resilience/retry.py`.

Responsibilities:

1. Define `RetryPolicy`.
2. Define retry decision helpers.
3. Provide `async_retry()` for coroutine calls.
4. Log every retry attempt with operation name, attempt number, delay, and reason.

### LLM Layer

OpenAI-compatible provider should use the shared retry primitive when creating the streaming response.

Reason:

The request can be safely retried before any stream chunk has been consumed. Once streaming starts, replaying would risk duplicate user-visible output.

### MCP Layer

`_ManagedServer.call_tool()` should use the shared retry primitive around readiness and transport disconnect handling.

Reason:

MCP startup and reconnect are common transient states. The tool caller should not need to know whether the MCP process is restarting.

### SQL Layer

Keep SQL semantic validation outside retry. SQL validation errors are returned to the model for correction.

Reason:

Retrying the same invalid SQL wastes time and can obscure the real corrective action.

## Development Plan

### Phase 1: Core Retry Primitive and Critical Path

Implement:

1. Shared async retry helper.
2. OpenAI-compatible request creation retry.
3. MCP call readiness/transport retry.
4. Focused tests for retry behavior.

Verification:

1. Unit tests for retry helper.
2. Unit tests for retryable and non-retryable decisions.
3. Existing MCP manager tests still pass.
4. Python compile check.

### Phase 2: Observability

Implement:

1. Structured retry logs.
2. Optional timing counters for retry attempts.
3. User-facing transient status events where safe.

Verification:

1. Logs contain operation, attempt, delay, and final failure.
2. No duplicate stream output.

### Phase 3: Policy Configuration

Implement:

1. Runtime config for retry attempts and delays.
2. Per-subsystem overrides.
3. Sensible hard caps.

Verification:

1. Defaults work without config.
2. Invalid config falls back safely.

### Phase 4: Broader Tool Coverage

Implement:

1. Retry wrappers for HTTP ecosystem hooks.
2. Retry wrappers for metadata store calls.
3. Optional circuit breaker for repeatedly failing MCP servers.

Verification:

1. No retry for deterministic 4xx errors.
2. Circuit breaker opens after sustained failures and recovers after cooldown.
