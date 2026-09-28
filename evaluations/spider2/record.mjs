import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const RECORD_SCHEMA_VERSION = 1;
export const SPAN_PROJECTION_VERSION = 1;

function isSecretKey(key) {
  const normalized = String(key).replace(/[_-]/g, "").toLowerCase();
  return normalized === "apikey" || normalized === "authorization" || normalized === "credential" || normalized === "password" || normalized === "secret" || normalized === "cookie" || normalized === "privatekey" || normalized === "token" || normalized.endsWith("token");
}
const TERMINAL_EVENT_TYPES = new Set(["run_end", "agent_end", "agent_error", "operation_end"]);
const START_EVENT_TYPES = new Set(["run_start", "run_resume", "agent_start", "operation_start"]);
const TOOL_START_TYPES = new Set(["tool_start", "tool_execution_start"]);
const TOOL_END_TYPES = new Set(["tool_end", "tool_execution_end"]);
const DATABASE_EVENT_TYPES = new Set(["db.exploration_query", "db.result_query", "db.probe"]);
const FANOUT_EVENT_TYPES = new Set(["answering.fanout"]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonValue(value, seen = new WeakSet()) {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (Array.isArray(value)) return value.map((item) => jsonValue(item, seen));
  if (!isRecord(value)) return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, seen)]));
}

export function redactSecrets(value, parentKey = "") {
  if (isSecretKey(parentKey)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, parentKey));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, isSecretKey(key) ? "[REDACTED]" : redactSecrets(item, key)]));
}

export function stableStringify(value) {
  const normalized = jsonValue(value);
  const sort = (item) => {
    if (Array.isArray(item)) return item.map(sort);
    if (!isRecord(item)) return item;
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, sort(item[key])]));
  };
  return JSON.stringify(sort(normalized));
}

export function contentHash(value) {
  return createHash("sha256").update(typeof value === "string" ? value : stableStringify(value), "utf8").digest("hex");
}

function id(value, prefix) {
  return `${prefix}_${contentHash(value).slice(0, 24)}`;
}

