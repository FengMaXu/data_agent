import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
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
  resolveExternalKnowledge,
  resolveMetadataDirectory,
  selectCases,
  selectFinalSql,
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
    { toolCallId: "e", toolName: "export_query", args: { queryArtifactId: "artifact-2" }, isError: false, finishedAt: 3, result: { details: { taskComplete: true } } },
  ]), { sql: "select 2", toolCallId: "e", toolName: "export_query", queryArtifactId: "artifact-2" });
  const previewOnly = [
    { toolCallId: "q", toolName: "query_database", args: { sql: "select 1" }, isError: false, finishedAt: 1, result: { details: { queryArtifactId: "artifact-1" } } },
    { toolCallId: "explore", toolName: "query_database", args: { sql: "successful exploration" }, isError: false, finishedAt: 2, result: { details: { exploratory: true } } },
    { toolCallId: "blocked", toolName: "query_database", args: { sql: "blocked exploration" }, isError: false, finishedAt: 3, result: { details: { warning: "EXPLORATION_BUDGET_EXCEEDED" } } },
  ];
  assert.deepEqual(selectFinalSql(previewOnly), { sql: "select 1", toolCallId: "q", toolName: "query_database", queryArtifactId: "artifact-1" });
  assert.equal(selectFinalSql(previewOnly, { assuranceMode: "shadow" }), undefined);
  assert.equal(selectFinalSql(previewOnly, { assuranceMode: "enforce" }), undefined);
  assert.equal(selectFinalSql([
    { toolCallId: "q", toolName: "query_database", args: { sql: "select 1" }, isError: false, finishedAt: 1, result: { details: { queryArtifactId: "artifact-1" } } },
    { toolCallId: "blocked-export", toolName: "export_query", args: { queryArtifactId: "artifact-1" }, isError: false, finishedAt: 2, result: { details: { status: "blocked", terminal: true } } },
  ]), undefined);
  assert.equal(selectFinalSql([]), undefined);
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
});

test("evaluation harness guardrails carry the configured budget and live turn count", () => {
  let turnCount = 7;
  const guardrails = buildEvaluationGuardrails({ maxTurns: 20, maxExploratoryQueries: 6 }, () => turnCount);
  assert.equal(guardrails.explorationQueryBudget, 6);
  assert.equal("requireJoinReconciliation" in guardrails, false);
  assert.deepEqual(guardrails.taskProgress(), { turnCount: 7, maxTurns: 20 });
  turnCount = 12;
  assert.deepEqual(guardrails.taskProgress(), { turnCount: 12, maxTurns: 20 });
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
