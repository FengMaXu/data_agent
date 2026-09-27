import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertComparableExperiments } from "./experiment.mjs";
import { createEpisodeRecord, normalizeFacts, publicationFromReceipt, projectSpans } from "./record.mjs";

function asScore(value) {
  return value === 1 || value === true ? 1 : value === 0 || value === false ? 0 : undefined;
}

function average(values) {
  const known = values.filter((value) => Number.isFinite(value));
  return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : undefined;
}

export async function scoreAttempt(record, scorer, options = {}) {
  if (typeof scorer !== "function") throw new Error("SCORER_REQUIRED");
  const startedAt = Date.now();
  const scoreRunId = options.scoreRunId ?? `score-${Date.now()}`;
  const traceId = options.traceId ?? `score-${record?.attemptId ?? "unknown"}`;
  const scorerName = options.scorer ?? "unknown";
  try {
    const score = await scorer(record, options);
    const finishedAt = Date.now();
    const correctness = score?.state ? score : { state: asScore(score?.correct) === 1 ? "correct" : asScore(score?.correct) === 0 ? "incorrect" : "unknown", ...(score ?? {}) };
    return {
      schemaVersion: 1,
      scoreRunId,
      traceId,
      attemptId: record?.attemptId ?? null,
      caseId: record?.caseId ?? null,
      scorer: scorerName,
      inputRefs: [record?.traceId, record?.sourceRefs].flat().filter(Boolean),
      correctness,
      durationMs: finishedAt - startedAt,
      coverage: score?.coverage ?? { state: "complete" },
      span: { schemaVersion: 1, spanId: `score-span:${scoreRunId}`, traceId, kind: "scorer", name: scorerName, lifecycle: "ended", outcome: "completed", startedAt, endedAt: finishedAt, sourceRefs: [record?.traceId].filter(Boolean) },
    };
  } catch (error) {
    const finishedAt = Date.now();
    return {
      schemaVersion: 1,
      scoreRunId,
      traceId,
      attemptId: record?.attemptId ?? null,
      caseId: record?.caseId ?? null,
      scorer: scorerName,
      inputRefs: [record?.traceId].filter(Boolean),
      correctness: { state: "unavailable", error: error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) } },
      durationMs: finishedAt - startedAt,
      coverage: { state: "missing", reason: "scorer_failed" },
      span: { schemaVersion: 1, spanId: `score-span:${scoreRunId}`, traceId, kind: "scorer", name: scorerName, lifecycle: "ended", outcome: "unknown", startedAt, endedAt: finishedAt, sourceRefs: [record?.traceId].filter(Boolean) },
    };
  }
}

export async function persistScoreRecord(scoreRecord, outputPath) {
  if (!outputPath) throw new Error("SCORE_OUTPUT_PATH_REQUIRED");
  await writeFile(outputPath, `${JSON.stringify(scoreRecord, null, 2)}\n`, "utf8");
  return scoreRecord;
}

export function fixedDenominatorScores(scores, denominator) {
  const entries = Object.entries(scores ?? {});
  const correct = entries.reduce((sum, [, value]) => sum + (asScore(value) === 1 ? 1 : 0), 0);
  const known = entries.filter(([, value]) => asScore(value) !== undefined).length;
  const total = Number.isSafeInteger(denominator) && denominator >= 0 ? denominator : entries.length;
  return {
    score: total ? correct / total : undefined,
    correct,
    total,
    submittedTotal: known,
    missingSubmissions: Math.max(0, total - known),
    unknown: entries.length - known,
  };
}

function aggregateUsage(records, usageKey, spanCountKey) {
  const expectedCalls = records.reduce((sum, record) => sum + Number(record.usage?.[spanCountKey] ?? 0), 0);
  const observed = records.map((record) => record.usage?.[usageKey] ?? (usageKey === "mainUsage" ? record.usage?.usage : undefined)).filter(Boolean);
  const knownTokenRows = observed.filter((item) => Number.isFinite(item.totalTokens));
  const knownCostRows = observed.filter((item) => Number.isFinite(item.cost?.total));
  return {
    calls: expectedCalls,
    observedCalls: observed.length,
    coverage: expectedCalls ? observed.length / expectedCalls : expectedCalls === 0 ? 1 : undefined,
    totalTokens: knownTokenRows.length ? knownTokenRows.reduce((sum, item) => sum + item.totalTokens, 0) : undefined,
    tokenCoverage: expectedCalls ? knownTokenRows.length / expectedCalls : expectedCalls === 0 ? 1 : undefined,
    totalCost: knownCostRows.length ? knownCostRows.reduce((sum, item) => sum + item.cost.total, 0) : undefined,
    costCoverage: expectedCalls ? knownCostRows.length / expectedCalls : expectedCalls === 0 ? 1 : undefined,
  };
}