function numeric(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function observationPayload(event) {
  if (!isRecord(event)) return event;
  if (event.type === "message_start" || event.type === "message_end" || event.type === "message_update" || event.type === "turn_end") {
    return { type: event.type, ...(typeof event.runId === "string" ? { runId: event.runId } : {}), ...(typeof event.entryId === "string" ? { entryId: event.entryId } : {}), ...(typeof event.message?.id === "string" ? { messageId: event.message.id } : {}), ...(event.message?.role ? { role: event.message.role } : {}), ...(event.event?.type ? { updateType: event.event.type } : {}) };
  }
  if (event.type === "tool_start" || event.type === "tool_end" || event.type === "tool_update") {
    return { type: event.type, ...(typeof event.runId === "string" ? { runId: event.runId } : {}), ...(typeof event.toolCallId === "string" ? { toolCallId: event.toolCallId } : {}), ...(typeof event.toolName === "string" ? { toolName: event.toolName } : {}), ...(event.isError !== undefined ? { isError: event.isError } : {}) };
  }
  if (event.type === "run_end" || event.type === "fault" || event.type === "handler_error") {
    const error = isRecord(event.error) ? { code: event.error.code, message: event.error.message } : event.error;
    return { type: event.type, ...(typeof event.runId === "string" ? { runId: event.runId } : {}), ...(event.status ? { status: event.status } : {}), ...(error ? { error } : {}) };
  }
  if (event.type === "usage") return { type: event.type, ...(event.row ? { row: event.row } : {}), ...(event.totals ? { totals: event.totals } : {}) };
  if (event.type === "child_operation_start" || event.type === "child_operation_end") return { type: event.type, ...(event.runId ? { runId: event.runId } : {}), ...(event.key ? { key: event.key } : {}), ...(event.status ? { status: event.status } : {}), ...(event.operationId ? { operationId: event.operationId } : {}), ...(event.usage ? { usage: event.usage } : {}) };
  return event;
}

function eventPayload(observation) {
  if (isRecord(observation) && isRecord(observation.event)) return observation.event;
  if (isRecord(observation) && typeof observation.type === "string" && isRecord(observation.payload)) {
    return {
      ...observation.payload,
      type: observation.type,
      ...Object.fromEntries(["runId", "operationId", "requestId", "invocationId", "toolCallId", "entryId", "lane"].flatMap((key) => typeof observation[key] === "string" ? [[key, observation[key]]] : [])),
    };
  }
  return observation;
}

function eventType(observation) {
  const event = eventPayload(observation);
  return isRecord(event) && typeof event.type === "string" ? event.type : undefined;
}

function eventOperationId(observation) {
  const event = eventPayload(observation);
  if (!isRecord(event)) return undefined;
  for (const key of ["runId", "operationId", "requestId", "invocationId"]) {
    if (typeof event[key] === "string" && event[key]) return event[key];
  }
  return undefined;
}

function eventOccurrence(observation, fallbackSequence = 0) {
  if (isRecord(observation)) {
    for (const key of ["occurredAt", "timestamp", "startedAt", "endedAt", "observedAt"]) {
      const value = numeric(observation[key]);
      if (value !== undefined) return value;
    }
    if (isRecord(observation.event)) {
      for (const key of ["occurredAt", "timestamp", "startedAt", "endedAt"]) {
        const value = numeric(observation.event[key]);
        if (value !== undefined) return value;
      }
    }
  }
  return fallbackSequence;
}

function observationIdentity(observation, sequence) {
  if (isRecord(observation)) {
    for (const key of ["eventId", "observationId", "id"]) {
      if (typeof observation[key] === "string" && observation[key]) return observation[key];
    }
  }
  const event = eventPayload(observation);
  const type = eventType(observation) ?? "unknown";
  const candidates = isRecord(event)
    ? Object.fromEntries(["runId", "operationId", "requestId", "invocationId", "toolCallId", "entryId", "turnId", "id", "lane"].flatMap((key) => typeof event[key] === "string" ? [[key, event[key]]] : []))
    : {};
  if (isRecord(event?.row)) {
    for (const key of ["id", "entryId", "requestId", "invocationId"]) if (typeof event.row[key] === "string") candidates[`row.${key}`] = event.row[key];
  }
  if (isRecord(event?.message) && typeof event.message.id === "string") candidates.messageId = event.message.id;
  const occurredAt = eventOccurrence(observation, sequence);
  const payloadFingerprint = stableStringify(redactSecrets(jsonValue(event)));
  const stableIdentity = ["tool_start", "tool_end", "tool_update", "message_start", "message_end", "message_update", "turn_start", "turn_end", "usage", "run_start", "run_end", "operation_start", "operation_end"].includes(type)
    && (candidates.toolCallId || candidates.entryId || candidates.messageId || candidates["row.id"] || candidates.turnId || ["run_start", "run_end", "operation_start", "operation_end"].includes(type));
  return id({ type, ...(stableIdentity ? { candidates } : { payloadFingerprint, occurredAt }) }, "event");
}

function sourceFor(observation) {
  if (isRecord(observation) && typeof observation.source === "string") return observation.source;
  if (isRecord(observation) && typeof observation.event?.source === "string") return observation.event.source;
  return "runtime";
}

function normalizeFact(observation, sequence, context = {}) {
  const event = redactSecrets(jsonValue(observationPayload(eventPayload(observation))));
  const type = eventType(observation) ?? "unknown";
  const occurredAt = eventOccurrence(observation, sequence);
  const recordedAt = isRecord(observation) && numeric(observation.recordedAt) !== undefined
    ? observation.recordedAt
    : Date.now();
  const traceId = isRecord(observation) && typeof observation.traceId === "string"
    ? observation.traceId
    : context.traceId ?? id({ runId: context.runId, caseId: context.caseId, attemptId: context.attemptId }, "trace");
  const operationId = eventOperationId(observation);
  const parentSpanId = isRecord(observation) && typeof observation.parentSpanId === "string" ? observation.parentSpanId : undefined;
  const sourceRef = isRecord(observation) && typeof observation.sourceRef === "string" ? observation.sourceRef : undefined;
  return {
    schemaVersion: RECORD_SCHEMA_VERSION,
    eventId: observationIdentity(observation, sequence),
    sequence,
    type,
    occurredAt,
    recordedAt,
    source: sourceFor(observation),
    traceId,
    ...(operationId ? { operationId } : {}),
    ...(parentSpanId ? { parentSpanId } : {}),
    ...(sourceRef ? { sourceRef } : {}),
    ...(isRecord(observation) && typeof observation.sessionId === "string" ? { sessionId: observation.sessionId } : {}),
    payload: event,
  };
}

function factSort(left, right) {
  return (left.occurredAt - right.occurredAt) || (left.sequence - right.sequence) || left.eventId.localeCompare(right.eventId);
}

export function normalizeFacts(observations, context = {}) {
  const facts = [];
  const seen = new Set();
  for (const [index, observation] of [...(observations ?? [])].entries()) {
    const fact = observation?.schemaVersion === RECORD_SCHEMA_VERSION && typeof observation.eventId === "string" && typeof observation.type === "string"
      ? redactSecrets(jsonValue(observation))
      : normalizeFact(observation, index + 1, context);
    const key = fact.eventId;
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push(fact);
  }
  return facts.sort(factSort);
}

function eventIdOf(fact) {
  return fact.eventId ?? id(fact, "event");
}

function spanIdentity(fact) {
  const payload = fact.payload ?? {};
  const type = fact.type;
  if (TOOL_START_TYPES.has(type) || TOOL_END_TYPES.has(type)) {
    return `tool:${payload.toolCallId ?? payload.invocationId ?? fact.operationId ?? eventIdOf(fact)}`;
  }
  if (type === "usage") {
    const row = isRecord(payload.row) ? payload.row : payload;
    return `model:${row.id ?? row.entryId ?? row.requestId ?? fact.operationId ?? eventIdOf(fact)}`;
  }
  if (START_EVENT_TYPES.has(type) || TERMINAL_EVENT_TYPES.has(type)) {
    return `operation:${payload.runId ?? fact.operationId ?? eventIdOf(fact)}`;
  }
  if (type === "child_operation_start" || type === "child_operation_end") return `child:${payload.runId ?? payload.key ?? fact.operationId ?? eventIdOf(fact)}`;
  if (type === "jev_request") return `jev:${payload.kind ?? payload.requestId ?? fact.operationId ?? eventIdOf(fact)}`;
  if (type === "agent.message_started" || type === "message_start" || type === "message_end") {
    return `model-message:${payload.messageId ?? fact.operationId ?? eventIdOf(fact)}`;
  }
  if (DATABASE_EVENT_TYPES.has(type)) {
    return `database:${payload.invocationId ?? payload.queryId ?? payload.candidateId ?? payload.targetId ?? fact.operationId ?? eventIdOf(fact)}`;
  }
  if (FANOUT_EVENT_TYPES.has(type)) {
    return `fanout:${payload.invocationId ?? payload.reportId ?? payload.candidateId ?? fact.operationId ?? eventIdOf(fact)}`;
  }
  if (type === "agent.tool_started" || type === "agent.tool_finished") {
    return `tool:${payload.toolCallId ?? fact.operationId ?? eventIdOf(fact)}`;
  }
  return undefined;
}

function spanKindName(fact) {
  const payload = fact.payload ?? {};
  if (TOOL_START_TYPES.has(fact.type) || TOOL_END_TYPES.has(fact.type) || fact.type === "agent.tool_started" || fact.type === "agent.tool_finished") {
    const toolName = typeof payload.toolName === "string" ? payload.toolName : "unknown";
    return { kind: "tool", name: `tool.${toolName}` };
  }
  if (fact.type === "usage") return { kind: "model", name: "model.request" };
  if (START_EVENT_TYPES.has(fact.type) || TERMINAL_EVENT_TYPES.has(fact.type)) return { kind: "agent", name: "agent.operation" };
  if (DATABASE_EVENT_TYPES.has(fact.type)) return { kind: "database", name: fact.type };
  if (FANOUT_EVENT_TYPES.has(fact.type)) return { kind: "internal", name: fact.type };
  if (fact.type === "child_operation_start" || fact.type === "child_operation_end") return { kind: "agent", name: "child.operation" };
  if (fact.type === "jev_request") return { kind: "model", name: "jev.request" };
  if (fact.type === "message_start" || fact.type === "message_end") return { kind: "model", name: "model.message" };
  return { kind: "event", name: fact.type };
}

function usageFrom(value) {
  if (!isRecord(value)) return undefined;
  const cost = isRecord(value.cost) ? value.cost : numeric(value.cost) !== undefined ? { total: value.cost } : undefined;
  const numbers = ["input", "output", "cacheRead", "cacheWrite", "cacheWrite1h", "reasoning", "totalTokens"].filter((key) => numeric(value[key]) !== undefined);
  if (!numbers.length && !cost) return undefined;
  return {
    ...(numeric(value.input) !== undefined ? { inputTokens: value.input } : numeric(value.inputTokens) !== undefined ? { inputTokens: value.inputTokens } : {}),
    ...(numeric(value.output) !== undefined ? { outputTokens: value.output } : numeric(value.outputTokens) !== undefined ? { outputTokens: value.outputTokens } : {}),
    ...(numeric(value.cacheRead) !== undefined ? { cacheReadTokens: value.cacheRead } : {}),
    ...(numeric(value.cacheWrite) !== undefined ? { cacheWriteTokens: value.cacheWrite } : {}),
    ...(numeric(value.cacheWrite1h) !== undefined ? { cacheWrite1hTokens: value.cacheWrite1h } : {}),
    ...(numeric(value.reasoning) !== undefined ? { reasoningTokens: value.reasoning } : {}),
    ...(numeric(value.totalTokens) !== undefined ? { totalTokens: value.totalTokens } : {}),
    ...(cost ? { cost: redactSecrets(jsonValue(cost)) } : {}),
  };
}

function mergeUsage(current, next) {
  if (!current) return next;
  if (!next) return current;
  const merged = { ...current };
  for (const key of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "cacheWrite1hTokens", "reasoningTokens", "totalTokens"]) {
    if (merged[key] === undefined && next[key] !== undefined) merged[key] = next[key];
  }
  if (!merged.cost && next.cost) merged.cost = next.cost;
  return merged;
}

