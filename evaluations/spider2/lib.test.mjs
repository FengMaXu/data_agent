import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
import {
  backendForCase,
  buildAgentPrompt,
  buildEvaluationGuardrails,
  buildEvaluationLearning,
  buildEvaluationRules,
  classifyProviderFailure,
  createRecorder,
  ddlCsvToMarkdown,
  ddlCsvToSql,
  deterministicGateCasesFromLabels,
  extractProviderFailure,
  exceedsTurnBudget,
  fixedDenominatorScore,
  parseCorrectIdsCsv,
  parseCsvRows,
  parseJsonl,
  parseOfficialCaseScores,
  parseOfficialScore,
  publishedCsvPath,
  resolveExternalKnowledge,
  resolveMetadataDirectory,
  runPromptWithTimeout,
  selectCases,
  selectFinalSql,
  selectModelProfile,
  sha256Tree,
  validateOfficialEvaluatorSource,
} from "./lib.mjs";

test("parseJsonl validates official fields and duplicate ids", () => {
  const cases = parseJsonl([
    JSON.stringify({ instance_id: "local002", db: "B", question: "q2", external_knowledge: null }),
    JSON.stringify({ instance_id: "local001", db: "A", question: "q1", external_knowledge: "a.md" }),
  ].join("\n"));
  assert.equal(cases.length, 2);
  assert.throws(() => parseJsonl('{"instance_id":"x"}'), /db_required/);
  assert.throws(() => parseJsonl([
    '{"instance_id":"x","db":"a","question":"q","external_knowledge":null}',
    '{"instance_id":"x","db":"a","question":"q","external_knowledge":null}',
  ].join("\n")), /DUPLICATE_INSTANCE_ID/);
});

test("backendForCase follows Spider2 id prefixes", () => {
  assert.equal(backendForCase({ instance_id: "local001" }), "sqlite");
  assert.equal(backendForCase({ instance_id: "bq001" }), "bigquery");
  assert.equal(backendForCase({ instance_id: "ga001" }), "bigquery");
  assert.equal(backendForCase({ instance_id: "sf_bq001" }), "snowflake");
  assert.throws(() => backendForCase({ instance_id: "other001" }), /UNSUPPORTED_INSTANCE_ID/);
});

test("selectModelProfile switches the main model and assurance planners without storing credentials", () => {
  const base = {
    llm: { provider: "openai", model: "default", apiKeyEnv: "DEFAULT_KEY" },
    assurance: { reviewerModel: "default", enumerator: { model: "default", trigger: "on_anomaly" } },
    modelProfiles: {
      deepseek: { llm: { provider: "openai", model: "deepseek-chat", apiKeyEnv: "DEEPSEEK_KEY", baseUrlEnv: "DEEPSEEK_URL", apiFormat: "chat" } },
      "gpt-5.5": { llm: { provider: "openai", model: "gpt-5.5", apiKeyEnv: "GPT55_KEY", baseUrlEnv: "GPT55_URL", apiFormat: "chat" } },
    },
  };
  const selected = selectModelProfile(base, "gpt-5.5");
  assert.equal(selected.selectedModelProfile, "gpt-5.5");
  assert.deepEqual(selected.llm, { provider: "openai", model: "gpt-5.5", apiKeyEnv: "GPT55_KEY", baseUrlEnv: "GPT55_URL", apiFormat: "chat" });
  assert.equal(selected.assurance.reviewerModel, "gpt-5.5");
  assert.equal(selected.assurance.plannerLlm.model, "gpt-5.5");
  assert.equal(selected.assurance.enumerator.model, "gpt-5.5");
  assert.equal(selected.assurance.enumerator.trigger, "on_anomaly");
  assert.throws(() => selectModelProfile(base, "missing"), /MODEL_PROFILE_NOT_FOUND:missing/);
  assert.throws(() => selectModelProfile({ modelProfiles: { unsafe: { llm: { model: "x", apiKey: "secret", apiKeyEnv: "KEY" } } } }, "unsafe"), /inline_api_key_forbidden/);
});

