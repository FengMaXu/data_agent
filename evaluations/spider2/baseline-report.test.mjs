import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildBaselineReport } from "./baseline-report.mjs";

function publishedStatus(status) {
  return status === "published_approved" || status === "published_with_disagreement";
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "spider-baseline-"));
  await mkdir(path.join(root, "official_score"), { recursive: true });
  await writeFile(path.join(root, "manifest.json"), JSON.stringify({ runId: "fixture", instanceIds: ["b", "a", "c"], agentCommit: "a".repeat(40), spider2Commit: "b".repeat(40), datasetSha256: "c".repeat(64), evaluatorSha256: "d".repeat(64), systemPromptSha256: "e".repeat(64) }));
  await writeFile(path.join(root, "summary.json"), JSON.stringify({ sqlCoverage: 2 / 3, csvCoverage: 2 / 3 }));
  await writeFile(path.join(root, "official_score", "summary.json"), JSON.stringify({ execResult: { score: 0.5, correct: 1, total: 2, caseScores: { a: 1, b: 0 }, fixedDenominator: { score: 1 / 3, correct: 1, total: 3, submittedTotal: 2, missingSubmissions: 1 } } }));
  for (const [id, publicationStatus] of [["a", "published_approved"], ["b", "published_with_disagreement"], ["c", "not_published_no_export"]]) {
    await mkdir(path.join(root, "cases", id), { recursive: true });
    const queryArtifactId = `artifact-${id}`;
    const toolCallId = `call-${id}`;
    await writeFile(path.join(root, "cases", id, "result.json"), JSON.stringify({ instanceId: id, publicationStatus, finalSql: { queryArtifactId, toolCallId } }));
    const receipt = publishedStatus(publicationStatus) ? { receiptId: `receipt-${id}`, queryArtifactId, status: publicationStatus } : undefined;
    await writeFile(path.join(root, "cases", id, "trace.json"), JSON.stringify({ toolCalls: [{ toolCallId, toolName: "export_query", args: { queryArtifactId }, result: { details: { queryArtifactId, taskComplete: publishedStatus(publicationStatus), ...(receipt ? { publicationReceipt: receipt } : {}) } } }] }));
  }
  return root;
}

test("buildBaselineReport emits explicit Delivered and Correct sets on the manifest denominator", async () => {
  const report = await buildBaselineReport(await fixture());
  assert.deepEqual(report.denominator, ["a", "b", "c"]);
  assert.deepEqual(report.deliveredSet, ["a", "b"]);
  assert.deepEqual(report.correctSet, ["a"]);
  assert.deepEqual(report.deliveredAndCorrectSet, ["a"]);
  assert.deepEqual(report.deliveredButIncorrectSet, ["b"]);
  assert.deepEqual(report.notDeliveredSet, ["c"]);
  assert.equal(report.metrics.fixedDenominatorScore, 1 / 3);
});

test("buildBaselineReport accepts the current opaque candidate delivery handle and rejects mixed handles", async () => {
  const root = await fixture();
  const tracePath = path.join(root, "cases", "b", "trace.json");
  const trace = JSON.parse(await readFile(tracePath, "utf8"));
  trace.toolCalls[0].args = { candidateId: "artifact-b" };
  await writeFile(tracePath, JSON.stringify(trace));
  assert.ok((await buildBaselineReport(root)).deliveredSet.includes("b"));
  trace.toolCalls[0].args.queryArtifactId = "artifact-b";
  await writeFile(tracePath, JSON.stringify(trace));
  assert.ok(!(await buildBaselineReport(root)).deliveredSet.includes("b"));
});

test("buildBaselineReport accepts a combined query delivery with an exact Receipt", async () => {
  const root = await fixture();
  const tracePath = path.join(root, "cases", "a", "trace.json");
  await writeFile(tracePath, JSON.stringify({ toolCalls: [{ toolCallId: "call-a", toolName: "query_database", args: { sql: "select 1", mode: "result", deliverIfEligible: true }, result: { details: { queryArtifactId: "artifact-a", taskComplete: true, publicationReceipt: { receiptId: "receipt-a", queryArtifactId: "artifact-a", status: "published_approved" } } } }] }));
  assert.ok((await buildBaselineReport(root)).deliveredSet.includes("a"));
});

