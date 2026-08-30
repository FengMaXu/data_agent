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
  ddlCsvToMarkdown,
  extractProviderFailure,
  exceedsTurnBudget,
  fixedDenominatorScore,
  needsDeliveryFollowUp,
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

test("selectFinalSql prefers the last finished successful export", () => {
  const calls = [
    { toolCallId: "1", toolName: "query_database", args: { sql: "select 1" }, isError: false, finishedAt: 1 },
    { toolCallId: "2", toolName: "export_query", args: { sql: "bad" }, isError: true, finishedAt: 2 },
    { toolCallId: "3", toolName: "export_query", args: { sql: "unfinished" }, isError: false },
    { toolCallId: "4", toolName: "export_query", args: { sql: "select 2" }, isError: false, finishedAt: 3 },
    { toolCallId: "5", toolName: "query_database", args: { sql: "blocked exploration" }, isError: false, finishedAt: 4, result: { details: { warning: "EXPLORATION_BUDGET_EXCEEDED" } } },
    { toolCallId: "6", toolName: "query_database", args: { sql: "reconciliation" }, isError: false, finishedAt: 5, result: { details: { purpose: "reconciliation" } } },
  ];
  assert.deepEqual(selectFinalSql(calls), { sql: "select 2", toolCallId: "4", toolName: "export_query" });
  assert.deepEqual(selectFinalSql([
    { toolCallId: "1", toolName: "query_database", args: { sql: "select 1" }, isError: false, finishedAt: 1 },
    { toolCallId: "2", toolName: "query_database", args: { sql: "successful exploration" }, isError: false, finishedAt: 2, result: { details: { exploratory: true } } },
    { toolCallId: "3", toolName: "query_database", args: { sql: "blocked exploration" }, isError: false, finishedAt: 3, result: { details: { warning: "EXPLORATION_BUDGET_EXCEEDED" } } },
    { toolCallId: "4", toolName: "query_database", args: { sql: "reconciliation" }, isError: false, finishedAt: 4, result: { details: { purpose: "reconciliation" } } },
  ]), { sql: "select 1", toolCallId: "1", toolName: "query_database" });
  assert.equal(selectFinalSql([]), undefined);
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

test("buildAgentPrompt requires the minimal final result rather than exploratory or diagnostic output", () => {
  const prompt = buildAgentPrompt({ instance_id: "local001", question: "Original question?" });
  assert.match(prompt, /^Original question\?/);
  assert.match(prompt, /local001\.csv/);
  assert.match(prompt, /Before the first database query, derive a compact answer contract/);
  assert.match(prompt, /Do not invent thresholds, defaults, date baselines, or unit conversions/);
  assert.match(prompt, /purpose=reconciliation/);
  assert.match(prompt, /purpose=verification/);
  assert.match(prompt, /only the minimal final result needed to answer the question/);
  assert.match(prompt, /Declare the exact expected_columns and expected_rows/);
  assert.match(prompt, /Do not export intermediate data, diagnostic columns, candidate rows, or a complete ranking unless the question explicitly requests them/);
  assert.equal([...prompt.slice("Original question?".length)].every((char) => char.charCodeAt(0) < 128), true);
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
  assert.equal(guardrails.requireJoinReconciliation, true);
  assert.deepEqual(guardrails.taskProgress(), { turnCount: 7, maxTurns: 20 });
  turnCount = 12;
  assert.deepEqual(guardrails.taskProgress(), { turnCount: 12, maxTurns: 20 });
  assert.equal(buildEvaluationGuardrails({ requireJoinReconciliation: false }, () => 0).requireJoinReconciliation, false);
});

test("delivery follow-up runs once only for validated non-exploratory results without export", () => {
  const finalQuery = { toolCallId: "q", toolName: "query_database", finishedAt: 1, isError: false, result: { details: { exploratory: false } } };
  assert.equal(needsDeliveryFollowUp([finalQuery], 7, 20), true);
  assert.equal(needsDeliveryFollowUp([{ ...finalQuery, result: { details: { exploratory: true } } }], 7, 20), false);
  assert.equal(needsDeliveryFollowUp([{ ...finalQuery, result: { details: { purpose: "reconciliation" } } }], 7, 20), false);
  assert.equal(needsDeliveryFollowUp([{ ...finalQuery, result: { details: { purpose: "verification" } } }], 7, 20), false);
  assert.equal(needsDeliveryFollowUp([finalQuery, { toolCallId: "e", toolName: "export_query", finishedAt: 2, isError: false }], 7, 20), false);
  assert.equal(needsDeliveryFollowUp([finalQuery], 20, 20), false);
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