test("selectCases filters, sorts, and limits deterministically", () => {
  const cases = [
    { instance_id: "local010", db: "a", question: "q" },
    { instance_id: "bq001", db: "b", question: "q" },
    { instance_id: "local002", db: "a", question: "q" },
  ];
  assert.deepEqual(selectCases(cases, { backend: "sqlite", maxCases: 1 }).map((item) => item.instance_id), ["local002"]);
});

test("selectFinalSql follows the exact exported Query Artifact", () => {
  assert.deepEqual(selectFinalSql([
    { toolCallId: "q1", toolName: "query_database", args: { sql: "select 1" }, isError: false, finishedAt: 1, result: { details: { queryArtifactId: "artifact-1" } } },
    { toolCallId: "q2", toolName: "query_database", args: { sql: "select 2" }, isError: false, finishedAt: 2, result: { details: { queryArtifactId: "artifact-2" } } },
    { toolCallId: "e", toolName: "export_query", args: { queryArtifactId: "artifact-2" }, isError: false, finishedAt: 3, result: { details: { taskComplete: true, publicationReceipt: { queryArtifactId: "artifact-2" } } } },
  ]), { sql: "select 2", toolCallId: "e", toolName: "export_query", queryArtifactId: "artifact-2" });
  assert.deepEqual(selectFinalSql([
    { toolCallId: "combined", toolName: "query_database", args: { sql: "select 4", mode: "result", deliverIfEligible: true }, isError: false, finishedAt: 1, result: { details: { queryArtifactId: "artifact-4", taskComplete: true, publicationReceipt: { queryArtifactId: "artifact-4" } } } },
  ]), { sql: "select 4", toolCallId: "combined", toolName: "query_database", queryArtifactId: "artifact-4" });
  assert.deepEqual(selectFinalSql([
    { toolCallId: "current-query", toolName: "query_database", args: { sql: "select 5", mode: "result", revisionId: "2" }, isError: false, finishedAt: 1, result: { details: { queryArtifactId: "artifact-5", candidateId: "artifact-5", artifactKind: "result_candidate", planProtocolVersion: "evidence-plan-v2" } } },
    { toolCallId: "current-export", toolName: "export_query", args: { candidateId: "artifact-5" }, isError: false, finishedAt: 2, result: { details: { taskComplete: true, publicationReceipt: { queryArtifactId: "artifact-5", decisionBinding: { selectedDecisionRefs: [], selectionInputHashes: [] } } } } },
  ]), { sql: "select 5", toolCallId: "current-export", toolName: "export_query", queryArtifactId: "artifact-5" });
  const previewOnly = [
    { toolCallId: "q", toolName: "query_database", args: { sql: "select 1" }, isError: false, finishedAt: 1, result: { details: { queryArtifactId: "artifact-1" } } },
    { toolCallId: "explore", toolName: "query_database", args: { sql: "successful exploration", mode: "exploration" }, isError: false, finishedAt: 2, result: { details: { artifactKind: "exploration", exploratory: true } } },
    { toolCallId: "blocked", toolName: "query_database", args: { sql: "blocked exploration" }, isError: false, finishedAt: 3, result: { details: { warning: "EXPLORATION_BUDGET_EXCEEDED" } } },
  ];
  assert.equal(selectFinalSql(previewOnly), undefined);
  assert.equal(selectFinalSql(previewOnly, { assuranceMode: "shadow" }), undefined);
  assert.equal(selectFinalSql(previewOnly, { assuranceMode: "enforce" }), undefined);
  assert.equal(selectFinalSql([
    { toolCallId: "q", toolName: "query_database", args: { sql: "select 1" }, isError: false, finishedAt: 1, result: { details: { queryArtifactId: "artifact-1" } } },
    { toolCallId: "blocked-export", toolName: "export_query", args: { queryArtifactId: "artifact-1" }, isError: false, finishedAt: 2, result: { details: { status: "blocked", terminal: true } } },
  ]), undefined);
  assert.deepEqual(selectFinalSql([
    { toolCallId: "inline-query", toolName: "query_database", args: { sql: "select 3" }, isError: false, finishedAt: 1, result: { details: { queryArtifactId: "artifact-3", artifactKind: "result_candidate" } } },
    { toolCallId: "inline-publish", toolName: "publish_query_result", args: { queryArtifactId: "artifact-3" }, isError: false, finishedAt: 2, result: { details: { taskComplete: true, publicationReceipt: { queryArtifactId: "artifact-3" } } } },
  ]), { sql: "select 3", toolCallId: "inline-publish", toolName: "publish_query_result", queryArtifactId: "artifact-3" });
  assert.equal(selectFinalSql([
    { toolCallId: "q", toolName: "query_database", args: { sql: "select 1" }, isError: false, finishedAt: 1, result: { details: { queryArtifactId: "artifact-1" } } },
    { toolCallId: "fake-export", toolName: "export_query", args: { queryArtifactId: "artifact-1" }, isError: false, finishedAt: 2, result: { details: { taskComplete: true } } },
  ]), undefined);
  assert.equal(selectFinalSql([
    { toolCallId: "q", toolName: "query_database", args: { sql: "select 1" }, isError: false, finishedAt: 1, result: { details: { queryArtifactId: "artifact-1" } } },
    { toolCallId: "mixed-export", toolName: "export_query", args: { candidateId: "artifact-1", queryArtifactId: "wrong" }, isError: false, finishedAt: 2, result: { details: { taskComplete: true, publicationReceipt: { queryArtifactId: "artifact-1" } } } },
  ]), undefined);
  assert.equal(selectFinalSql([
    { toolCallId: "q", toolName: "query_database", args: { sql: "select 1" }, isError: false, finishedAt: 1, result: { details: { queryArtifactId: "artifact-1" } } },
    { toolCallId: "wrong-receipt", toolName: "export_query", args: { queryArtifactId: "artifact-1" }, isError: false, finishedAt: 2, result: { details: { taskComplete: true, publicationReceipt: { queryArtifactId: "artifact-2" } } } },
  ]), undefined);
  assert.equal(selectFinalSql([]), undefined);
});