function aggregateCapabilities(records) {
  const names = new Set(records.flatMap((record) => Object.keys(record.capabilities ?? {})));
  return Object.fromEntries([...names].sort().map((name) => {
    const values = records.map((record) => record.capabilities?.[name]).filter(Boolean);
    return [name, {
      configured: values.filter((value) => value.configured === true).length,
      executed: values.filter((value) => value.executed === true).length,
      coverage: Object.fromEntries(values.map((value) => value.coverage ?? "unknown").reduce((counts, state) => counts.set(state, (counts.get(state) ?? 0) + 1), new Map())),
      missing: records.length - values.length,
    }];
  }));
}

function aggregateSpans(records) {
  const spans = records.flatMap((record) => record.spans ?? []);
  const ids = new Set(spans.map((span) => span.spanId));
  const byKind = {};
  for (const span of spans) {
    const key = span.name ?? span.kind ?? "unknown";
    const bucket = byKind[key] ??= { calls: 0, failed: 0, open: 0, durationKnown: 0, totalDurationMs: 0, observationComplete: 0 };
    bucket.calls += 1;
    if (span.outcome === "failed") bucket.failed += 1;
    if (span.lifecycle !== "ended") bucket.open += 1;
    if (Number.isFinite(span.durationMs)) { bucket.durationKnown += 1; bucket.totalDurationMs += span.durationMs; }
    if (span.observationCoverage?.state === "complete") bucket.observationComplete += 1;
  }
  for (const bucket of Object.values(byKind)) {
    bucket.failureRate = bucket.calls ? bucket.failed / bucket.calls : undefined;
    bucket.durationCoverage = bucket.calls ? bucket.durationKnown / bucket.calls : undefined;
    bucket.averageDurationMs = bucket.durationKnown ? bucket.totalDurationMs / bucket.durationKnown : undefined;
    bucket.observationCompleteness = bucket.calls ? bucket.observationComplete / bucket.calls : undefined;
  }
  return {
    total: spans.length,
    open: spans.filter((span) => span.lifecycle !== "ended").length,
    failed: spans.filter((span) => span.outcome === "failed").length,
    missingParent: spans.filter((span) => span.kind !== "agent" && !span.parentSpanId).length,
    danglingParent: spans.filter((span) => span.parentSpanId && !ids.has(span.parentSpanId)).length,
    byKind,
  };
}

