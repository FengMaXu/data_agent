import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AttemptRecorder,
  compareProjectionIdentity,
  createEpisodeRecord,
  normalizeFacts,
  openAttemptRecorder,
  projectSpans,
  rebuildSpanProjection,
  summarizeUsage,
} from "./record.mjs";

test("record projection is idempotent for duplicate and out-of-order facts", () => {
  const facts = [
    { eventId: "end", type: "run_end", runId: "op", status: "completed", occurredAt: 30, traceId: "trace" },
    { eventId: "start", type: "run_start", runId: "op", occurredAt: 10, traceId: "trace" },
    { eventId: "tool-end", type: "tool_end", toolCallId: "tool", toolName: "query_database", isError: false, occurredAt: 20, traceId: "trace" },
    { eventId: "tool-end", type: "tool_end", toolCallId: "tool", toolName: "query_database", isError: false, occurredAt: 20, traceId: "trace" },
  ];
  const first = projectSpans(facts);
  const second = projectSpans([facts[2], facts[0], facts[3], facts[1]]);
  assert.equal(first.coverage.eventCount, 3);
  assert.equal(first.coverage.spanCount, 2);
  assert.equal(first.coverage.openSpanCount, 0);
  assert.equal(first.spans.find((span) => span.kind === "agent").outcome, "completed");
  assert.equal(compareProjectionIdentity(first, second), true);
});

test("runtime observations keep repeated turns and message updates while deduplicating exact duplicates", () => {
  const facts = normalizeFacts([
    { event: { type: "turn_start", runId: "op", turnId: "turn-1" }, observedAt: 1 },
    { event: { type: "turn_start", runId: "op", turnId: "turn-1" }, observedAt: 2 },
    { event: { type: "turn_start", runId: "op", turnId: "turn-2" }, observedAt: 3 },
    { event: { type: "message_update", runId: "op", event: { type: "text_delta", delta: "a" } }, observedAt: 4 },
    { event: { type: "message_update", runId: "op", event: { type: "text_delta", delta: "b" } }, observedAt: 5 },
  ]);
  assert.equal(facts.length, 4);
});

test("message spans use message identity and close on authoritative message_end", () => {
  const projection = projectSpans([
    { event: { type: "message_start", runId: "op", message: { id: "message-1", role: "assistant" } }, observedAt: 1 },
    { event: { type: "message_end", runId: "op", message: { id: "message-1", role: "assistant" } }, observedAt: 2 },
  ]);
  const message = projection.spans.find((span) => span.kind === "model" && span.name === "model.message");
  assert.equal(message?.lifecycle, "ended");
  assert.equal(projection.coverage.openSpanCount, 0);
});

test("SQL and Fanout observations project to stable child spans", () => {
  const traceId = "trace";
  const parentSpanId = "span_tool";
  const projection = projectSpans([
    { eventId: "query", type: "db.result_query", traceId, parentSpanId, occurredAt: 4, payload: { invocationId: "query-1", startedAt: 1, endedAt: 4, status: "completed" } },
    { eventId: "fanout", type: "answering.fanout", traceId, parentSpanId, occurredAt: 5, payload: { invocationId: "fanout-1", status: "completed" } },
    { eventId: "probe", type: "db.probe", traceId, parentSpanId, occurredAt: 5, payload: { invocationId: "probe-1", status: "completed" } },
  ]);
  assert.deepEqual(projection.spans.map((span) => span.name).sort(), ["answering.fanout", "db.probe", "db.result_query"]);
  assert.ok(projection.spans.every((span) => span.parentSpanId === parentSpanId));
  assert.equal(projection.spans.find((span) => span.name === "db.result_query")?.durationMs, 3);
});

test("start-only spans preserve unknown terminal state and missing end time", () => {
  const projection = projectSpans([{ eventId: "start", type: "run_start", runId: "op", occurredAt: 10, traceId: "trace" }]);
  const span = projection.spans[0];
  assert.equal(span.lifecycle, "open");
  assert.equal(span.outcome, "unknown");
  assert.equal(span.endedAt, undefined);
  assert.equal(span.observationCoverage.state, "partial");
});