test("publishedCsvPath extracts CSV from combined query delivery as well as explicit export", () => {
  const combined = { toolCallId: "q", toolName: "query_database", result: { details: { relativePath: "exports/q.csv", publicationReceipt: { targetPath: "exports/q.csv" } } } };
  assert.equal(publishedCsvPath({ toolCallId: "q", toolName: "query_database" }, [combined]), "exports/q.csv");
  const explicit = { toolCallId: "e", toolName: "export_query", args: { filename: "exports/e.csv" }, result: { details: {} } };
  assert.equal(publishedCsvPath({ toolCallId: "e", toolName: "export_query" }, [explicit]), "exports/e.csv");
});

test("selectFinalSql rejects multiple published branches and mismatched Decision bindings", () => {
  const query = { toolCallId: "q", toolName: "query_database", args: { sql: "select 1" }, isError: false, finishedAt: 1, result: { details: { queryArtifactId: "a1", planProtocolVersion: "evidence-plan-v2", selectedDecisionRefs: [{ decisionId: "D", alternativeId: "A" }], decisionSelectionInputHashes: ["hash-a"] } } };
  const good = { toolCallId: "e1", toolName: "export_query", args: { queryArtifactId: "a1" }, isError: false, finishedAt: 2, result: { details: { taskComplete: true, publicationReceipt: { queryArtifactId: "a1", decisionBinding: { selectedDecisionRefs: [{ decisionId: "D", alternativeId: "A" }], selectionInputHashes: ["hash-a"] } } } } };
  assert.deepEqual(selectFinalSql([query, good]), { sql: "select 1", toolCallId: "e1", toolName: "export_query", queryArtifactId: "a1" });
  const second = { ...good, toolCallId: "e2", finishedAt: 3 };
  assert.equal(selectFinalSql([query, good, second]), undefined);
  const missing = { ...good, result: { details: { taskComplete: true, publicationReceipt: { queryArtifactId: "a1" } } } };
  assert.equal(selectFinalSql([query, missing]), undefined);
  const wrong = { ...good, result: { details: { taskComplete: true, publicationReceipt: { queryArtifactId: "a1", decisionBinding: { selectedDecisionRefs: [{ decisionId: "D", alternativeId: "B" }], selectionInputHashes: ["hash-a"] } } } } };
  assert.equal(selectFinalSql([query, wrong]), undefined);
  const wrongHash = { ...good, result: { details: { taskComplete: true, publicationReceipt: { queryArtifactId: "a1", decisionBinding: { selectedDecisionRefs: [{ decisionId: "D", alternativeId: "A" }], selectionInputHashes: ["hash-b"] } } } } };
  assert.equal(selectFinalSql([query, wrongHash]), undefined);
  const emptyReceipt = { ...good, result: { details: { taskComplete: true, publicationReceipt: { queryArtifactId: "a1", decisionBinding: { selectedDecisionRefs: [], selectionInputHashes: [] } } } } };
  const missingRefs = { ...query, result: { details: { queryArtifactId: "a1", planProtocolVersion: "evidence-plan-v2", decisionSelectionInputHashes: [] } } };
  const missingHashes = { ...query, result: { details: { queryArtifactId: "a1", planProtocolVersion: "evidence-plan-v2", selectedDecisionRefs: [] } } };
  assert.equal(selectFinalSql([missingRefs, emptyReceipt]), undefined);
  assert.equal(selectFinalSql([missingHashes, emptyReceipt]), undefined);
});

