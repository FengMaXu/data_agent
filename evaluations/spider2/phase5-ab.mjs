#!/usr/bin/env node
import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_CONTROL = "C:/data-agent-eval/runs/round11-paired-040-control";
const DEFAULT_TREATMENT = "C:/data-agent-eval/runs/round11-paired-040-hooks";
const DEFAULT_SPEC_REPORT = "docs/Spider2题面Spec提取质量-135题-槽位基线.json";
const DEFAULT_OUTPUT = "docs/Spider2七槽位Phase5同配置AB评估.json";
const DEFAULT_MARKDOWN = "docs/Spider2七槽位Phase5同配置AB评估.md";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function exists(filePath) {
  try { await access(filePath); return true; } catch { return false; }
}

function withoutRunIdentity(manifest) {
  const assurance = manifest.assurance ?? {};
  const hooks = assurance.hooks ?? {};
  const detectors = assurance.detectors ?? {};
  return {
    datasetSha256: manifest.datasetSha256,
    spider2Commit: manifest.spider2Commit,
    evaluatorSha256: manifest.evaluatorSha256,
    systemPromptSha256: manifest.systemPromptSha256,
    model: manifest.model,
    limits: manifest.limits,
    concurrency: manifest.concurrency,
    assurance: {
      ...assurance,
      arm: undefined,
      fewshot: undefined,
      hooks: { ...hooks, interpretationsOnAnomaly: undefined },
      detectors: { ...detectors, enabled: undefined },
    },
  };
}

async function traceMetrics(runPath, instanceIds) {
  const metrics = { queryCalls: 0, explorationQueries: 0, resultQueries: 0, unclassifiedQueries: 0, explorationArtifacts: 0, resultArtifacts: 0, traceFiles: 0, missingTraceFiles: 0 };
  for (const instanceId of instanceIds) {
    try {
      const trace = await readJson(path.join(runPath, "cases", String(instanceId), "trace.json"));
      metrics.traceFiles += 1;
      for (const call of trace.toolCalls ?? []) {
        if (call.toolName !== "query_database") continue;
        metrics.queryCalls += 1;
        const args = call.args ?? {};
        const details = call.result?.details ?? {};
        const exploration = args.mode === "exploration" || details.artifactKind === "exploration";
        const result = args.mode === "result" || details.artifactKind === "result_candidate";
        if (exploration) metrics.explorationQueries += 1;
        else if (result) metrics.resultQueries += 1;
        else metrics.unclassifiedQueries += 1;
        if (details.artifactKind === "exploration") metrics.explorationArtifacts += 1;
        if (details.artifactKind === "result_candidate") metrics.resultArtifacts += 1;
      }
    } catch {
      metrics.missingTraceFiles += 1;
    }
  }
  return metrics;
}

function summaryMetrics(summary, official, trace) {
  const fixed = official?.execResult?.fixedDenominator ?? official?.sql?.fixedDenominator;
  const publicationStatuses = summary.publicationStatuses ?? {};
  const published = Object.entries(publicationStatuses)
    .filter(([status]) => status === "published_approved" || status === "published_with_disagreement")
    .reduce((total, [, count]) => total + Number(count), 0);
  return {
    total: summary.total,
    sqlCoverage: summary.sqlCoverage,
    csvCoverage: summary.csvCoverage,
    published,
    publicationStatuses,
    averageDurationMs: summary.averageDurationMs,
    averageToolCalls: summary.averageToolCalls,
    anomalyCount: summary.anomalyCount ?? 0,
    interpretationHookCount: summary.interpretationHookCount ?? 0,
    interpretationBudgetSkipCount: summary.interpretationBudgetSkipCount ?? 0,
    trace,
    officialFixedDenominator: fixed ? {
      score: fixed.score,
      correct: fixed.correct,
      total: fixed.total,
      missingSubmissions: fixed.missingSubmissions,
    } : null,
  };
}

function caseScores(official) {
  return official?.execResult?.caseScores ?? official?.sql?.caseScores ?? {};
}