test("child operation spans retain parent linkage and separate usage", () => {
  const traceId = "trace";
  const parent = "span_parent";
  const projection = projectSpans([
    { eventId: "child-start", type: "child_operation_start", runId: "child-1", parentSpanId: parent, traceId, occurredAt: 1 },
    { eventId: "child-end", type: "child_operation_end", runId: "child-1", parentSpanId: parent, traceId, occurredAt: 4, status: "completed", usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3, cost: 0.2 } },
  ]);
  const child = projection.spans.find((span) => span.name === "child.operation");
  assert.equal(child.parentSpanId, parent);
  assert.equal(child.outcome, "completed");
  assert.equal(child.usage.totalTokens, 3);
  assert.equal(summarizeUsage(projection.spans).childUsage.cost.total, 0.2);
});

test("usage rows are counted once and aggregate totals are not double-counted", () => {
  const projection = projectSpans([
    { eventId: "usage-1", type: "usage", occurredAt: 10, traceId: "trace", payload: { row: { id: "request-1", usage: { input: 2, output: 3, totalTokens: 5 } }, totals: { totalTokens: 5 } } },
    { eventId: "usage-1-duplicate", type: "usage", occurredAt: 11, traceId: "trace", payload: { row: { id: "request-1", usage: { input: 2, output: 3, totalTokens: 5 } } } },
  ]);
  const summary = summarizeUsage(projection.spans);
  assert.equal(projection.spans.length, 1);
  assert.equal(summary.usage.totalTokens, 5);
  assert.equal(summary.usage.inputTokens, 2);
});

test("AttemptRecorder appends facts, redacts secrets, seals a versioned episode, and preserves late evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "spider-record-"));
  try {
    const recorder = new AttemptRecorder(root, { runId: "run", caseId: "case", attemptId: "attempt", traceId: "trace" });
    await recorder.recordEvent({ eventId: "start", type: "run_start", runId: "operation", occurredAt: 1, payload: { apiKey: "do-not-store" } });
    await recorder.recordEvent({ eventId: "end", type: "run_end", runId: "operation", status: "completed", occurredAt: 2 });
    const sealed = await recorder.seal({ publication: { state: "published", receiptId: "receipt" } });
    assert.equal(sealed.episode.execution.state, "completed");
    assert.equal(sealed.episode.publication.receiptId, "receipt");
    const eventText = await readFile(path.join(root, "events.jsonl"), "utf8");
    assert.doesNotMatch(eventText, /do-not-store/);
    assert.match(eventText, /REDACTED/);
    assert.ok((await readFile(path.join(root, "spans.v1.jsonl"), "utf8")).includes("agent.operation"));
    const episodeV1 = await readFile(path.join(root, "episode.v1.json"), "utf8");
    const late = await recorder.appendLateEvidence({ eventId: "late", type: "usage", occurredAt: 3, row: { id: "request", usage: { input: 1, output: 1, totalTokens: 2 } } });
    assert.equal(late.projection.projectionVersion, 2);
    assert.ok(await readFile(path.join(root, "spans.v2.jsonl"), "utf8"));
    assert.equal(await readFile(path.join(root, "episode.v1.json"), "utf8"), episodeV1);
    const reopened = await openAttemptRecorder(undefined, root, { runId: "run", caseId: "case", attemptId: "attempt", traceId: "trace" });
    const later = await reopened.appendLateEvidence({ eventId: "later", type: "usage", occurredAt: 4, row: { id: "request-2", usage: { input: 1, output: 1, totalTokens: 2 } } });
    assert.equal(later.projection.projectionVersion, 3);
    assert.equal(later.episode.publication.receiptId, "receipt");
    const rebuilt = await rebuildSpanProjection(root, { projectionVersion: 4 });
    assert.equal(rebuilt.projectionVersion, 4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("createEpisodeRecord keeps correctness and coverage unknown until offline scoring evidence exists", () => {
  const record = createEpisodeRecord({ runId: "run", caseId: "case", attemptId: "attempt", events: [] });
  assert.equal(record.correctness.state, "unknown");
  assert.equal(record.coverage.state, "unknown");
  assert.notEqual(record.correctness.state, "incorrect");
});