function outcomeFor(fact) {
  const payload = fact.payload ?? {};
  if (fact.type === "run_end" || fact.type === "operation_end") {
    if (payload.status === "completed") return "completed";
    if (payload.status === "aborted" || payload.status === "cancelled") return "cancelled";
    if (payload.status === "failed") return "failed";
  }
  if (fact.type === "agent_end") return "completed";
  if (fact.type === "agent_error") return "failed";
  if (fact.type === "child_operation_end") return ["completed"].includes(payload.status) ? "completed" : ["cancelled", "interrupted", "timed_out"].includes(payload.status) ? "cancelled" : "failed";
  if (fact.type === "jev_request") return payload.outcome === "completed" ? "completed" : payload.outcome === "unknown" ? "unknown" : "failed";
  if (TOOL_END_TYPES.has(fact.type) || fact.type === "agent.tool_finished") return payload.isError ? "failed" : "completed";
  if (fact.type === "fault" || fact.type === "handler_error") return "failed";
  if (DATABASE_EVENT_TYPES.has(fact.type) || FANOUT_EVENT_TYPES.has(fact.type)) {
    if (payload.isError === true || payload.status === "failed" || payload.status === "error") return "failed";
    if (payload.status === "unknown") return "unknown";
    return "completed";
  }
  return undefined;
}