export function buildEvaluationReport(records, scores = {}, options = {}) {
  const list = [...(records ?? [])];
  const denominatorIds = options.denominatorIds ? [...options.denominatorIds] : list.map((record) => record.caseId).filter(Boolean);
  const byCase = new Map(list.map((record) => [record.caseId, record]));
  const denominator = [...new Set(denominatorIds)].sort();
  const dimensions = {
    execution: {},
    publication: {},
    correctness: {},
    coverage: {},
  };
  for (const id of denominator) {
    const record = byCase.get(id);
    const recordedCorrectness = record?.correctness?.state;
    const rescoredCorrectness = asScore(scores[id]) === 1 ? "correct" : asScore(scores[id]) === 0 ? "incorrect" : undefined;
    const correctness = recordedCorrectness && recordedCorrectness !== "unknown" ? recordedCorrectness : rescoredCorrectness ?? "unknown";
    for (const [dimension, state] of [
      ["execution", record?.execution?.state ?? "unknown"],
      ["publication", record?.publication?.state ?? "unknown"],
      ["correctness", correctness],
      ["coverage", record?.coverage?.state ?? "unknown"],
    ]) dimensions[dimension][state] = (dimensions[dimension][state] ?? 0) + 1;
  }
  const selected = denominator.map((id) => byCase.get(id)).filter(Boolean);
  const latencies = selected.map((record) => record.execution?.endedAt !== undefined && record.execution?.startedAt !== undefined ? record.execution.endedAt - record.execution.startedAt : undefined);
  const usage = selected.map((record) => record.usage?.usage).filter(Boolean);
  const knownCosts = usage.map((item) => item.cost?.total).filter((value) => Number.isFinite(value));
  const denominatorScores = Object.fromEntries(denominator.filter((id) => Object.hasOwn(scores ?? {}, id)).map((id) => [id, scores[id]]));
  const score = fixedDenominatorScores(denominatorScores, denominator.length);
  const submittedScore = fixedDenominatorScores(denominatorScores, Object.values(denominatorScores).filter((value) => asScore(value) !== undefined).length);
  const missingRecords = denominator.filter((id) => !byCase.has(id));
  const recordFailures = selected.filter((record) => record.integrity?.recordIncomplete === true || record.coverage?.state === "partial" || record.coverage?.state === "unknown");
  const infraStates = new Set(["provider_failed", "infra_failed", "resource_error", "error"]);
  const validExecutionStates = new Set(["completed", "budget_exhausted", "cancelled"]);
  const published = selected.filter((record) => record.publication?.state === "published");
  const requiredFormat = options.requiredFormat ?? "csv";
  const formatSatisfied = selected.filter((record) => record.deliveryRequirement?.format === requiredFormat && record.deliveryRequirement?.satisfied === true);
  const processKeys = ["turns", "toolCalls", "revisions", "explorationQueries", "resultQueries", "fanoutProbes"];
  const process = Object.fromEntries(processKeys.map((key) => [key, selected.reduce((sum, record) => sum + Number(record.process?.[key] ?? 0), 0)]));
  const spanMetrics = aggregateSpans(selected);
  spanMetrics.conflicts = selected.reduce((sum, record) => sum + Number(record.integrity?.projectionConflicts ?? 0), 0);
  const changes = options.baselineRecords ? compareEpisodes(options.baselineRecords, selected, { denominatorIds: denominator }) : undefined;
  return {
    schemaVersion: 1,
    experimentId: options.experimentId ?? null,
    denominator,
    metrics: {
      total: denominator.length,
      dimensions,
      executionSummary: {
        valid: selected.filter((record) => validExecutionStates.has(record.execution?.state)).length,
        infrastructureFailures: selected.filter((record) => infraStates.has(record.execution?.state)).length,
        unknown: selected.filter((record) => !validExecutionStates.has(record.execution?.state) && !infraStates.has(record.execution?.state)).length + missingRecords.length,
        timeout: selected.filter((record) => record.execution?.state === "budget_exhausted").length,
        cancelled: selected.filter((record) => record.execution?.state === "cancelled").length,
      },
      recordSummary: { missing: missingRecords.length, incomplete: recordFailures.length },
      publicationSummary: {
        published: published.length,
        rate: denominator.length ? published.length / denominator.length : undefined,
        requiredFormat,
        formatSatisfied: formatSatisfied.length,
        formatCoverage: denominator.length ? formatSatisfied.length / denominator.length : undefined,
      },
      correctness: score,
      officialCorrectness: submittedScore,
      latency: { known: latencies.filter((value) => value !== undefined).length, averageMs: average(latencies), p95Ms: percentile(latencies, 0.95) },
      usage: {
        known: usage.length,
        coverage: denominator.length ? usage.length / denominator.length : undefined,
        totalCost: knownCosts.length ? knownCosts.reduce((sum, value) => sum + value, 0) : undefined,
        unknownCostCount: usage.length - knownCosts.length,
        main: aggregateUsage(selected, "mainUsage", "modelSpanCount"),
        child: aggregateUsage(selected, "childUsage", "childSpanCount"),
        jev: aggregateUsage(selected, "jevUsage", "jevSpanCount"),
      },
      process,
      capabilities: aggregateCapabilities(selected),
      spans: spanMetrics,
      ...(changes ? { changes: { improved: changes.improved, regressed: changes.regressed, incomplete: changes.incomplete, paired: changes.paired } } : {}),
    },
    limitations: [
      ...(missingRecords.length ? ["missing_episode_record"] : []),
      ...(recordFailures.length ? ["record_coverage_incomplete"] : []),
      ...(usage.some((item) => item.cost?.total === undefined) ? ["cost_coverage_incomplete"] : []),
      ...(list.some((record) => record.execution?.state === "unknown") ? ["execution_terminal_unknown"] : []),
    ],
  };
}