test("deterministic gate labels become dialect-scoped replay cases", () => {
  const cases = deterministicGateCasesFromLabels([{ caseId: "local001", dialect: "sqlite", gates: [
    { gate: "g1_shape", expected: "block", applicability: "checked", blocking: true },
    { gate: "g3_fanout", expected: "pass", applicability: "not_applicable", blocking: false },
  ] }]);
  assert.deepEqual(cases.map((item) => ({ caseId: item.caseId, dialect: item.dialect, expected: item.expected, gate: item.result.gate, blocking: item.result.blocking })), [
    { caseId: "local001:g1_shape", dialect: "sqlite", expected: "block", gate: "g1_shape", blocking: true },
    { caseId: "local001:g3_fanout", dialect: "sqlite", expected: "pass", gate: "g3_fanout", blocking: false },
  ]);
  assert.throws(() => deterministicGateCasesFromLabels([{ caseId: "broken", gates: [{ gate: "g1_shape", expected: "pass" }] }]), /DIALECT_REQUIRED/);
});

test("evaluation knowledge preserves reusable rules and adds SQLite guidance", () => {
  const rules = buildEvaluationRules("# Base rules\n\n- Use DISTINCT", { instance_id: "local001", db: "demo" });
  assert.match(rules, /# Base rules/);
  assert.match(rules, /Use DISTINCT/);
  assert.match(rules, /Backend: sqlite/);
  assert.match(rules, /strftime/);
  assert.match(rules, /julianday/);
  assert.match(rules, /information_schema/);
  assert.match(buildEvaluationLearning("# Curated learnings"), /Curated learnings/);
});

test("buildAgentPrompt adds only the final CSV delivery instruction", () => {
  const question = "Original question?\n请返回销售额。";
  const prompt = buildAgentPrompt({ instance_id: "local001", question });
  assert.match(prompt, /^Original question\?\n请返回销售额。/);
  assert.match(prompt, /将最终成果导出为 CSV/);
  assert.match(prompt, /使用 export_query 生成 CSV/);
  assert.doesNotMatch(prompt, /verification|reconciliation/i);
});

test("provider failures are detected from assistant events", () => {
  const message = 'OpenAI API error (402): {"message":"Insufficient Balance"}';
  assert.deepEqual(classifyProviderFailure(message), { status: 402, message, fatal: true });
  assert.deepEqual(extractProviderFailure({
    type: "agent_end",
    messages: [{ role: "assistant", stopReason: "error", errorMessage: message }],
  }), { status: 402, message, fatal: true });
  assert.equal(extractProviderFailure({ type: "message_end", message: { role: "assistant", stopReason: "stop" } }), undefined);
  assert.deepEqual(classifyProviderFailure("Connection error."), { status: null, message: "Connection error.", fatal: true });
});

test("evaluation harness guardrails carry the configured budget and live turn count", () => {
  let turnCount = 7;
  let toolCallCount = 3;
  const guardrails = buildEvaluationGuardrails({ maxTurns: 20, maxToolCalls: 30, maxExploratoryQueries: 6 }, () => turnCount, () => toolCallCount);
  assert.equal(guardrails.explorationQueryBudget, 6);
  assert.equal("requireJoinReconciliation" in guardrails, false);
  assert.deepEqual(guardrails.taskProgress(), { turnCount: 7, maxTurns: 20, toolCallCount: 3, maxToolCalls: 30 });
  turnCount = 12;
  toolCallCount = 9;
  assert.deepEqual(guardrails.taskProgress(), { turnCount: 12, maxTurns: 20, toolCallCount: 9, maxToolCalls: 30 });
  assert.equal("requireJoinReconciliation" in buildEvaluationGuardrails({ requireJoinReconciliation: false }, () => 0), false);
});

test("turn budget allows the configured final turn and stops the next one", () => {
  assert.equal(exceedsTurnBudget(19, 20), false);
  assert.equal(exceedsTurnBudget(20, 20), false);
  assert.equal(exceedsTurnBudget(21, 20), true);
});

test("correct-id parsing normalizes official SQLite prefixes and fixed scores use the selected denominator", () => {
  assert.deepEqual(parseCorrectIdsCsv("instance_id\r\nsf_local004\r\nlocal007\r\n"), ["local004", "local007"]);
  assert.deepEqual(fixedDenominatorScore(6, 25, 21), {
    score: 0.24,
    correct: 6,
    total: 25,
    submittedTotal: 21,
    missingSubmissions: 4,
  });
});

test("CSV parser and DDL converter support quoted multiline statements", () => {
  const csv = 'table_name,DDL\nusers,"CREATE TABLE users (\n id INTEGER,\n name TEXT\n);"\n';
  assert.deepEqual(parseCsvRows(csv), [
    ["table_name", "DDL"],
    ["users", "CREATE TABLE users (\n id INTEGER,\n name TEXT\n);"],
  ]);
  assert.match(ddlCsvToSql(csv), /CREATE TABLE users/);
  const markdown = ddlCsvToMarkdown(csv, "sample");
  assert.match(markdown, /# Database Schema: sample/);
  assert.match(markdown, /## Table: users/);
  assert.match(markdown, /CREATE TABLE users/);
});

test("metadata and external knowledge resolution stay inside official resources", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "spider2-eval-"));
  await mkdir(path.join(root, "resource", "databases", "sqlite", "DB_IMDB"), { recursive: true });
  await mkdir(path.join(root, "resource", "documents"), { recursive: true });
  await writeFile(path.join(root, "resource", "documents", "guide.md"), "guide", "utf8");
  const instance = { instance_id: "local001", db: "Db-IMDB", question: "q", external_knowledge: "guide.md" };
  assert.equal(await resolveMetadataDirectory(root, instance), path.join(root, "resource", "databases", "sqlite", "DB_IMDB"));
  assert.deepEqual(await resolveExternalKnowledge(root, instance), [path.join(root, "resource", "documents", "guide.md")]);
  await assert.rejects(
    resolveExternalKnowledge(root, { ...instance, external_knowledge: "../gold/answer.md" }),
    /PATH_ESCAPE/,
  );
});