function eventTime(fact, key) {
  const payload = fact.payload ?? {};
  return numeric(payload[key]) ?? fact.occurredAt;
}

function initialSpan(fact, spanId, traceId) {
  const { kind, name } = spanKindName(fact);
  const payload = fact.payload ?? {};
  const startedAt = START_EVENT_TYPES.has(fact.type) || TOOL_START_TYPES.has(fact.type) || fact.type === "agent.tool_started" || fact.type === "usage" || fact.type === "child_operation_start" || fact.type === "jev_request" || fact.type === "message_start"
    ? eventTime(fact, "startedAt")
    : numeric(payload.startedAt);
  const parentSpanId = fact.parentSpanId ?? (fact.operationId && kind !== "agent" ? id({ traceId, identity: `operation:${fact.operationId}` }, "span") : undefined);
  return {
    schemaVersion: RECORD_SCHEMA_VERSION,
    projectionVersion: SPAN_PROJECTION_VERSION,
    spanId,
    traceId,
    ...(parentSpanId ? { parentSpanId } : {}),
    kind,
    name,
    startedAt,
    endedAt: undefined,
    durationMs: undefined,
    lifecycle: "open",
    outcome: "unknown",
    links: [],
    usage: undefined,
    sourceRefs: [],
    observationCoverage: { state: "partial", reason: "start_or_terminal_evidence_not_yet_complete" },
    attributes: redactSecrets({ operationId: fact.operationId, ...(typeof payload.toolName === "string" ? { toolName: payload.toolName } : {}) }),
  };
}

function finalizeSpan(span, fact) {
  const outcome = outcomeFor(fact);
  if (outcome) span.outcome = outcome;
  const endedAt = eventTime(fact, "endedAt");
  if (TERMINAL_EVENT_TYPES.has(fact.type) || TOOL_END_TYPES.has(fact.type) || DATABASE_EVENT_TYPES.has(fact.type) || FANOUT_EVENT_TYPES.has(fact.type) || fact.type === "agent.tool_finished" || fact.type === "agent_end" || fact.type === "agent_error" || fact.type === "child_operation_end" || fact.type === "jev_request" || fact.type === "message_end") {
    span.endedAt = endedAt;
    if (span.startedAt !== undefined && endedAt >= span.startedAt) span.durationMs = endedAt - span.startedAt;
    span.lifecycle = "ended";
    span.observationCoverage = { state: span.startedAt === undefined ? "partial" : "complete" };
  }
  return span;
}

