#!/usr/bin/env node
import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function exists(filePath) {
  try { await access(filePath); return true; } catch { return false; }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function published(status) {
  return status === "published_approved" || status === "published_with_disagreement";
}

function validHex(value, length) {
  return typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`, "i").test(value);
}

function assertManifestIdentity(manifest) {
  if (!validHex(manifest.agentCommit, 40)) throw new Error("BASELINE_AGENT_COMMIT_INVALID");
  if (!validHex(manifest.spider2Commit, 40)) throw new Error("BASELINE_SPIDER2_COMMIT_INVALID");
  for (const field of ["datasetSha256", "evaluatorSha256", "systemPromptSha256"]) {
    if (!validHex(manifest[field], 64)) throw new Error(`BASELINE_${field.replace(/([A-Z])/g, "_$1").toUpperCase()}_INVALID`);
  }
}

function exactPublication(result, trace) {
  if (!published(result.publicationStatus) || !result.finalSql?.queryArtifactId || !result.finalSql?.toolCallId) return false;
  const call = (trace.toolCalls ?? []).find((item) => item.toolCallId === result.finalSql.toolCallId);
  const receipt = call?.result?.details?.publicationReceipt;
  const combinedDelivery = call?.toolName === "query_database" && call?.args?.deliverIfEligible === true;
  const deliveryHandle = combinedDelivery ? call?.result?.details?.queryArtifactId : call?.args?.candidateId ?? call?.args?.queryArtifactId;
  const mixedHandles = call?.args?.candidateId !== undefined && call?.args?.queryArtifactId !== undefined;
  return Boolean(call
    && (call.toolName === "export_query" || call.toolName === "publish_query_result" || combinedDelivery)
    && call.isError !== true
    && !mixedHandles
    && deliveryHandle === result.finalSql.queryArtifactId
    && call.result?.details?.taskComplete === true
    && receipt
    && receipt.queryArtifactId === result.finalSql.queryArtifactId
    && call.result?.details?.queryArtifactId === receipt.queryArtifactId
    && receipt.status === result.publicationStatus
    && typeof receipt.receiptId === "string" && receipt.receiptId.length > 0);
}

function sorted(values) {
  return [...values].map(String).sort();
}

export async function buildBaselineReport(runPath) {
  const manifestPath = path.join(runPath, "manifest.json");
  const summaryPath = path.join(runPath, "summary.json");
  const officialPath = path.join(runPath, "official_score", "summary.json");
  const manifest = await readJson(manifestPath);
  const summary = await readJson(summaryPath);
  const official = await readJson(officialPath);
  const instanceIds = sorted(manifest.instanceIds ?? []);
  if (!instanceIds.length) throw new Error("BASELINE_INSTANCE_IDS_REQUIRED");
  assertManifestIdentity(manifest);

  const delivered = [];
  const missingCaseResults = [];
  const publicationByCase = {};
  for (const instanceId of instanceIds) {
    const resultPath = path.join(runPath, "cases", instanceId, "result.json");
    if (!await exists(resultPath)) {
      missingCaseResults.push(instanceId);
      continue;
    }
    const result = await readJson(resultPath);
    publicationByCase[instanceId] = result.publicationStatus ?? null;
    const tracePath = path.join(runPath, "cases", instanceId, "trace.json");
    if (await exists(tracePath) && exactPublication(result, await readJson(tracePath))) delivered.push(instanceId);
  }

  const scoreSection = official.execResult ?? official.sql;
  if (!scoreSection) throw new Error("BASELINE_OFFICIAL_SCORE_REQUIRED");
  const fixed = scoreSection.fixedDenominator;
  const requiredNumbers = [scoreSection.score, scoreSection.correct, scoreSection.total, fixed?.score, fixed?.correct, fixed?.total, fixed?.submittedTotal, fixed?.missingSubmissions];
  if (requiredNumbers.some((value) => typeof value !== "number" || !Number.isFinite(value))) throw new Error("BASELINE_OFFICIAL_AGGREGATES_REQUIRED");
  if (fixed.total !== instanceIds.length) throw new Error("BASELINE_FIXED_DENOMINATOR_MISMATCH");
  const scoreEntries = Object.entries(scoreSection.caseScores ?? {});
  if (scoreEntries.some(([id, value]) => !instanceIds.includes(id) || (value !== 0 && value !== 1))) {
    throw new Error("BASELINE_OFFICIAL_CASE_SCORES_INVALID");
  }
  const submittedIds = scoreEntries.map(([id]) => id);
  const submittedCorrect = scoreEntries.filter(([, value]) => value === 1).length;
  const correct = instanceIds.filter((id) => scoreSection.caseScores?.[id] === 1);
  const expectedMissing = instanceIds.length - submittedIds.length;
  if (scoreSection.correct !== submittedCorrect
    || scoreSection.total !== submittedIds.length
    || Math.abs(scoreSection.score - (submittedIds.length ? submittedCorrect / submittedIds.length : 0)) > 1e-12
    || correct.length !== fixed.correct
    || Math.abs(fixed.score - correct.length / instanceIds.length) > 1e-12
    || fixed.submittedTotal !== submittedIds.length
    || fixed.missingSubmissions !== expectedMissing) {
    throw new Error("BASELINE_OFFICIAL_SCORE_INCONSISTENT");
  }
  const deliveredSet = new Set(delivered);
  const correctSet = new Set(correct);

  return {
    schemaId: "spider2.baseline-report",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runPath,
    runId: manifest.runId ?? path.basename(runPath),
    identities: {
      agentCommit: manifest.agentCommit ?? null,
      spider2Commit: manifest.spider2Commit ?? null,
      datasetSha256: manifest.datasetSha256 ?? null,
      evaluatorSha256: manifest.evaluatorSha256 ?? null,
      systemPromptSha256: manifest.systemPromptSha256 ?? null,
      manifestSha256: sha256(await readFile(manifestPath)),
    },
    denominator: instanceIds,
    deliveredSet: sorted(deliveredSet),
    correctSet: sorted(correctSet),
    deliveredAndCorrectSet: sorted(correct.filter((id) => deliveredSet.has(id))),
    deliveredButIncorrectSet: sorted(delivered.filter((id) => !correctSet.has(id))),
    notDeliveredSet: sorted(instanceIds.filter((id) => !deliveredSet.has(id))),
    missingCaseResults: sorted(missingCaseResults),
    publicationByCase,
    metrics: {
      total: instanceIds.length,
      delivered: deliveredSet.size,
      correct: correctSet.size,
      deliveredCoverage: deliveredSet.size / instanceIds.length,
      fixedDenominatorScore: Number(fixed.score),
      missingSubmissions: Number(fixed.missingSubmissions ?? instanceIds.length - Number(fixed.submittedTotal ?? 0)),
      summarySqlCoverage: summary.sqlCoverage ?? null,
      summaryCsvCoverage: summary.csvCoverage ?? null,
    },
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`UNEXPECTED_ARGUMENT:${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) options[key] = true;
    else { options[key] = value; index += 1; }
  }
  return options;
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node evaluations/spider2/baseline-report.mjs --run <completed-run-dir> [--output <report.json>]");
  } else {
    if (typeof options.run !== "string") throw new Error("BASELINE_RUN_PATH_REQUIRED");
    const runPath = path.resolve(options.run);
    const report = await buildBaselineReport(runPath);
    if (typeof options.output === "string") await writeFile(path.resolve(options.output), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    else console.log(JSON.stringify(report, null, 2));
  }
}