test("sha256Tree is stable across file creation order and changes with content", async () => {
  const left = await mkdtemp(path.join(os.tmpdir(), "spider2-tree-left-"));
  const right = await mkdtemp(path.join(os.tmpdir(), "spider2-tree-right-"));
  await mkdir(path.join(left, "nested"));
  await mkdir(path.join(right, "nested"));
  await writeFile(path.join(left, "b.txt"), "b");
  await writeFile(path.join(left, "nested", "a.txt"), "a");
  await writeFile(path.join(right, "nested", "a.txt"), "a");
  await writeFile(path.join(right, "b.txt"), "b");
  assert.equal(await sha256Tree(left), await sha256Tree(right));
  await writeFile(path.join(right, "b.txt"), "changed");
  assert.notEqual(await sha256Tree(left), await sha256Tree(right));
});

test("official score parsers read aggregate and per-case results", () => {
  const output = "{'local003': 0, 'local004': 1}\nFinal score: 0.5, Correct examples: 1, Total examples: 2\nReal score: 0.003";
  assert.deepEqual(parseOfficialScore(output), { score: 0.5, correct: 1, total: 2 });
  assert.deepEqual(parseOfficialCaseScores(output), { local003: 0, local004: 1 });
  assert.equal(parseOfficialScore("no score"), undefined);
});