export function spanIdForIdentity(traceId, identity) {
  return id({ traceId, identity }, "span");
}

function spanIdFor(traceId, identity) {
  return spanIdForIdentity(traceId, identity);
}

export function projectSpans(facts, options = {}) {
  const normalized = normalizeFacts(facts, options);
  const spans = new Map();
  const conflicts = [];
  for (const fact of normalized) {
    const identity = spanIdentity(fact);
    if (!identity) continue;
    const spanId = spanIdFor(fact.traceId, identity);
    let span = spans.get(identity);
    if (!span) {
      span = initialSpan(fact, spanId, fact.traceId);
      spans.set(identity, span);
    }
    span.sourceRefs.push(fact.sourceRef ?? fact.eventId);
    const payload = fact.payload ?? {};
    if (fact.type === "usage") {
      const row = isRecord(payload.row) ? payload.row : payload;
      const next = usageFrom(row.usage ?? row);
      span.usage = mergeUsage(span.usage, next);
      if (payload.totals) span.attributes = { ...span.attributes, usageTotalsObserved: true, ...(isRecord(payload.row) ? {} : { aggregateOnly: true }) };
      if (next) {
        span.endedAt ??= eventTime(fact, "endedAt");
        if (span.startedAt !== undefined && span.endedAt >= span.startedAt) span.durationMs = span.endedAt - span.startedAt;
        span.lifecycle = "ended";
        span.outcome = "completed";
      }
      span.observationCoverage = { state: next ? "complete" : "partial", ...(next ? {} : { reason: "usage_payload_missing" }) };
    }
    if (TOOL_START_TYPES.has(fact.type) || fact.type === "agent.tool_started") {
      span.startedAt ??= eventTime(fact, "startedAt");
      if (typeof payload.parentSpanId === "string") span.parentSpanId = payload.parentSpanId;
      if (payload.args !== undefined) span.attributes = { ...span.attributes, args: redactSecrets(jsonValue(payload.args)) };
    }
    if (fact.type === "child_operation_end" && payload.usage) span.usage = mergeUsage(span.usage, usageFrom(payload.usage));
    if (TOOL_END_TYPES.has(fact.type) || fact.type === "agent.tool_finished" || fact.type === "child_operation_end") {
      const priorOutcome = span.outcome;
      finalizeSpan(span, fact);
      if (priorOutcome !== "unknown" && outcomeFor(fact) && priorOutcome !== outcomeFor(fact)) {
        conflicts.push({ spanId, eventId: fact.eventId, reason: "conflicting_terminal_outcome", previous: priorOutcome, next: outcomeFor(fact) });
        span.observationCoverage = { state: "partial", reason: "conflicting_terminal_outcomes" };
      }
    }
    if (TERMINAL_EVENT_TYPES.has(fact.type) || DATABASE_EVENT_TYPES.has(fact.type) || FANOUT_EVENT_TYPES.has(fact.type) || fact.type === "agent_end" || fact.type === "agent_error" || fact.type === "message_end") finalizeSpan(span, fact);
    if (fact.parentSpanId && !span.parentSpanId) span.parentSpanId = fact.parentSpanId;
  }
  for (const span of spans.values()) {
    span.sourceRefs = [...new Set(span.sourceRefs)].sort();
    span.links = [...span.links].sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
    if (span.lifecycle === "open") {
      span.outcome = "unknown";
      span.observationCoverage = { state: "partial", reason: "no_authoritative_terminal_event" };
    }
  }
  return {
    schemaVersion: RECORD_SCHEMA_VERSION,
    projectionVersion: SPAN_PROJECTION_VERSION,
    spans: [...spans.values()].sort((left, right) => left.spanId.localeCompare(right.spanId)),
    conflicts,
    coverage: {
      eventCount: normalized.length,
      spanCount: spans.size,
      openSpanCount: [...spans.values()].filter((span) => span.lifecycle !== "ended").length,
      conflictCount: conflicts.length,
      usageKnownSpanCount: [...spans.values()].filter((span) => span.usage !== undefined).length,
    },
  };
}

function addUsage(total, usage) {
  if (!usage) return total;
  const result = { ...(total ?? {}) };
  for (const key of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "cacheWrite1hTokens", "reasoningTokens", "totalTokens"]) {
    if (usage[key] !== undefined) result[key] = (result[key] ?? 0) + usage[key];
  }
  if (usage.cost) {
    result.cost = { ...(result.cost ?? {}) };
    for (const [key, value] of Object.entries(usage.cost)) if (numeric(value) !== undefined) result.cost[key] = (result.cost[key] ?? 0) + value;
  }
  return result;
}