function percentile(values, quantile) {
  const known = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (!known.length) return undefined;
  return known[Math.min(known.length - 1, Math.ceil(known.length * quantile) - 1)];
}

export function compareEpisodes(leftRecords, rightRecords, options = {}) {
  const left = new Map((leftRecords ?? []).map((record) => [record.caseId, record]));
  const right = new Map((rightRecords ?? []).map((record) => [record.caseId, record]));
  const ids = [...new Set([...left.keys(), ...right.keys(), ...(options.denominatorIds ?? [])])].sort();
  const paired = ids.map((caseId) => {
    const leftRecord = left.get(caseId);
    const rightRecord = right.get(caseId);
    const leftState = leftRecord?.correctness?.state ?? "unknown";
    const rightState = rightRecord?.correctness?.state ?? "unknown";
    const leftCorrect = leftState === "correct";
    const rightCorrect = rightState === "correct";
    const knownPair = [leftState, rightState].every((state) => state === "correct" || state === "incorrect");
    return {
      caseId,
      left: leftState,
      right: rightState,
      change: leftRecord && rightRecord && knownPair && leftCorrect !== rightCorrect ? rightCorrect ? "improved" : "regressed" : "unchanged_or_unknown",
      complete: Boolean(leftRecord && rightRecord && knownPair && leftRecord.coverage?.state !== "unknown" && rightRecord.coverage?.state !== "unknown"),
    };
  });
  return {
    denominator: ids,
    paired,
    improved: paired.filter((item) => item.change === "improved").map((item) => item.caseId),
    regressed: paired.filter((item) => item.change === "regressed").map((item) => item.caseId),
    incomplete: paired.filter((item) => !item.complete).map((item) => item.caseId),
  };
}

export function compareExperiments(left, right, policy = {}) {
  const identity = assertComparableExperiments(left, right);
  if (!identity.comparable && policy.rejectIncomparable !== false) return { ...identity, formal: false, reason: "UNDECLARED_EXPERIMENT_DIFFERENCE" };
  return { ...identity, formal: true };
}

export async function loadEpisodeRecord(root) {
  const text = await readFile(path.join(root, "episode.json"), "utf8");
  return JSON.parse(text);
}

/** Convert one old result/trace pair explicitly; no report silently guesses old fields. */
export function legacyRecordFromResult(result = {}, trace = {}, context = {}) {
  const events = normalizeFacts(trace.events ?? [], { runId: context.runId, caseId: result.instanceId, attemptId: context.attemptId });
  const calls = trace.toolCalls ?? [];
  const publicationCall = calls.findLast?.((call) => ["export_query", "publish_query_result"].includes(call.toolName) && call.result?.details?.publicationReceipt)
    ?? [...calls].reverse().find((call) => ["export_query", "publish_query_result"].includes(call.toolName) && call.result?.details?.publicationReceipt);
  const receipt = publicationCall?.result?.details?.publicationReceipt ?? (publicationCall?.result?.details?.receiptId ? publicationCall.result.details : undefined);
  const projection = projectSpans([
    ...events,
    ...calls.map((call, index) => ({
      type: call.toolName === "query_database" ? (call.args?.mode === "result" ? "db.result_query" : "db.exploration_query") : call.toolName,
      eventId: `legacy-call-${index + 1}`,
      sequence: index + 1,
      occurredAt: call.startedAt ?? call.finishedAt ?? index + 1,
      traceId: context.traceId ?? `legacy-${result.instanceId ?? "case"}`,
      operationId: call.operationId,
      payload: { ...call, ...(call.args ? { args: call.args } : {}), ...(call.result ? { result: call.result } : {}) },
    })),
  ], context);
  return createEpisodeRecord({
    ...context,
    caseId: result.instanceId,
    attemptId: context.attemptId ?? "legacy",
    events,
    projection,
    execution: { state: result.status === "completed" ? "completed" : result.status === "provider_error" ? "provider_failed" : result.status ?? "unknown", sourceRefs: [] },
    publication: publicationFromReceipt(receipt, result.csvError ? { readError: result.csvError } : {}),
    correctness: { state: "unknown", reason: "legacy_record_requires_rescore" },
    coverage: { state: "partial", reason: "legacy_record_converted", source: "legacy-result-trace" },
    integrity: { legacy: true, toolCallCount: calls.length },
  });
}