test("official evaluator validation rejects hard-coded GBK decoding", () => {
  assert.doesNotThrow(() => validateOfficialEvaluatorSource('pd.read_csv("result.csv")'));
  assert.throws(
    () => validateOfficialEvaluatorSource('payload.decode("gbk")'),
    /EVALUATOR_HARDCODED_GBK_DECODE/,
  );
  assert.throws(
    () => validateOfficialEvaluatorSource("payload.decode ( 'GBK' )"),
    /EVALUATOR_HARDCODED_GBK_DECODE/,
  );
});

test("createRecorder stores each completed message and tool payload exactly once", () => {
  let subscriber;
  const mockHarness = {
    subscribe: (fn) => {
      subscriber = fn;
      return () => {};
    },
    abort: () => {},
  };
  const recorder = createRecorder(mockHarness, { maxTurns: 20, maxToolCalls: 50 });

  subscriber({ type: "agent_start" });
  subscriber({ type: "turn_start" });
  subscriber({ type: "message_start", message: { role: "assistant" } });
  subscriber({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hello" } });
  subscriber({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: " world" } });
  subscriber({ type: "tool_execution_update", toolCallId: "call_1", update: "streaming..." });
  subscriber({ type: "tool_execution_start", toolCallId: "call_1", toolName: "query_database", args: { sql: "SELECT 1" } });
  subscriber({ type: "tool_execution_end", toolCallId: "call_1", result: { content: [{ type: "text", text: "1" }] }, isError: false });
  subscriber({ type: "message_start", message: { role: "toolResult", content: [{ type: "text", text: "1" }] } });
  subscriber({ type: "message_end", message: { role: "toolResult", content: [{ type: "text", text: "1" }] } });
  subscriber({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Hello world" }], stopReason: "stop" } });
  subscriber({ type: "turn_end", message: { role: "assistant", content: [{ type: "text", text: "Hello world" }] }, toolResults: [{ content: [{ type: "text", text: "1" }] }] });
  subscriber({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "Hello world" }] }] });

  assert.equal(recorder.turnCount, 1);
  assert.equal(recorder.calls.length, 1);
  assert.equal(recorder.calls[0].toolName, "query_database");
  assert.equal(recorder.calls[0].isError, false);

  const eventTypes = recorder.events.map((e) => e.type);
  assert.deepEqual(eventTypes, ["agent_start", "turn_start", "message_end"]);
  const persisted = JSON.stringify({ events: recorder.events, toolCalls: recorder.calls });
  assert.equal(persisted.match(/Hello world/g)?.length, 1);
  assert.equal(persisted.match(/SELECT 1/g)?.length, 1);
  assert.equal(recorder.events.some((e) => e.type === "message_update"), false);
  assert.equal(recorder.events.some((e) => e.type === "tool_execution_update"), false);
});