export function summarizeUsage(spans) {
  const observed = spans ?? [];
  const modelSpans = observed.filter((span) => span.kind === "model" && span.name !== "model.message" && span.name !== "jev.request" && span.attributes?.aggregateOnly !== true);
  const modelLeaves = modelSpans.filter((span) => span.usage);
  const childSpans = observed.filter((span) => span.name === "child.operation");
  const childLeaves = childSpans.filter((span) => span.usage);
  const jevSpans = observed.filter((span) => span.name === "jev.request");
  const jevLeaves = jevSpans.filter((span) => span.usage);
  const expected = modelSpans.length + childSpans.length + jevSpans.length;
  const known = modelLeaves.length + childLeaves.length + jevLeaves.length;
  return {
    state: expected > 0 && known === expected ? "known" : known ? "partial" : "unknown",
    usage: modelLeaves.reduce((total, span) => addUsage(total, span.usage), undefined),
    mainUsage: modelLeaves.reduce((total, span) => addUsage(total, span.usage), undefined),
    childUsage: childLeaves.reduce((total, span) => addUsage(total, span.usage), undefined),
    jevUsage: jevLeaves.reduce((total, span) => addUsage(total, span.usage), undefined),
    leafSpanCount: known,
    modelSpanCount: modelSpans.length,
    childSpanCount: childSpans.length,
    jevSpanCount: jevSpans.length,
  };
}

export function inferExecution(facts) {
  const normalized = normalizeFacts(facts);
  const terminal = normalized.filter((fact) => TERMINAL_EVENT_TYPES.has(fact.type) || fact.type === "agent_end" || fact.type === "agent_error").at(-1);
  if (!terminal) return { state: "unknown", observationCoverage: { state: normalized.length ? "partial" : "missing", reason: "authoritative_terminal_event_missing" }, sourceRefs: normalized.map((fact) => fact.eventId) };
  const outcome = outcomeFor(terminal);
  const state = outcome === "completed" ? "completed" : outcome === "cancelled" ? "cancelled" : outcome === "failed" ? "provider_failed" : "unknown";
  return {
    state,
    status: terminal.payload?.status ?? null,
    error: terminal.payload?.error ?? null,
    startedAt: normalized.find((fact) => START_EVENT_TYPES.has(fact.type))?.occurredAt,
    endedAt: terminal.occurredAt,
    sourceRefs: [terminal.eventId],
    observationCoverage: { state: outcome ? "complete" : "partial", ...(outcome ? {} : { reason: "terminal_outcome_unrecognized" }) },
  };
}