function compareCaseScores(control, treatment) {
  const ids = [...new Set([...Object.keys(control), ...Object.keys(treatment)])].sort();
  const improved = [];
  const regressed = [];
  const unchanged = [];
  for (const id of ids) {
    const left = Number(control[id] ?? 0);
    const right = Number(treatment[id] ?? 0);
    if (right > left) improved.push(id);
    else if (right < left) regressed.push(id);
    else unchanged.push(id);
  }
  return { improved, regressed, unchanged };
}

function percent(value) {
  return value === null || value === undefined ? "—" : `${(Number(value) * 100).toFixed(2)}%`;
}

function renderMarkdown(report) {
  const c = report.arms.control.metrics;
  const t = report.arms.treatment.metrics;
  const comparison = report.comparison;
  const rows = [
    ["固定分母官方 EX", c.officialFixedDenominator?.score, t.officialFixedDenominator?.score, true],
    ["SQL 覆盖", c.sqlCoverage, t.sqlCoverage, true],
    ["CSV 覆盖", c.csvCoverage, t.csvCoverage, true],
    ["平均工具调用", c.averageToolCalls, t.averageToolCalls, false],
    ["平均耗时（毫秒）", c.averageDurationMs, t.averageDurationMs, false],
    ["异常数", c.anomalyCount, t.anomalyCount, false],
    ["解释 Hook 注入数", c.interpretationHookCount, t.interpretationHookCount, false],
    ["预算跳过数", c.interpretationBudgetSkipCount, t.interpretationBudgetSkipCount, false],
    ["探索查询数（用途已标注）", c.trace.explorationQueries, t.trace.explorationQueries, false],
    ["结果查询数（用途已标注）", c.trace.resultQueries, t.trace.resultQueries, false],
    ["用途未标注查询数", c.trace.unclassifiedQueries, t.trace.unclassifiedQueries, false],
    ["缺失 Trace 文件数", c.trace.missingTraceFiles, t.trace.missingTraceFiles, false],
  ].map(([label, left, right, isRate]) => `| ${label} | ${isRate ? percent(left) : left ?? "—"} | ${isRate ? percent(right) : right ?? "—"} |`).join("\n");
  return [
    "# Spider2 七槽位 Phase 5 同配置 A/B 评估",
    "",
    `生成时间：${report.generatedAt}`,
    "",
    `- control：${report.arms.control.runPath}`,
    `- treatment：${report.arms.treatment.runPath}`,
    `- 同数据集/模型/预算/题目：${report.comparison.sameExperimentalInputs ? "是" : "否"}`,
    `- 仅预期开关不同：${report.comparison.onlyExpectedDifferences ? "是" : "否"}`,
    `- SQL 用途路由证据完整：${report.comparison.routingEvidenceComplete ? "是" : "否"}`,
    "",
    "## 1. 指标",
    "",
    "| 指标 | control | treatment |",
    "|---|---:|---:|",
    rows,
    "",
    "## 2. 135 题七槽位离线指标",
    "",
    report.specQuality ? [
      "| 槽位 | Coverage | Precision | Recall | 错配率 | 过度约束率 |",
      "|---|---:|---:|---:|---:|---:|",
      ...Object.entries(report.specQuality.facets).map(([facet, metric]) => `| ${facet} | ${percent(metric.coverage)} | ${percent(metric.precision)} | ${percent(metric.recall)} | ${percent(metric.mismatchRate)} | ${percent(metric.overConstraintRate)} |`),
      report.specQuality.outputColumns
        ? `| output.columns | ${percent(report.specQuality.outputColumns.coverage)} | ${percent(report.specQuality.outputColumns.precision)} | ${percent(report.specQuality.outputColumns.recall)} | ${percent(report.specQuality.outputColumns.mismatchRate)} | ${percent(report.specQuality.outputColumns.overConstraintRate)} |`
        : "| output.columns | — | — | — | — | — |", 
    ].join("\n") : "未加载 135 题槽位报告。",
    "",
    "## 3. 逐题分数变化",
    "", 
    `- 提升：${comparison.caseScoreDelta.improved.length} 题（${comparison.caseScoreDelta.improved.join(", ") || "无"}）`,
    `- 回退：${comparison.caseScoreDelta.regressed.length} 题（${comparison.caseScoreDelta.regressed.join(", ") || "无"}）`,
    `- 不变：${comparison.caseScoreDelta.unchanged.length} 题`,
    "",
    "## 4. 方案验收判断",
    "",
    `- 完整性：${report.comparison.sameExperimentalInputs && report.comparison.onlyExpectedDifferences ? "通过" : "不通过"}`,
    `- SQL 用途路由证据完整：${report.comparison.routingEvidenceComplete ? "通过" : "不通过（旧运行未记录显式 mode）"}`,
    `- 发布覆盖不下降：${report.comparison.csvCoverageNonDecreasing ? "通过" : "不通过"}`,
    `- 固定分母准确率不下降：${report.comparison.accuracyNonDecreasing ? "通过" : "不通过"}`,
    `- 成本不增加一项仅作观测：平均工具调用变化 ${(Number(t.averageToolCalls ?? 0) - Number(c.averageToolCalls ?? 0)).toFixed(2)}`,
    "",
    "## 5. 结论",
    "",
    `本 A/B 的实验完整性${report.comparison.sameExperimentalInputs && report.comparison.onlyExpectedDifferences && report.comparison.routingEvidenceComplete ? "通过" : "不完全"}。按照方案的效果判断，当前 treatment ${report.comparison.accuracyNonDecreasing && report.comparison.csvCoverageNonDecreasing ? "可继续推进" : "不应作为默认策略推广"}；保留逐题结果和失败原因，下一轮应先用当前 HEAD 记录显式 SQL mode 后重跑，并分析回退题。`,
    "",
    "> 该 A/B 使用仓库外已完成的 40 题同配置运行作为可复核基线；它不是对 135 题重新调用模型的替代。若要获得当前 HEAD 的 135 题端到端效果，需提供模型凭据后按同一 Manifest 规则重跑 control/treatment。",
    "",
  ].join("\n");
}