test("createRecorder marks a zero-call provider error as resumable", () => {
  let subscriber;
  const mockHarness = {
    subscribe: (fn) => { subscriber = fn; return () => {}; },
    abort: () => {},
  };
  const recorder = createRecorder(mockHarness, { maxTurns: 20, maxToolCalls: 50 });
  subscriber({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "Connection error." } });
  assert.equal(recorder.calls.length, 0);
  assert.equal(recorder.terminalReason, "provider_error");
  assert.deepEqual(recorder.providerFailure, { status: null, message: "Connection error.", fatal: true });
});

test("task timeout does not settle before AgentHarness abort cleanup", async () => {
  let releaseAbort;
  let abortStarted = false;
  const harness = {
    subscribe: () => () => {},
    prompt: () => new Promise(() => {}),
    abort: () => {
      abortStarted = true;
      return new Promise((resolve) => { releaseAbort = resolve; });
    },
  };
  const recorder = createRecorder(harness, {});
  let outcome;
  const execution = runPromptWithTimeout(harness, "prompt", 5, recorder).then(
    () => { outcome = "resolved"; return undefined; },
    (error) => { outcome = error; return error; },
  );
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(abortStarted, true);
  assert.equal(outcome, undefined);
  releaseAbort();
  const error = await execution;
  assert.match(error.message, /TASK_TIMEOUT/);
});

test("turn-limit abort cleanup completes before the prompt runner settles", async () => {
  let subscriber;
  let releaseAbort;
  let abortStarted = false;
  const harness = {
    subscribe: (next) => { subscriber = next; return () => {}; },
    prompt: async () => {
      subscriber({ type: "message_start", message: { role: "assistant" } });
      subscriber({ type: "message_start", message: { role: "assistant" } });
    },
    abort: () => {
      abortStarted = true;
      return new Promise((resolve) => { releaseAbort = resolve; });
    },
  };
  const recorder = createRecorder(harness, { maxTurns: 1 });
  let outcome;
  const execution = runPromptWithTimeout(harness, "prompt", null, recorder).then(
    () => { outcome = "resolved"; return undefined; },
    (error) => { outcome = error; return error; },
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(abortStarted, true);
  assert.equal(outcome, undefined);
  releaseAbort();
  const error = await execution;
  assert.match(error.message, /MAX_TURNS/);
});

test("Spider2 run --help is side-effect free and does not start an evaluation", async () => {
  const runnerPath = path.resolve("evaluations/spider2/run.mjs");
  const { stdout, stderr } = await execFileAsync(process.execPath, [runnerPath, "run", "--help"], { timeout: 3_000, windowsHide: true });
  assert.match(stdout, /Usage:/);
  assert.match(stdout, /never loads credentials or starts work/);
  assert.equal(stderr, "");
});

test("Spider2 CLI exits after printing the final report even when a referenced handle remains", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "spider2-cli-exit-"));
  const runsRoot = path.join(root, "runs");
  const runDir = path.join(runsRoot, "fixture");
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, "cases.jsonl"), "", "utf8");
  const configPath = path.join(root, "config.json");
  await writeFile(configPath, JSON.stringify({ spider2Repo: root, runsRoot }), "utf8");
  const keepAlivePath = path.join(root, "keep-alive.cjs");
  await writeFile(keepAlivePath, "setInterval(() => {}, 1000);\n", "utf8");
  const runnerPath = path.resolve("evaluations/spider2/run.mjs");
  const { stdout } = await execFileAsync(process.execPath, [
    "--require", keepAlivePath,
    runnerPath, "report",
    "--config", configPath,
    "--run", "fixture",
  ], { timeout: 3_000, windowsHide: true });
  assert.match(stdout, /Report: .*report\.md/);
});