export function createEpisodeRecord(input = {}) {
  const facts = normalizeFacts(input.events ?? input.observations ?? [], input);
  const projection = input.projection ?? projectSpans(facts, input);
  const execution = input.execution ?? inferExecution(facts);
  const publication = input.publication ?? { state: "unknown", observationCoverage: { state: "missing", reason: "publication_not_observed" } };
  const correctness = input.correctness ?? { state: "unknown", observationCoverage: { state: "missing", reason: "scorer_not_run" } };
  const coverage = input.coverage ?? { state: "unknown", observationCoverage: { state: "missing", reason: "coverage_not_recorded" } };
  return {
    schemaVersion: RECORD_SCHEMA_VERSION,
    projectionVersion: projection.projectionVersion,
    runId: input.runId ?? "unknown",
    caseId: input.caseId ?? input.instanceId ?? "unknown",
    attemptId: input.attemptId ?? "unknown",
    traceId: input.traceId ?? facts[0]?.traceId ?? id({ runId: input.runId, caseId: input.caseId, attemptId: input.attemptId }, "trace"),
    execution,
    publication,
    correctness,
    coverage,
    usage: input.usage ?? summarizeUsage(projection.spans),
    ...(input.process ? { process: redactSecrets(jsonValue(input.process)) } : {}),
    ...(input.capabilities ? { capabilities: redactSecrets(jsonValue(input.capabilities)) } : {}),
    ...(input.deliveryRequirement ? { deliveryRequirement: redactSecrets(jsonValue(input.deliveryRequirement)) } : {}),
    spans: projection.spans.map((span) => ({
      spanId: span.spanId,
      ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
      kind: span.kind,
      name: span.name,
      lifecycle: span.lifecycle,
      outcome: span.outcome,
      startedAt: span.startedAt,
      endedAt: span.endedAt,
      durationMs: span.durationMs,
      observationCoverage: span.observationCoverage,
      ...(span.usage ? { usage: span.usage } : {}),
    })),
    integrity: {
      eventCount: facts.length,
      spanCount: projection.spans.length,
      openSpanCount: projection.coverage.openSpanCount,
      usageKnownSpanCount: projection.coverage.usageKnownSpanCount,
      projectionConflicts: projection.conflicts.length,
      ...(input.integrity ?? {}),
    },
    sourceRefs: facts.map((fact) => fact.eventId),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export class AttemptRecorder {
  constructor(destination, context = {}) {
    this.root = typeof destination === "string" ? destination : destination?.root;
    if (!this.root) throw new Error("RECORD_DESTINATION_REQUIRED");
    this.context = { ...context, ...(typeof destination === "object" ? destination : {}) };
    this.events = [];
    this.artifacts = [];
    this.eventKeys = new Set();
    this.queue = Promise.resolve();
    this.sealed = false;
    this.latestEpisode = undefined;
    this.persistenceError = undefined;
    this.projectionVersion = 0;
  }

  async ensureRoot() {
    await mkdir(this.root, { recursive: true });
  }

  enqueue(operation) {
    this.queue = this.queue.then(operation);
    return this.queue;
  }

  recordObservation(observation) {
    const fact = normalizeFact(observation, this.events.length + 1, this.context);
    if (this.eventKeys.has(fact.eventId)) return Promise.resolve(fact);
    this.eventKeys.add(fact.eventId);
    this.events.push(fact);
    return this.enqueue(async () => {
      await this.ensureRoot();
      await appendFile(path.join(this.root, "events.jsonl"), `${stableStringify(fact)}\n`, "utf8");
      return fact;
    }).catch((error) => {
      this.persistenceError ??= error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) };
      return fact;
    });
  }

  recordEvent(event) {
    return this.recordObservation(event);
  }

  async recordArtifact(artifact, content, options = {}) {
    const contentType = options.contentType ?? "application/octet-stream";
    const hash = contentHash(content);
    const artifactId = options.artifactId ?? id({ hash, contentType, name: artifact }, "artifact");
    const fileName = options.fileName ?? `${artifactId}.artifact`;
    const relativePath = path.join("artifacts", fileName);
    const target = path.join(this.root, relativePath);
    await this.enqueue(async () => {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, typeof content === "string" ? "utf8" : undefined);
    }).catch((error) => {
      this.persistenceError ??= error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) };
    });
    const descriptor = {
      schemaVersion: RECORD_SCHEMA_VERSION,
      artifactId,
      name: artifact,
      contentType,
      contentHash: hash,
      relativePath: relativePath.split(path.sep).join("/"),
      access: options.access ?? "private",
      ...(options.truncated ? { truncated: true } : {}),
      ...(options.sourceRef ? { sourceRef: options.sourceRef } : {}),
    };
    this.artifacts.push(descriptor);
    await this.enqueue(async () => {
      await this.ensureRoot();
      await writeFile(path.join(this.root, "artifacts.json"), `${stableStringify({ schemaVersion: RECORD_SCHEMA_VERSION, artifacts: this.artifacts })}\n`, "utf8");
    }).catch((error) => {
      this.persistenceError ??= error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) };
    });
    return descriptor;
  }

  async restore() {
    await this.ensureRoot();
    const eventText = await readFile(path.join(this.root, "events.jsonl"), "utf8").catch(() => "");
    for (const line of eventText.split(/\r?\n/).filter(Boolean)) {
      const fact = JSON.parse(line);
      if (!this.eventKeys.has(fact.eventId)) {
        this.eventKeys.add(fact.eventId);
        this.events.push(fact);
      }
    }
    this.events.sort(factSort);
    const artifactIndex = await readFile(path.join(this.root, "artifacts.json"), "utf8").catch(() => "");
    if (artifactIndex.trim()) this.artifacts = JSON.parse(artifactIndex).artifacts ?? [];
    const episodeText = await readFile(path.join(this.root, "episode.json"), "utf8").catch(() => "");
    this.sealed = Boolean(episodeText.trim());
    if (this.sealed) this.latestEpisode = JSON.parse(episodeText);
    const entries = await readdir(this.root).catch(() => []);
    const versions = entries.map((entry) => /^spans\.v(\d+)\.jsonl$/.exec(entry)?.[1]).filter(Boolean).map(Number);
    if (versions.length) this.projectionVersion = Math.max(...versions);
    return this;
  }

  async flush() {
    await this.queue;
  }

  async seal(input = {}) {
    if (this.sealed && !input.allowReproject) throw new Error("ATTEMPT_RECORD_ALREADY_SEALED");
    await this.flush();
    await this.ensureRoot();
    const facts = normalizeFacts(this.events, this.context);
    const projection = projectSpans(facts, this.context);
    this.projectionVersion = input.projectionVersion ?? (this.projectionVersion > 0 ? this.projectionVersion + 1 : projection.projectionVersion);
    const versionedSpans = { ...projection, projectionVersion: this.projectionVersion };
    await writeFile(path.join(this.root, `spans.v${this.projectionVersion}.jsonl`), `${versionedSpans.spans.map((span) => stableStringify(span)).join("\n")}\n`, { encoding: "utf8", flag: "wx" });
    const previous = this.latestEpisode ?? {};
    const episode = createEpisodeRecord({
      ...this.context,
      ...input,
      events: facts,
      projection: versionedSpans,
      execution: input.execution ?? previous.execution,
      publication: input.publication ?? previous.publication,
      correctness: input.correctness ?? previous.correctness,
      coverage: input.coverage ?? previous.coverage,
      usage: input.usage,
      process: input.process ?? previous.process,
      capabilities: input.capabilities ?? previous.capabilities,
      deliveryRequirement: input.deliveryRequirement ?? previous.deliveryRequirement,
      integrity: { ...(previous.integrity ?? {}), ...(input.integrity ?? {}), ...(this.persistenceError ? { recordIncomplete: true, persistenceError: this.persistenceError } : {}) },
    });
    const serializedEpisode = `${stableStringify(episode)}\n`;
    await writeFile(path.join(this.root, `episode.v${this.projectionVersion}.json`), serializedEpisode, { encoding: "utf8", flag: "wx" });
    await writeFile(path.join(this.root, "episode.json"), serializedEpisode, "utf8");
    this.latestEpisode = episode;
    this.sealed = true;
    return { episode, projection: versionedSpans };
  }

  async appendLateEvidence(observation) {
    await this.recordObservation(observation);
    return this.seal({ allowReproject: true });
  }

  unsubscribe() {
    this.stopObservation?.();
    this.stopObservation = undefined;
  }

  attach(source) {
    const subscribe = source?.subscribeObservations ?? source?.subscribeObservation;
    if (typeof subscribe !== "function") throw new Error("OBSERVATION_SOURCE_UNSUPPORTED");
    this.stopObservation = subscribe.call(source, (observation) => { void this.recordObservation(observation); });
    return this;
  }
}