export async function buildPhase5Report(controlPath, treatmentPath, specReportPath) {
  const [controlManifest, treatmentManifest, controlSummary, treatmentSummary] = await Promise.all([
    readJson(path.join(controlPath, "manifest.json")),
    readJson(path.join(treatmentPath, "manifest.json")),
    readJson(path.join(controlPath, "summary.json")),
    readJson(path.join(treatmentPath, "summary.json")),
  ]);
  const [controlOfficial, treatmentOfficial, specReport] = await Promise.all([
    exists(path.join(controlPath, "official_score", "summary.json")) ? readJson(path.join(controlPath, "official_score", "summary.json")) : undefined,
    exists(path.join(treatmentPath, "official_score", "summary.json")) ? readJson(path.join(treatmentPath, "official_score", "summary.json")) : undefined,
    exists(specReportPath) ? readJson(specReportPath) : undefined,
  ]);
  const controlIds = [...(controlManifest.instanceIds ?? [])].map(String).sort();
  const treatmentIds = [...(treatmentManifest.instanceIds ?? [])].map(String).sort();
  const sameExperimentalInputs = JSON.stringify(withoutRunIdentity(controlManifest)) === JSON.stringify(withoutRunIdentity(treatmentManifest))
    && JSON.stringify(controlIds) === JSON.stringify(treatmentIds)
    && controlManifest.datasetSha256 === treatmentManifest.datasetSha256;
  const controlAssurance = controlManifest.assurance ?? {};
  const treatmentAssurance = treatmentManifest.assurance ?? {};
  const onlyExpectedDifferences = controlAssurance.detectors?.enabled === false
    && treatmentAssurance.detectors?.enabled === true
    && controlAssurance.hooks?.interpretationsOnAnomaly === false
    && treatmentAssurance.hooks?.interpretationsOnAnomaly === true
    && controlAssurance.hooks?.integrityBlocks === treatmentAssurance.hooks?.integrityBlocks
    && controlAssurance.hooks?.terminateAfterExport === treatmentAssurance.hooks?.terminateAfterExport;
  const [controlTrace, treatmentTrace] = await Promise.all([
    traceMetrics(controlPath, controlIds),
    traceMetrics(treatmentPath, treatmentIds),
  ]);
  const controlMetrics = summaryMetrics(controlSummary, controlOfficial, controlTrace);
  const treatmentMetrics = summaryMetrics(treatmentSummary, treatmentOfficial, treatmentTrace);
  const controlAccuracy = controlMetrics.officialFixedDenominator?.score;
  const treatmentAccuracy = treatmentMetrics.officialFixedDenominator?.score;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    methodology: {
      offlineSpecReport: specReportPath,
      offlineSpecReportSha256: specReport ? sha256(await readFile(specReportPath)) : null,
      experimentalUnit: "同一 40 个 SQLite instance_id；control 与 treatment 使用同一模型、数据集、预算和评测器，仅切换 detectors.enabled 与 interpretationsOnAnomaly",
      correctnessSource: "官方 exec_result fixedDenominator；未提交题目计入固定分母",
    },
    specQuality: specReport?.aggregate?.sevenFacetSlots
      ? { ...specReport.aggregate.sevenFacetSlots, outputColumns: specReport.aggregate.slots?.outputColumns ?? null }
      : null,
    arms: {
      control: { runPath: controlPath, manifestSha256: sha256(await readFile(path.join(controlPath, "manifest.json"))), metrics: controlMetrics },
      treatment: { runPath: treatmentPath, manifestSha256: sha256(await readFile(path.join(treatmentPath, "manifest.json"))), metrics: treatmentMetrics },
    },
    comparison: {
      sameExperimentalInputs,
      onlyExpectedDifferences,
      sameInstanceCount: controlIds.length === treatmentIds.length,
      csvCoverageNonDecreasing: Number(treatmentMetrics.csvCoverage ?? 0) >= Number(controlMetrics.csvCoverage ?? 0),
      accuracyNonDecreasing: controlAccuracy !== null && controlAccuracy !== undefined && treatmentAccuracy !== null && treatmentAccuracy !== undefined
        ? treatmentAccuracy >= controlAccuracy
        : null,
      routingEvidenceComplete: controlMetrics.trace.missingTraceFiles === 0 && treatmentMetrics.trace.missingTraceFiles === 0
        && controlMetrics.trace.unclassifiedQueries === 0 && treatmentMetrics.trace.unclassifiedQueries === 0,
      caseScoreDelta: compareCaseScores(caseScores(controlOfficial), caseScores(treatmentOfficial)),
    },
  };
  return { json: report, markdown: renderMarkdown(report) };
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) throw new Error(`UNEXPECTED_ARGUMENT:${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_m, letter) => letter.toUpperCase());
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) options[key] = true;
    else { options[key] = value; i += 1; }
  }
  return options;
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const options = parseArgs(process.argv.slice(2));
  const control = path.resolve(options.control ?? DEFAULT_CONTROL);
  const treatment = path.resolve(options.treatment ?? DEFAULT_TREATMENT);
  const specReport = path.resolve(options.specReport ?? DEFAULT_SPEC_REPORT);
  const output = path.resolve(options.output ?? DEFAULT_OUTPUT);
  const markdown = path.resolve(options.markdown ?? DEFAULT_MARKDOWN);
  const result = await buildPhase5Report(control, treatment, specReport);
  await writeFile(output, `${JSON.stringify(result.json, null, 2)}\n`, "utf8");
  await writeFile(markdown, result.markdown, "utf8");
  console.log(JSON.stringify({ output, markdown, ...result.json.comparison }, null, 2));
}