test("buildBaselineReport does not count a status-only publication without an exact Receipt", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "cases", "b", "trace.json"), JSON.stringify({ toolCalls: [] }));
  const report = await buildBaselineReport(root);
  assert.deepEqual(report.deliveredSet, ["a"]);
});

test("buildBaselineReport rejects a publication without exact successful call linkage", async () => {
  const root = await fixture();
  for (const mutation of [
    { args: { queryArtifactId: "wrong" } },
    { args: { queryArtifactId: "artifact-a" }, isError: true },
    { args: { queryArtifactId: "artifact-a" }, result: { details: { queryArtifactId: "artifact-a", taskComplete: false, publicationReceipt: { receiptId: "receipt-a", queryArtifactId: "artifact-a", status: "published_approved" } } } },
  ]) {
    const tracePath = path.join(root, "cases", "a", "trace.json");
    const trace = JSON.parse(await readFile(tracePath, "utf8"));
    trace.toolCalls[0] = { ...trace.toolCalls[0], ...mutation };
    await writeFile(tracePath, JSON.stringify(trace));
    const report = await buildBaselineReport(root);
    assert.ok(!report.deliveredSet.includes("a"));
    await writeFile(tracePath, JSON.stringify({
      toolCalls: [{
        toolCallId: "call-a",
        toolName: "export_query",
        args: { queryArtifactId: "artifact-a" },
        result: { details: { queryArtifactId: "artifact-a", taskComplete: true, publicationReceipt: { receiptId: "receipt-a", queryArtifactId: "artifact-a", status: "published_approved" } } },
      }],
    }));
  }
});

test("buildBaselineReport rejects contradictory official score aggregates", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "official_score", "summary.json"), JSON.stringify({ execResult: { score: 0, correct: 0, total: 2, caseScores: { a: 1, b: 0 }, fixedDenominator: { score: 1 / 3, correct: 1, total: 3, submittedTotal: 2, missingSubmissions: 1 } } }));
  await assert.rejects(() => buildBaselineReport(root), /BASELINE_OFFICIAL_SCORE_INCONSISTENT/);
});

test("buildBaselineReport rejects missing manifest identities and invalid case scores", async () => {
  const missingIdentity = await fixture();
  const manifestPath = path.join(missingIdentity, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  delete manifest.systemPromptSha256;
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(() => buildBaselineReport(missingIdentity), /BASELINE_SYSTEM_PROMPT_SHA256_INVALID/);

  const invalidScores = await fixture();
  await writeFile(path.join(invalidScores, "official_score", "summary.json"), JSON.stringify({ execResult: { score: 1, correct: 1, total: 1, caseScores: { unknown: 1 }, fixedDenominator: { score: 0, correct: 0, total: 3, submittedTotal: 1, missingSubmissions: 2 } } }));
  await assert.rejects(() => buildBaselineReport(invalidScores), /BASELINE_OFFICIAL_CASE_SCORES_INVALID/);
});

test("buildBaselineReport rejects coerced case scores and missing official aggregates", async () => {
  const coerced = await fixture();
  await writeFile(path.join(coerced, "official_score", "summary.json"), JSON.stringify({ execResult: { score: 0.5, correct: 1, total: 2, caseScores: { a: "1", b: 0 }, fixedDenominator: { score: 1 / 3, correct: 1, total: 3, submittedTotal: 2, missingSubmissions: 1 } } }));
  await assert.rejects(() => buildBaselineReport(coerced), /BASELINE_OFFICIAL_CASE_SCORES_INVALID/);

  const missing = await fixture();
  await writeFile(path.join(missing, "official_score", "summary.json"), JSON.stringify({ execResult: { correct: 1, total: 2, caseScores: { a: 1, b: 0 }, fixedDenominator: { score: 1 / 3, correct: 1, total: 3 } } }));
  await assert.rejects(() => buildBaselineReport(missing), /BASELINE_OFFICIAL_AGGREGATES_REQUIRED/);
});

test("buildBaselineReport rejects an official score whose denominator differs from the frozen manifest", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "official_score", "summary.json"), JSON.stringify({ execResult: { score: 0, correct: 0, total: 0, caseScores: {}, fixedDenominator: { score: 0, correct: 0, total: 2, submittedTotal: 0, missingSubmissions: 3 } } }));
  await assert.rejects(() => buildBaselineReport(root), /BASELINE_FIXED_DENOMINATOR_MISMATCH/);
});