export async function openAttemptRecorder(source, destination, context = {}) {
  const recorder = new AttemptRecorder(destination, context);
  await recorder.restore();
  if (source) recorder.attach(source);
  return recorder;
}

export async function loadAttemptFacts(root) {
  const text = await readFile(path.join(root, "events.jsonl"), "utf8").catch(() => "");
  return normalizeFacts(text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)));
}

export async function rebuildSpanProjection(root, input = {}) {
  const facts = await loadAttemptFacts(root);
  const projection = projectSpans(facts, input);
  const version = Number(input.projectionVersion ?? SPAN_PROJECTION_VERSION);
  await writeFile(path.join(root, `spans.v${version}.jsonl`), `${projection.spans.map((span) => stableStringify(span)).join("\n")}\n`, { encoding: "utf8", flag: "wx" });
  return { ...projection, projectionVersion: version };
}

export function compareProjectionIdentity(left, right) {
  const normalize = (projection) => (projection?.spans ?? []).map((span) => ({
    spanId: span.spanId,
    traceId: span.traceId,
    parentSpanId: span.parentSpanId,
    kind: span.kind,
    name: span.name,
    startedAt: span.startedAt,
    endedAt: span.endedAt,
    durationMs: span.durationMs,
    lifecycle: span.lifecycle,
    outcome: span.outcome,
    usage: span.usage,
    sourceRefs: span.sourceRefs,
  }));
  return stableStringify(normalize(left)) === stableStringify(normalize(right));
}

export function publicationFromReceipt(receipt, options = {}) {
  if (!receipt) return { state: "unknown", observationCoverage: { state: "missing", reason: "receipt_missing" } };
  const status = receipt.status ?? "published";
  return {
    state: status.startsWith("published") || status === "published" ? "published" : status,
    receiptId: receipt.receiptId ?? null,
    candidateId: receipt.candidateId ?? null,
    format: receipt.format ?? null,
    contentHash: receipt.contentHash ?? null,
    ...(options.readError ? { readError: options.readError } : {}),
    observationCoverage: { state: options.readError ? "partial" : "complete", ...(options.readError ? { reason: "authorized_artifact_read_failed" } : {}) },
  };
}
