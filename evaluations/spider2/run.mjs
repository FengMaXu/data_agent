#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, appendFile, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
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
  loadCases,
  parseCorrectIdsCsv,
  parseOfficialCaseScores,
  parseOfficialScore,
  publishedCsvPath,
  resolveExternalKnowledge,
  resolveLocalDatabase,
  resolveMetadataDirectory,
  runPromptWithTimeout,
  safeJson,
  selectCases,
  selectFinalSql,
  selectModelProfile,
  sha256File,
  sha256Tree,
  validateOfficialEvaluatorSource,
} from "./lib.mjs";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../..");
const localConfigPath = path.join(here, "config.local.json");
const exampleConfigPath = path.join(here, "config.example.json");

process.on("unhandledRejection", (reason) => {
  if (
    reason?.name === "HarnessClosed" ||
    reason?.name === "Closed" ||
    reason?.message?.includes("AgentHarness was closed") ||
    reason?.message?.includes("HarnessClosed") ||
    reason?.message?.includes("transport closed")
  ) {
    return;
  }
  console.error("Unhandled rejection:", reason instanceof Error ? reason.stack ?? reason.message : String(reason));
});

function parseArgs(argv) {
  const [command = "preflight", ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (!item.startsWith("--")) throw new Error(`UNEXPECTED_ARGUMENT:${item}`);
    const key = item.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) options[key] = true;
    else { options[key] = next; index += 1; }
  }
  return { command, options };
}

async function exists(target) {
  try { await access(target); return true; } catch { return false; }
}

async function loadEnvironmentFile(filePath) {
  if (!(await exists(filePath))) return;
  const content = await readFile(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

function expandEnvironment(value) {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_match, name) => process.env[name] ?? "");
  }
  if (Array.isArray(value)) return value.map(expandEnvironment);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expandEnvironment(item)]));
  return value;
}

async function loadConfig(explicitPath) {
  const selected = explicitPath
    ? path.resolve(explicitPath)
    : await exists(localConfigPath) ? localConfigPath : exampleConfigPath;
  const config = expandEnvironment(JSON.parse(await readFile(selected, "utf8")));
  config.__path = selected;
  config.spider2Repo = path.resolve(config.spider2Repo);
  config.runsRoot = path.resolve(config.runsRoot);
  config.spider2LiteRoot = path.resolve(config.spider2LiteRoot ?? path.join(config.spider2Repo, "spider2-lite"));
  config.datasetPath = path.join(config.spider2LiteRoot, "spider2-lite.jsonl");
  config.evaluationSuite = path.join(config.spider2LiteRoot, "evaluation_suite");
  config.limits = {
    timeoutMs: null,
    maxTurns: null,
    maxToolCalls: null,
    maxExploratoryQueries: null,
    ...(config.limits ?? {}),
  };
  config.concurrency = Math.max(1, Number(config.concurrency ?? 3));
  config.assurance = {
    mode: "off",
    reviewerModel: "none",
    reviewerPromptVersion: "5",
    reviewPolicyVersion: "2",
    reviewCoverageSchemaVersion: "4",
    planner: true,
    reviewer: { enabled: false },
    shadowDelivery: "publish_with_disagreement",
    hooks: {
      informOnQuery: true,
      informOnUnresolvedHypotheses: false,
      interpretationsOnAnomaly: true,
      integrityBlocks: true,
      terminateAfterExport: true,
    },
    detectors: {
      enabled: true,
      tierA: DEFAULT_TIER_A_DETECTORS,
      tierB: DEFAULT_TIER_B_DETECTORS,
      disabled: [],
    },
    interpretations: {
      triggerTiers: ["A"],
      maxCyclesPerTask: 1,
      minRemainingTurns: 6,
      minRemainingToolCalls: 10,
    },
    dirtyDataAction: "multi_candidate",
    delivery: "deliver_with_disclosure",
    includeResultRows: true,
    maxResultRows: 2000,
    maxResultBytes: 262144,
    maxNumericRows: 10000,
    ...(config.assurance ?? {}),
    // This prompt is defined in this runner/runtime version; callers cannot
    // relabel it as an older calibrated prompt.
    reviewerPromptVersion: "5",
  };
  return config;
}

const DEFAULT_TIER_A_DETECTORS = [];
const DEFAULT_TIER_B_DETECTORS = [];
const ASSURANCE_HOOK_NAMES = ["integrityBlocks", "terminateAfterExport"];

// These values are retained only as explicit offline-observer metadata. They
// never alter the Application Host or grant a Reviewer/Detector publish power.
function assuranceHookSwitches(config, options = {}) {
  const configured = config.assurance?.hooks ?? {};
  const switches = Object.fromEntries(ASSURANCE_HOOK_NAMES.map((name) => [name, configured[name] !== false]));
  if (options.disableHook !== undefined && Object.hasOwn(switches, options.disableHook)) switches[options.disableHook] = false;
  if (options.enableHook !== undefined && Object.hasOwn(switches, options.enableHook)) switches[options.enableHook] = true;
  return switches;
}

function detectorPolicyFromConfig(config) {
  const configured = config.assurance?.detectors ?? {};
  return {
    enabled: false,
    tierA: Array.isArray(configured.tierA) ? configured.tierA.map(String) : DEFAULT_TIER_A_DETECTORS,
    tierB: Array.isArray(configured.tierB) ? configured.tierB.map(String) : DEFAULT_TIER_B_DETECTORS,
    disabled: Array.isArray(configured.disabled) ? configured.disabled.map(String) : [],
  };
}

function interpretationPolicyFromConfig(config) {
  const configured = config.assurance?.interpretations ?? {};
  return {
    triggerTiers: Array.isArray(configured.triggerTiers) ? configured.triggerTiers : [],
    maxCyclesPerTask: 0,
    minRemainingTurns: 0,
    minRemainingToolCalls: 0,
    dirtyDataAction: "offline_observer",
  };
}

function profileFromConfig(config) {
  const llm = config.llm ?? {};
  const apiKey = llm.apiKey ?? (llm.apiKeyEnv ? process.env[llm.apiKeyEnv] : undefined);
  const baseUrl = llm.baseUrl ?? (llm.baseUrlEnv ? process.env[llm.baseUrlEnv] : undefined);
  return {
    provider: llm.provider ?? "openai",
    model: llm.model,
    apiKey,
    baseUrl,
    apiFormat: llm.apiFormat ?? "chat",
    reasoning: llm.reasoning,
    maxTokens: llm.maxTokens,
    thinkingLevel: llm.thinkingLevel,
    thinkingLevelMap: llm.thinkingLevelMap,
    contextWindow: llm.contextWindow,
  };
}

async function runModelCanary(config) {
  const profile = profileFromConfig(config);
  if (!["openai", "openrouter", "deepseek"].includes(profile.provider) || !profile.baseUrl || (profile.apiFormat && profile.apiFormat !== "chat")) {
    throw new Error("MODEL_CANARY_REQUIRES_OPENAI_COMPATIBLE_CHAT_API");
  }
  const startedAt = Date.now();
  const endpoint = `${profile.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${profile.apiKey}` },
      body: JSON.stringify({
        model: profile.model,
        messages: [{ role: "user", content: "Reply with OK." }],
        max_tokens: 8,
        temperature: 0,
        stream: false,
      }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    throw new Error(`PROVIDER_CANARY_FAILED:network:${error instanceof Error ? error.message : String(error)}`);
  }
  const body = await response.text();
  if (!response.ok) throw new Error(`PROVIDER_CANARY_FAILED:${response.status}:${body.slice(0, 500)}`);
  let parsed;
  try { parsed = JSON.parse(body); }
  catch { throw new Error("PROVIDER_CANARY_FAILED:invalid_json"); }
  if (!Array.isArray(parsed.choices) || parsed.choices.length === 0) throw new Error("PROVIDER_CANARY_FAILED:no_choices");
  const result = {
    ok: true,
    provider: profile.provider,
    model: profile.model,
    status: response.status,
    latencyMs: Date.now() - startedAt,
    checkedAt: new Date().toISOString(),
  };
  const target = path.join(config.runsRoot, "_preflight", "model-canary.json");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(result, null, 2), "utf8");
  return result;
}

function substitute(value, context) {
  if (typeof value !== "string") return value;
  return value.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, name) => context[name] ?? `{${name}}`);
}

async function backendExecutor(instance, config, createMcpQueryExecutor) {
  const backend = backendForCase(instance);
  if (backend === "sqlite") {
    const databasePath = await resolveLocalDatabase(config, config.spider2LiteRoot, instance);
    return {
      executor: createMcpQueryExecutor({
        command: process.execPath,
        args: [path.join(projectRoot, "apps", "server", "dist", "reference-sqlite-mcp.js"), databasePath],
        dialect: "sqlite",
        requestTimeoutMs: Number(config.limits?.mcpRequestTimeoutMs ?? 60_000),
        scopedExploration: { scopeId: `eval-${instance.instance_id}`, connectionId: `sqlite-${instance.instance_id}` },
      }),
      databasePath,
    };
  }
  const mcp = config.backends?.[backend]?.mcp;
  if (!mcp?.command) throw new Error(`BACKEND_MCP_NOT_CONFIGURED:${backend}`);
  const context = {
    db: instance.db,
    instance_id: instance.instance_id,
    spider2Repo: config.spider2Repo,
    spider2LiteRoot: config.spider2LiteRoot,
  };
  return {
    executor: createMcpQueryExecutor({
      command: substitute(mcp.command, context),
      args: (mcp.args ?? []).map((item) => substitute(item, context)),
      env: Object.fromEntries(Object.entries(mcp.env ?? {}).map(([key, value]) => [key, substitute(value, context)])),
      dialect: backend,
      connectionId: instance.instance_id,
    }),
  };
}

function withKnowledgeMetadata(content, metadata) {
  const source = String(content ?? "").replace(/^\uFEFF/, "");
  if (/^---\s*\r?\nknowledgeId:\s*/.test(source)) return source;
  return [
    "---",
    `knowledgeId: ${metadata.knowledgeId}`,
    `name: ${metadata.name}`,
    `description: ${metadata.description}`,
    "---",
    "",
    source.replace(/^\s+/, ""),
  ].join("\n");
}

async function prepareKnowledge(instance, config, caseRoot, KnowledgeIndex, WorkspaceStore) {
  const knowledgeRoot = path.join(caseRoot, "knowledge");
  const knowledgeDoc = path.join(knowledgeRoot, "doc");
  const workspaceRoot = path.join(caseRoot, "workspace");
  const workspaceDocs = path.join(workspaceRoot, "docs");
  await Promise.all([mkdir(knowledgeDoc, { recursive: true }), mkdir(workspaceDocs, { recursive: true })]);
  const [baseRules, baseSemanticGuide, baseLearning] = await Promise.all([
    readFile(path.join(projectRoot, "knowledge", "doc", "rules.md"), "utf8").catch(() => ""),
    readFile(path.join(projectRoot, "knowledge", "doc", "semantic_guide.md"), "utf8").catch(() => ""),
    readFile(path.join(projectRoot, "knowledge", "doc", "learning.md"), "utf8").catch(() => ""),
  ]);

  const metadataDir = await resolveMetadataDirectory(config.spider2LiteRoot, instance);
  const ddlPath = path.join(metadataDir, "DDL.csv");
  if (!(await exists(ddlPath))) throw new Error(`DDL_NOT_FOUND:${ddlPath}`);
  const schemaMarkdown = ddlCsvToMarkdown(await readFile(ddlPath, "utf8"), instance.db);
  await Promise.all([
    writeFile(path.join(knowledgeDoc, "db_schema.md"), withKnowledgeMetadata(schemaMarkdown, { knowledgeId: "database-schema", name: "数据库结构", description: "提供表、列、类型及正式结构信息，用于物理映射；字段存在不自动证明业务含义。" }), "utf8"),
    copyFile(ddlPath, path.join(workspaceDocs, "DDL.csv")),
  ]);

  const externalFiles = await resolveExternalKnowledge(config.spider2LiteRoot, instance);
  const businessSections = [`# External Knowledge for ${instance.instance_id}`];
  if (externalFiles.length === 0) businessSections.push("", "No task-specific external knowledge was supplied by Spider2.");
  await mkdir(path.join(workspaceDocs, "external"), { recursive: true });
  for (const source of externalFiles) {
    const name = path.basename(source);
    const content = await readFile(source, "utf8");
    businessSections.push("", `## ${name}`, "", content);
    await copyFile(source, path.join(workspaceDocs, "external", name));
  }
  await writeFile(path.join(knowledgeDoc, "business.md"), withKnowledgeMetadata(businessSections.join("\n"), { knowledgeId: "business-definitions", name: "业务定义", description: "提供业务指标、枚举、阈值和已知业务约束；内容未明确时不得用通用经验补造业务定义。" }), "utf8");
  await writeFile(path.join(knowledgeDoc, "semantic_guide.md"), withKnowledgeMetadata(baseSemanticGuide || "# Semantic Guide\n\nNo semantic guide is configured.\n", { knowledgeId: "semantic-guide", name: "数据分析语义理解指引", description: "用于拆解问题、建立七槽位，并按专题处理总体、连接权重、多级聚合、时间、排名、事件序列和状态歧义；不提供具体业务枚举。" }), "utf8");
  await writeFile(path.join(knowledgeDoc, "rules.md"), withKnowledgeMetadata(buildEvaluationRules(baseRules, instance), { knowledgeId: "sql-rules", name: "SQL 生成规范", description: "用于把当前 Answer Spec 实现为安全、符合目标方言的 SQL，包括聚合、精度、NULL 和方言规则；不负责决定业务口径。" }), "utf8");
  await writeFile(path.join(knowledgeDoc, "query_patterns.md"), withKnowledgeMetadata("# Verified Query Patterns\n\nNo benchmark-specific query patterns are provided.\n", { knowledgeId: "query-patterns", name: "已验证查询模式", description: "提供可复用的查询结构和适用前提；只有当前口径与前提匹配时才能复用。" }), "utf8");
  await writeFile(path.join(knowledgeDoc, "learning.md"), withKnowledgeMetadata(buildEvaluationLearning(baseLearning), { knowledgeId: "learning-notes", name: "历史纠错与经验", description: "提供历史错误、方言陷阱和可复用经验；证据等级低于用户、业务定义和正式 Schema。" }), "utf8");

  const knowledge = new KnowledgeIndex({ requireMetadata: true });
  await knowledge.loadDirectory(knowledgeRoot);
  return {
    knowledge,
    knowledgeRoot,
    workspace: new WorkspaceStore(workspaceRoot),
    workspaceRoot,
    metadataDir,
    externalFiles,
  };
}


async function collectArtifacts(instance, runDir, workspace, recorder) {
  const caseRoot = path.join(runDir, "cases", instance.instance_id);
  const finalSql = selectFinalSql(recorder.calls);
  const sqlDir = path.join(runDir, "submissions", "sql");
  const csvDir = path.join(runDir, "submissions", "csv");
  await Promise.all([mkdir(sqlDir, { recursive: true }), mkdir(csvDir, { recursive: true })]);
  if (finalSql) await writeFile(path.join(sqlDir, `${instance.instance_id}.sql`), `${finalSql.sql}\n`, "utf8");

  let finalCsv;
  let csvError;
  if (finalSql) {
    const relativePath = publishedCsvPath(finalSql, recorder.calls);
    const deliveryCall = recorder.calls.find((call) => call.toolCallId === finalSql.toolCallId);
    const receipt = deliveryCall?.result?.details?.receiptId && deliveryCall.result.details?.candidateId
      ? deliveryCall.result.details
      : deliveryCall?.result?.details?.publicationReceipt;
    try {
      if (receipt?.format === "csv" && typeof receipt.content === "string") {
        if (!receipt.content.length) throw new Error("CSV_EMPTY_FILE");
        finalCsv = path.join(csvDir, `${instance.instance_id}.csv`);
        await writeFile(finalCsv, receipt.content, "utf8");
      } else if (receipt?.resultRef) {
        const resultFile = path.join(caseRoot, "results", receipt.sessionId ?? `${path.basename(runDir)}-${instance.instance_id}`, `${receipt.resultRef}.json`);
        if (await exists(resultFile)) {
          const stored = JSON.parse(await readFile(resultFile, "utf8"));
          const csvText = [
            stored.columns.join(","),
            ...stored.rows.map((row) => row.map((cell) => cell === null || cell === undefined ? "" : /[",\r\n]/.test(String(cell)) ? `"${String(cell).replaceAll('"', '""')}"` : String(cell)).join(","))
          ].join("\n");
          if (!csvText.length) throw new Error("CSV_EMPTY_FILE");
          finalCsv = path.join(csvDir, `${instance.instance_id}.csv`);
          await writeFile(finalCsv, csvText, "utf8");
        } else if (relativePath) {
          const bytes = await workspace.readBytes(relativePath);
          if (bytes.byteLength === 0) throw new Error("CSV_EMPTY_FILE");
          finalCsv = path.join(csvDir, `${instance.instance_id}.csv`);
          await writeFile(finalCsv, bytes);
        } else {
          throw new Error("CSV_PATH_MISSING");
        }
      } else if (relativePath) {
        const bytes = await workspace.readBytes(relativePath);
        if (bytes.byteLength === 0) throw new Error("CSV_EMPTY_FILE");
        finalCsv = path.join(csvDir, `${instance.instance_id}.csv`);
        await writeFile(finalCsv, bytes);
      } else {
        throw new Error("CSV_PATH_MISSING");
      }
    } catch (caught) {
      // Delivery failure is recorded separately from SQL correctness.
      csvError = caught instanceof Error ? caught.message : String(caught);
    }
  }
  return { finalSql, finalCsv, csvError };
}

async function evaluationSystemPrompt(config) {
  const source = await readFile(path.join(projectRoot, ".pi", "SYSTEM.md"), "utf8");
  if (config.assurance?.fewshot !== false) return source;
  const supportedSections = [
    { start: "\n### 1.5 口径推导示范", end: "\n---\n\n## 2. 输出与交付" },
    { start: "\n#### 口径推导与 SQL 示例", end: "\n---\n\n### 4. 预览结果并导出" },
  ];
  for (const boundary of supportedSections) {
    const sectionStart = source.indexOf(boundary.start);
    const sectionEnd = source.indexOf(boundary.end, sectionStart);
    if (sectionStart >= 0 && sectionEnd >= 0) return `${source.slice(0, sectionStart)}${source.slice(sectionEnd)}`;
  }
  throw new Error("FEWSHOT_SECTION_BOUNDARY_NOT_FOUND");
}

function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function errorCodeFromToolCall(call) {
  const details = call?.result?.details && typeof call.result.details === "object" ? call.result.details : {};
  const content = Array.isArray(call?.result?.content)
    ? call.result.content.filter((item) => item && typeof item.text === "string").map((item) => item.text).join("\\n")
    : "";
  const text = [details.reason, details.error, details.code, call?.result?.error, content].filter((value) => typeof value === "string").join(" ");
  const match = text.match(/\b(?:INTEGRITY_[A-Z0-9_]+|SHAPE_ZERO_SCORE|[A-Z][A-Z0-9_]{2,})\b/);
  return match?.[0] ?? "UNKNOWN";
}

function publicationStatusFor(recorder, status) {
  const receiptStatus = recorder?.calls.map((call) => {
    const details = call.result?.details ?? {};
    const receipt = details.receiptId && details.candidateId ? details : details.publicationReceipt;
    return receipt?.status;
  }).filter(Boolean).at(-1);
  if (receiptStatus) return receiptStatus;
  const currentReceipt = recorder?.calls.some((call) => {
    const details = call.result?.details ?? {};
    return (details.receiptId && details.candidateId) || details.publicationReceipt?.receiptId;
  });
  if (currentReceipt) return "published";
  if (status === "provider_error" || recorder?.providerFailure) return "not_published_provider_error";
  const publicationCalls = recorder?.calls.filter((call) => call.toolName === "export_query" || call.toolName === "publish_query_result") ?? [];
  if (publicationCalls.length === 0) return "not_published_no_export_call";
  const last = publicationCalls.at(-1);
  const code = errorCodeFromToolCall(last);
  if (/^(?:INTEGRITY_[A-Z0-9_]+|SHAPE_ZERO_SCORE)$/.test(code)) return `not_published_integrity:${code}`;
  return `not_published_export_failed:${code}`;
}

function nativeEventFromPresentation(event) {
  const envelope = event?.type === "presentation.event" ? event.envelope : undefined;
  const semantic = envelope?.event;
  if (!semantic || typeof semantic.type !== "string") return undefined;
  const runId = event.operationId ?? envelope.runId;
  if (semantic.type === "agent.message_started") return { type: "message_start", runId, message: { role: "assistant", id: semantic.messageId } };
  if (semantic.type === "agent.text_delta") return { type: "message_update", runId, assistantMessageEvent: { type: "text_delta", delta: semantic.delta } };
  if (semantic.type === "agent.thinking_delta") return { type: "message_update", runId, assistantMessageEvent: { type: "thinking_delta", delta: semantic.delta } };
  if (semantic.type === "agent.tool_started") return { type: "tool_execution_start", runId, toolCallId: semantic.toolCallId, toolName: semantic.toolName, args: semantic.args };
  if (semantic.type === "agent.tool_finished") return { type: "tool_execution_end", runId, toolCallId: semantic.toolCallId, toolName: semantic.toolName, result: semantic.result, isError: semantic.isError === true, args: semantic.args };
  if (semantic.type === "agent.completed") return { type: "agent_end", runId, messages: [] };
  return undefined;
}

async function waitForApplicationOperation(adapter, operationId, maxWaitMs = Infinity) {
  const startedAt = Date.now();
  while (true) {
    const open = await adapter.getOpenOperations();
    if (!open.some((operation) => operation.operationId === operationId)) return;
    if (Date.now() - startedAt >= maxWaitMs) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function fanoutMetrics(calls) {
  const reports = calls.flatMap((call) => {
    const details = call.result?.details;
    const report = details && typeof details === "object" && details.fanout && typeof details.fanout === "object" ? details.fanout : undefined;
    return report ? [report] : [];
  });
  const unique = [];
  const seen = new Set();
  for (const report of reports) {
    const key = JSON.stringify(report);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(report);
  }
  const targets = unique.flatMap((report) => Array.isArray(report.targets) ? report.targets : []);
  const findings = targets.filter((target) => target?.status === "finding");
  const unknown = targets.filter((target) => target?.status === "unknown");
  const byStatus = Object.fromEntries(["clear", "finding", "not_applicable", "unknown"].map((status) => [status, unique.filter((report) => report.status === status).length]));
  return {
    reports: unique,
    reportCount: unique.length,
    targetCount: targets.length,
    findingCount: findings.length,
    unknownCount: unknown.length,
    byStatus,
    enabled: unique.length > 0,
  };
}

function specFeedbackMetrics(calls) {
  const reports = calls.flatMap((call) => {
    const details = call.result?.details;
    const report = details && typeof details === "object" && details.specFeedback && typeof details.specFeedback === "object" ? details.specFeedback : undefined;
    return report ? [report] : [];
  });
  const unique = [];
  const seen = new Set();
  for (const report of reports) {
    const key = `${report.taskId ?? ""}:${report.revisionId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(report);
  }
  const byStatus = Object.fromEntries(["pending", "completed", "unavailable", "disabled"].map((status) => [status, unique.filter((report) => report.status === status).length]));
  const deterministicIssueCount = unique.reduce((sum, report) => sum + (Array.isArray(report.deterministicIssues) ? report.deterministicIssues.length : 0), 0);
  const concernCount = unique.reduce((sum, report) => sum + (Array.isArray(report.assessment?.facets)
    ? report.assessment.facets.filter((facet) => facet.relation?.choice === "contradicted" || facet.relation?.choice === "not_established" || facet.coverage?.choice === "partial" || facet.coverage?.choice === "missing").length
    : 0), 0);
  return {
    reports: unique,
    reportCount: unique.length,
    byStatus,
    deterministicIssueCount,
    concernCount,
    enabled: unique.some((report) => report.status !== "disabled"),
  };
}

function knowledgeMetrics(calls, startedAt) {
  const knowledgeCalls = calls.filter((call) => call.toolName === "search_knowledge" || call.toolName === "read_knowledge");
  const contentRefs = knowledgeCalls.flatMap((call) => {
    const details = call.result?.details;
    if (call.toolName === "search_knowledge" && Array.isArray(details?.hits)) {
      return details.hits.map((hit) => hit?.contentRef).filter((value) => typeof value === "string");
    }
    return typeof details?.contentRef === "string" ? [details.contentRef] : [];
  });
  const firstSql = calls.find((call) => call.toolName === "query_database");
  return {
    searchCalls: knowledgeCalls.filter((call) => call.toolName === "search_knowledge").length,
    readCalls: knowledgeCalls.filter((call) => call.toolName === "read_knowledge").length,
    returnedContentRefs: contentRefs.length,
    duplicateContentRefs: contentRefs.length - new Set(contentRefs).size,
    toolDurationMs: knowledgeCalls.reduce((sum, call) => sum + Number(call.durationMs ?? 0), 0),
    firstSqlAfterMs: firstSql?.startedAt ? Math.max(0, firstSql.startedAt - startedAt) : null,
  };
}

async function createCaseRunner(config, runDir, _hookSwitches, _detectorPolicy, _interpretationPolicy, systemPrompt) {
  const runtime = await import("@data-agent/runtime");
  const protocol = await import("@data-agent/runtime/testing");
  const { createMcpQueryExecutor } = await import("../../apps/server/dist/mcp-query-executor.js");
  const profile = profileFromConfig(config);
  return async (instance) => {
    const startedAt = Date.now();
    const caseRoot = path.join(runDir, "cases", instance.instance_id);
    await mkdir(caseRoot, { recursive: true });
    let executor;
    let application;
    let harness;
    let recorder;
    let prepared;
    let status = "completed";
    let error;
    let artifacts = {};
    const observerEvents = [];
    try {
      prepared = await prepareKnowledge(instance, config, caseRoot, protocol.KnowledgeIndex, protocol.WorkspaceStore);
      const backend = await backendExecutor(instance, config, createMcpQueryExecutor);
      executor = backend.executor;
      const sessionId = path.basename(runDir) + "-" + instance.instance_id;
      const hypothesisChoiceAdvisor = process.env.TYPESAFE_API_KEY?.trim() && protocol.JevHypothesisChoiceAdvisor
        ? new protocol.JevHypothesisChoiceAdvisor({
            apiKey: process.env.TYPESAFE_API_KEY.trim(),
            model: process.env.TYPESAFE_MODEL?.trim() || "jev-1.13.0",
            ...(process.env.TYPESAFE_ENDPOINT?.trim() ? { endpoint: process.env.TYPESAFE_ENDPOINT.trim() } : {}),
          })
        : undefined;
      const specAlignmentAssessor = process.env.TYPESAFE_SPEC_ALIGNMENT === "1" && process.env.TYPESAFE_API_KEY?.trim() && protocol.JevSpecAlignmentAssessor
        ? new protocol.JevSpecAlignmentAssessor({
            apiKey: process.env.TYPESAFE_API_KEY.trim(),
            model: process.env.TYPESAFE_MODEL?.trim() || "jev-1.13.0",
            ...(process.env.TYPESAFE_ENDPOINT?.trim() ? { endpoint: process.env.TYPESAFE_ENDPOINT.trim() } : {}),
          })
        : undefined;
      application = new protocol.DataAgentSessionApplication({
        sessionRoot: path.join(runDir, "transcripts", instance.instance_id),
        workspace: prepared.workspace,
        knowledge: prepared.knowledge,
        knowledgeRoot: prepared.knowledgeRoot,
        pythonExecutable: config.pythonExecutable,
        queryExecutor: executor,
        resultRoot: path.join(caseRoot, "results"),
        profile,
        ...(hypothesisChoiceAdvisor ? { hypothesisChoiceAdvisor } : {}),
        ...(specAlignmentAssessor ? { specAlignmentAssessor } : {}),
        systemPrompt,
        systemPromptRoots: [prepared.knowledgeRoot, projectRoot],
        projectRoot,
        createMissingSessions: true,
        enableSubagents: true,
        delegationRoot: path.join(caseRoot, "subagents"),
        delegationKnowledgePaths: [
          "doc/business.md",
          "doc/db_schema.md",
          "doc/learning.md",
          "doc/query_patterns.md",
          "doc/rules.md",
          "doc/semantic_guide.md",
        ],
      });
      const adapter = application.createAgentAdapter({ userId: "evaluation", host: "web", sessionId });
      let currentOperationId;
      harness = {
        subscribe(listener) {
          return adapter.subscribe((event) => {
            const nativeEvent = nativeEventFromPresentation(event);
            if (nativeEvent) listener(nativeEvent);
          });
        },
        async prompt(text) {
          const accepted = await adapter.prompt(text, { sessionId, userId: "evaluation", requestId: sessionId + ":prompt" });
          currentOperationId = accepted.operationId;
          await waitForApplicationOperation(adapter, accepted.operationId);
          return accepted;
        },
        async abort() {
          if (currentOperationId) await adapter.requestAbort(currentOperationId, { sessionId, userId: "evaluation" });
          else await adapter.abort({ sessionId, userId: "evaluation" });
        },
        async waitForIdle(maxWaitMs = 15000) {
          if (currentOperationId) await waitForApplicationOperation(adapter, currentOperationId, maxWaitMs);
        },
      };
      recorder = createRecorder(harness, config.limits);
      await runPromptWithTimeout(harness, buildAgentPrompt(instance), config.limits.timeoutMs, recorder);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      const limitFailure = Boolean(recorder?.limitError) || message === "MAX_TURNS" || message === "MAX_TOOL_CALLS" || message === "TASK_TIMEOUT";
      const providerFailure = limitFailure ? undefined : caught?.providerFailure ?? recorder?.providerFailure ?? classifyProviderFailure(message);
      error = caught instanceof Error ? { name: caught.name, message, stack: caught.stack } : { message };
      if (providerFailure) error.provider = providerFailure;
      status = providerFailure ? "provider_error"
        : error.message === "TASK_TIMEOUT" ? "timeout"
          : error.message?.startsWith("LOCAL_DATABASE_NOT_FOUND") || error.message?.startsWith("METADATA_DIR_NOT_FOUND") || error.message?.startsWith("DDL_NOT_FOUND") || error.message?.includes("EXTERNAL_KNOWLEDGE")
            ? "resource_error" : "error";
      if (recorder && status === "error" && recorder.terminalReason !== "completed") status = recorder.terminalReason;
    } finally {
      await recorder?.waitForAbort?.().catch(() => undefined);
      await harness?.waitForIdle?.().catch(() => undefined);
      if (prepared && recorder) artifacts = await collectArtifacts(instance, runDir, prepared.workspace, recorder).catch(() => artifacts);
      recorder?.unsubscribe();
      try { await application?.close().catch(() => undefined); } catch {}
      try { await executor?.close().catch(() => undefined); } catch {}
    }
    const limitTerminated = Boolean(recorder?.limitError) || ["timeout", "max_turns", "max_tool_calls"].includes(status);
    if (recorder?.providerFailure && !artifacts.finalCsv && !limitTerminated && status === "completed") {
      const failure = recorder.providerFailure;
      error ??= { name: "ProviderError", message: failure.message };
      error.provider ??= failure;
      status = "provider_error";
    }
    const recordedKnowledgeMetrics = knowledgeMetrics(recorder?.calls ?? [], startedAt);
    const recordedFanoutMetrics = fanoutMetrics(recorder?.calls ?? []);
    const recordedSpecFeedbackMetrics = specFeedbackMetrics(recorder?.calls ?? []);
    const result = {
      instanceId: instance.instance_id,
      db: instance.db,
      backend: backendForCase(instance),
      status,
      startedAt: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
      turns: recorder?.turnCount ?? 0,
      toolCalls: recorder?.calls.length ?? 0,
      toolErrors: recorder?.calls.filter((call) => call.isError).length ?? 0,
      knowledgeMetrics: recordedKnowledgeMetrics,
      finalSql: artifacts.finalSql ?? null,
      csvGenerated: Boolean(artifacts.finalCsv),
      csvError: artifacts.csvError ?? null,
      error: error ?? null,
      assuranceMode: "answering-fanout",
      assuranceManifest: { mode: "answering-fanout", policyVersion: "answering-publication-v1", reviewerOnline: false, detectorsOnline: recordedFanoutMetrics.enabled, fanoutRuleVersion: "answering-fanout-v1", specFeedbackOnline: recordedSpecFeedbackMetrics.enabled, specFeedbackRuleVersion: "spec-feedback-v1" },
      publicationStatus: publicationStatusFor(recorder, status),
      assuranceAuditRecords: [],
      hookEvents: observerEvents,
      anomalies: recordedFanoutMetrics.findingCount > 0 ? recordedFanoutMetrics.reports.flatMap((report) => (report.targets ?? []).filter((target) => target.status === "finding").map((target) => ({ detector: "join_fanout", status: "observed", targetId: target.targetId, sourceRelation: target.sourceRelation, sourceKey: target.sourceKey, observation: target.observation }))) : [],
      fanoutMetrics: recordedFanoutMetrics,
      specFeedbackMetrics: recordedSpecFeedbackMetrics,
      anomalyMetrics: { total: recordedFanoutMetrics.findingCount, byDetector: recordedFanoutMetrics.findingCount > 0 ? { join_fanout: recordedFanoutMetrics.findingCount } : {}, distinctFingerprintsBySlot: {}, interpretationHookCount: 0, unresolvedHypothesisHookCount: 0, unresolvedHypothesisIds: [], interpretationBudgetSkipCount: 0, detectorTiers: { tierA: ["join_fanout"], tierB: [], disabled: [], enabled: recordedFanoutMetrics.enabled } },
    };
    await Promise.all([
      writeFile(path.join(caseRoot, "result.json"), JSON.stringify(result, null, 2), "utf8"),
      writeFile(path.join(caseRoot, "trace.json"), JSON.stringify({ events: recorder?.events ?? [], toolCalls: recorder?.calls ?? [], knowledgeMetrics: recordedKnowledgeMetrics, fanoutMetrics: recordedFanoutMetrics, specFeedbackMetrics: recordedSpecFeedbackMetrics, assuranceAuditRecords: [], hookEvents: observerEvents, anomalies: result.anomalies }, null, 2), "utf8"),
    ]);
    return result;
  };
}

async function gitCommit(directory) {
  try { return (await execFileAsync("git", ["-C", directory, "rev-parse", "HEAD"], { windowsHide: true })).stdout.trim(); }
  catch { return null; }
}

function timestampId() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "-");
}

function sameIdentity(left, right) {
  const keys = new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})]);
  return [...keys].every((key) => left?.[key] === right?.[key]);
}

async function currentBaselineSurface(config) {
  return {
    agentCommit: await gitCommit(projectRoot),
    systemPromptSha256: await sha256File(path.join(projectRoot, ".pi", "SYSTEM.md")),
    runtimeDistSha256: await sha256Tree(path.join(projectRoot, "packages", "runtime", "dist")),
    skillsSha256: await sha256Tree(path.join(projectRoot, ".agents", "skills")),
    sqliteMcpSha256: await sha256File(path.join(projectRoot, "apps", "server", "dist", "reference-sqlite-mcp.js")),
    queryExecutorSha256: await sha256File(path.join(projectRoot, "apps", "server", "dist", "mcp-query-executor.js")),
    evaluationAdapter: {
      runnerSha256: await sha256File(path.join(here, "run.mjs")),
      librarySha256: await sha256File(path.join(here, "lib.mjs")),
    },
    spider2: {
      commit: await gitCommit(config.spider2Repo),
      datasetSha256: await sha256File(config.datasetPath),
      evaluatorSha256: await sha256File(path.join(config.evaluationSuite, "evaluate.py")),
    },
    model: {
      provider: config.llm?.provider ?? "openai",
      model: config.llm?.model,
      apiFormat: config.llm?.apiFormat,
      baseUrl: config.llm?.baseUrlEnv ? process.env[config.llm.baseUrlEnv] : config.llm?.baseUrl,
      ...(config.selectedModelProfile ? { profile: config.selectedModelProfile } : {}),
    },
    limits: config.limits,
    concurrency: config.concurrency,
    localDatabasePackSha256: config.localDatabasePackSha256 ?? null,
  };
}

async function freezeCommand(config) {
  await assertFormalCompatibility(config);
  const lockDir = path.join(config.runsRoot, "_baseline");
  const lockPath = path.join(lockDir, "agent-surface-lock.json");
  await mkdir(lockDir, { recursive: true });
  const lock = { version: 1, frozenAt: new Date().toISOString(), surface: await currentBaselineSurface(config) };
  await writeFile(lockPath, JSON.stringify(lock, null, 2), "utf8");
  console.log(`Baseline surface frozen: ${lockPath}`);
  console.log(JSON.stringify(lock.surface, null, 2));
  return lock;
}

async function assertBaselineFrozen(config) {
  const lockPath = path.join(config.runsRoot, "_baseline", "agent-surface-lock.json");
  if (!(await exists(lockPath))) throw new Error("BASELINE_SURFACE_NOT_FROZEN");
  const expected = JSON.parse(await readFile(lockPath, "utf8")).surface;
  const actual = await currentBaselineSurface(config);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("BASELINE_SURFACE_CHANGED");
  return lockPath;
}

async function assertFormalCompatibility(config) {
  const target = path.join(config.runsRoot, "_preflight", "gold-compatibility.json");
  if (!(await exists(target))) throw new Error("FORMAL_RUN_REQUIRES_GOLD_PREFLIGHT");
  const result = JSON.parse(await readFile(target, "utf8"));
  const datasetSha256 = await sha256File(config.datasetPath);
  const evaluatorSha256 = await sha256File(path.join(config.evaluationSuite, "evaluate.py"));
  if (!result.ok || result.datasetSha256 !== datasetSha256 || result.evaluatorSha256 !== evaluatorSha256) {
    throw new Error("FORMAL_RUN_BLOCKED_BY_GOLD_INCOMPATIBILITY");
  }
}

function resumeStatusesFromOptions(options) {
  const value = options.resumeStatuses ?? options.resumeStatus ?? "error,provider_error,timeout";
  return new Set(String(value).split(",").map((s) => s.trim()).filter(Boolean));
}

async function runCommand(config, options) {
  if (options.formal || options.baseline) await assertFormalCompatibility(config);
  const hookSwitches = assuranceHookSwitches(config, options);
  const detectorPolicy = detectorPolicyFromConfig(config);
  const interpretationPolicy = interpretationPolicyFromConfig(config);
  const resumeStatuses = resumeStatusesFromOptions(options);
  const baselineLockPath = options.baseline ? await assertBaselineFrozen(config) : undefined;
  const modelCanary = options.formal || options.baseline ? await runModelCanary(config) : undefined;
  const allCases = await loadCases(config.datasetPath);
  const ids = options.idsFile ? (await readFile(path.resolve(options.idsFile), "utf8")).split(/\r?\n/).map((item) => item.trim()).filter(Boolean) : undefined;
  const selected = selectCases(allCases, {
    instanceId: options.instanceId,
    backend: options.backend,
    ids,
    maxCases: options.maxCases === undefined ? undefined : Number(options.maxCases),
  });
  if (selected.length === 0) throw new Error("NO_CASES_SELECTED");
  const runId = options.runId || `spider2-${options.backend ?? "mixed"}-${timestampId()}`;
  const runDir = path.join(config.runsRoot, runId);
  if (await exists(runDir) && !options.resume) throw new Error(`RUN_ALREADY_EXISTS:${runDir}`);
  const previousManifestPath = path.join(runDir, "manifest.json");
  const previousManifest = options.resume && await exists(previousManifestPath)
    ? JSON.parse(await readFile(previousManifestPath, "utf8"))
    : undefined;
  await mkdir(runDir, { recursive: true });
  const systemPrompt = await evaluationSystemPrompt(config);

  const manifest = {
    runId,
    agentCommit: await gitCommit(projectRoot),
    spider2Commit: await gitCommit(config.spider2Repo),
    datasetSha256: await sha256File(config.datasetPath),
    evaluatorSha256: await sha256File(path.join(config.evaluationSuite, "evaluate.py")),
    runnerSha256: sha256Text(`${await readFile(fileURLToPath(import.meta.url), "utf8")}\n${await readFile(path.join(projectRoot, "evaluations", "spider2", "lib.mjs"), "utf8")}`),
    systemPromptSha256: sha256Text(systemPrompt),
    model: { provider: config.llm?.provider ?? "openai", model: config.llm?.model, apiFormat: config.llm?.apiFormat, ...(config.llm?.contextWindow !== undefined ? { contextWindow: Number(config.llm.contextWindow) } : {}), ...(config.llm?.maxTokens !== undefined ? { maxTokens: Number(config.llm.maxTokens) } : {}), ...(config.llm?.thinkingLevel ? { thinkingLevel: config.llm.thinkingLevel } : {}), ...(config.selectedModelProfile ? { profile: config.selectedModelProfile } : {}) },
    answering: {
      interface: ["begin", "revise", "execute", "publish", "inspect"],
      policyVersion: "answering-publication-v1",
      reviewerOnline: false,
      detectorsOnline: true,
      fanoutRuleVersion: "answering-fanout-v1",
    },
    // Legacy assurance switches remain manifest-only experiment metadata; they
    // do not grant online publication authority in the Application Host.
    assuranceObserver: {
      mode: "offline",
      hooks: hookSwitches,
      detectors: detectorPolicy,
      interpretations: interpretationPolicy,
    },
    // A scoped --resume must not shrink the original run denominator. Keep the
    // prior manifest's population and merge untouched case results below.
    instanceIds: previousManifest?.instanceIds ?? selected.map((item) => item.instance_id),
    limits: config.limits,
    concurrency: Number(options.concurrency ?? config.concurrency),
    configPath: config.__path,
    ...(baselineLockPath ? { baselineLockSha256: await sha256File(baselineLockPath) } : {}),
    ...(modelCanary ? { modelCanary } : {}),
    status: "running",
    startedAt: new Date().toISOString(),
  };
  await writeFile(path.join(runDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  const runCase = await createCaseRunner(config, runDir, hookSwitches, detectorPolicy, interpretationPolicy, systemPrompt);
  const resultById = new Map();
  if (options.resume) {
    const priorIds = previousManifest?.instanceIds ?? selected.map((item) => item.instance_id);
    for (const instanceId of priorIds) {
      const resultPath = path.join(runDir, "cases", instanceId, "result.json");
      if (await exists(resultPath)) resultById.set(instanceId, JSON.parse(await readFile(resultPath, "utf8")));
    }
  }
  let nextIndex = 0;
  let abortResult;
  const concurrency = Math.max(1, Math.min(selected.length, Number(options.concurrency ?? config.concurrency)));
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      if (abortResult) return;
      const index = nextIndex;
      nextIndex += 1;
      if (index >= selected.length) return;
      const instance = selected[index];
      const existing = path.join(runDir, "cases", instance.instance_id, "result.json");
      if (options.resume && await exists(existing)) {
        const previous = JSON.parse(await readFile(existing, "utf8"));
        const suspiciousCompleted = previous.status === "completed" && previous.toolCalls === 0 && !previous.csvGenerated;
        if (!resumeStatuses.has(previous.status) && !suspiciousCompleted) {
          resultById.set(instance.instance_id, previous);
          continue;
        }
      }
      console.log(`[${index + 1}/${selected.length}] ${instance.instance_id} (${backendForCase(instance)})`);
      const result = await runCase(instance);
      resultById.set(instance.instance_id, result);
      console.log(`  ${result.status} ${result.durationMs}ms sql=${Boolean(result.finalSql)} csv=${result.csvGenerated}`);
      if (result.status === "provider_error" || ((options.formal || options.baseline) && ["error", "resource_error"].includes(result.status))) {
        abortResult ??= result;
      }
    }
  });
  await Promise.all(workers);
  const results = [...resultById.values()].sort((a, b) => a.instanceId.localeCompare(b.instanceId));
  await writeFile(path.join(runDir, "cases.jsonl"), `${results.map(safeJson).join("\n")}\n`, "utf8");
  await writeSummary(runDir, results);
  const infrastructureFailures = results.filter((item) => ["provider_error", "resource_error", "error"].includes(item.status));
  const expectedCases = previousManifest?.instanceIds?.length ?? selected.length;
  const complete = results.length === expectedCases && infrastructureFailures.length === 0;
  manifest.status = complete ? "completed" : "incomplete";
  manifest.completedAt = new Date().toISOString();
  manifest.completedCases = results.length;
  manifest.infrastructureFailures = infrastructureFailures.map((item) => ({ instanceId: item.instanceId, status: item.status, message: item.error?.message ?? null }));
  await writeFile(path.join(runDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  if (!complete) {
    const reason = abortResult ? `${abortResult.instanceId}:${abortResult.status}:${abortResult.error?.message ?? "unknown"}` : `completed=${results.length}/${expectedCases}`;
    throw new Error(`RUN_INCOMPLETE:${reason}`);
  }
  console.log(`Run completed: ${runDir}`);
  if (options.score) await scoreCommand(config, { run: runId });
  return runDir;
}

async function runEvaluator(config, resultDir, mode, outputDir) {
  const extension = mode === "sql" ? ".sql" : ".csv";
  const files = (await readdir(resultDir).catch(() => [])).filter((name) => name.endsWith(extension) && !name.endsWith("-ids.csv"));
  if (files.length === 0) return { mode, skipped: true, reason: "no_submission_files" };
  const python = config.pythonExecutable || "python";
  const evaluator = path.join(config.evaluationSuite, "evaluate.py");
  const evaluatorSource = await readFile(evaluator, "utf8");
  validateOfficialEvaluatorSource(evaluatorSource);
  const evaluatorArgs = [
    evaluator,
    "--result_dir", resultDir,
    "--mode", mode,
    "--gold_dir", "gold",
  ];
  if (/add_argument\(["']--max_workers["']/.test(evaluatorSource)) evaluatorArgs.push("--max_workers", String(config.scoreWorkers ?? 4));
  try {
    const { stdout, stderr } = await execFileAsync(python, evaluatorArgs, {
      cwd: config.evaluationSuite,
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
      // The official evaluator uses open()/read() without an explicit encoding
      // for submitted SQL. Force UTF-8 mode on Windows so UTF-8 SQL is not
      // decoded with the system GBK code page.
      env: { ...process.env, PYTHONUTF8: "1" },
    });
    const output = `${stdout}${stderr}`;
    await writeFile(path.join(outputDir, `${mode}.log`), output, "utf8");
    const submittedIds = files.map((name) => path.basename(name, extension));
    const idsPath = `${resultDir}-ids.csv`;
    const correctIds = await exists(idsPath) ? parseCorrectIdsCsv(await readFile(idsPath, "utf8")) : [];
    const caseScores = Object.fromEntries(submittedIds.map((id) => [id, correctIds.includes(id) ? 1 : 0]));
    return { mode, skipped: false, ...parseOfficialScore(output), caseScores: Object.keys(caseScores).length ? caseScores : parseOfficialCaseScores(output) };
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}${error.message ?? ""}`;
    await writeFile(path.join(outputDir, `${mode}.log`), output, "utf8");
    return { mode, skipped: false, error: error.message, ...parseOfficialScore(output), caseScores: parseOfficialCaseScores(output) };
  }
}

async function scoreCommand(config, options) {
  if (!options.run) throw new Error("--run is required");
  const runDir = path.join(config.runsRoot, options.run);
  const manifestPath = path.join(runDir, "manifest.json");
  let manifest;
  if (await exists(manifestPath)) {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const datasetSha256 = await sha256File(config.datasetPath);
    const evaluatorSha256 = await sha256File(path.join(config.evaluationSuite, "evaluate.py"));
    const mismatch = manifest.datasetSha256 !== datasetSha256 || manifest.evaluatorSha256 !== evaluatorSha256;
    if (mismatch && !options.allowVersionMismatch) throw new Error("SCORE_VERSION_MISMATCH");
  }
  const outputDir = path.join(runDir, "official_score");
  await mkdir(outputDir, { recursive: true });
  // Older official evaluators share a fixed `temp/` directory, so SQL and
  // exec-result modes must run sequentially to avoid cross-mode corruption.
  const sql = await runEvaluator(config, path.join(runDir, "submissions", "sql"), "sql", outputDir);
  const execResult = await runEvaluator(config, path.join(runDir, "submissions", "csv"), "exec_result", outputDir);
  const expectedTotal = manifest?.instanceIds?.length;
  if (Number.isInteger(expectedTotal)) {
    sql.fixedDenominator = fixedDenominatorScore(sql.correct, expectedTotal, sql.total);
    execResult.fixedDenominator = fixedDenominatorScore(execResult.correct, expectedTotal, execResult.total);
  }
  const result = { sql, execResult, scoredAt: new Date().toISOString() };
  await writeFile(path.join(outputDir, "summary.json"), JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify(result, null, 2));
  await reportCommand(config, options);
  return result;
}

async function loadCaseResults(runDir) {
  const target = path.join(runDir, "cases.jsonl");
  if (!(await exists(target))) return [];
  return (await readFile(target, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

async function writeSummary(runDir, results) {
  const statuses = {};
  const backends = {};
  const publicationStatuses = {};
  for (const result of results) {
    statuses[result.status] = (statuses[result.status] ?? 0) + 1;
    backends[result.backend] = (backends[result.backend] ?? 0) + 1;
    if (result.publicationStatus) publicationStatuses[result.publicationStatus] = (publicationStatuses[result.publicationStatus] ?? 0) + 1;
  }
  const summary = {
    total: results.length,
    statuses,
    backends,
    publicationStatuses,
    sqlCoverage: results.length ? results.filter((item) => item.finalSql).length / results.length : 0,
    csvCoverage: results.length ? results.filter((item) => item.csvGenerated).length / results.length : 0,
    averageDurationMs: results.length ? Math.round(results.reduce((sum, item) => sum + item.durationMs, 0) / results.length) : 0,
    averageToolCalls: results.length ? results.reduce((sum, item) => sum + item.toolCalls, 0) / results.length : 0,
    anomalyCount: results.reduce((sum, item) => sum + Number(item.anomalyMetrics?.total ?? 0), 0),
    interpretationHookCount: results.reduce((sum, item) => sum + Number(item.anomalyMetrics?.interpretationHookCount ?? 0), 0),
    unresolvedHypothesisHookCount: results.reduce((sum, item) => sum + Number(item.anomalyMetrics?.unresolvedHypothesisHookCount ?? 0), 0),
    unresolvedHypothesisCount: results.reduce((sum, item) => sum + Number(item.anomalyMetrics?.unresolvedHypothesisIds?.length ?? 0), 0),
    interpretationBudgetSkipCount: results.reduce((sum, item) => sum + Number(item.anomalyMetrics?.interpretationBudgetSkipCount ?? 0), 0),
  };
  await writeFile(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  return summary;
}

async function reportCommand(config, options) {
  if (!options.run) throw new Error("--run is required");
  const runDir = path.join(config.runsRoot, options.run);
  const results = await loadCaseResults(runDir);
  const summary = await writeSummary(runDir, results);
  const officialPath = path.join(runDir, "official_score", "summary.json");
  const official = await exists(officialPath) ? JSON.parse(await readFile(officialPath, "utf8")) : null;
  const sqlCaseScores = official?.sql?.caseScores ?? {};
  const csvCaseScores = official?.execResult?.caseScores ?? {};
  const failures = results.filter((item) => item.status !== "completed" || !item.finalSql || !item.csvGenerated || sqlCaseScores[item.instanceId] === 0 || csvCaseScores[item.instanceId] === 0);
  const report = [
    `# Spider2 Agent Evaluation: ${options.run}`,
    "",
    `- Cases: ${summary.total}`,
    `- Status: ${Object.entries(summary.statuses).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`,
    `- SQL coverage: ${(summary.sqlCoverage * 100).toFixed(2)}%`,
    `- CSV coverage: ${(summary.csvCoverage * 100).toFixed(2)}%`,
    `- Publication statuses: ${Object.entries(summary.publicationStatuses).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`,
    `- Average latency: ${summary.averageDurationMs} ms`,
    `- Average tool calls: ${summary.averageToolCalls.toFixed(2)}`,
    `- Registered anomalies: ${summary.anomalyCount}`,
    `- Interpretation Hook injections: ${summary.interpretationHookCount}`,
    `- Unresolved-hypothesis Hook injections: ${summary.unresolvedHypothesisHookCount} (${summary.unresolvedHypothesisCount} hypothesis IDs)`,
    `- Interpretation budget skips: ${summary.interpretationBudgetSkipCount}`,
    ...(official ? [
      `- Official SQL EX (submitted only): ${official.sql?.score ?? "not available"} (${official.sql?.correct ?? 0}/${official.sql?.total ?? 0})`,
      `- SQL EX (fixed run denominator): ${official.sql?.fixedDenominator?.score ?? "not available"} (${official.sql?.fixedDenominator?.correct ?? 0}/${official.sql?.fixedDenominator?.total ?? summary.total})`,
      `- Official End-to-End EX (submitted only): ${official.execResult?.score ?? "not available"} (${official.execResult?.correct ?? 0}/${official.execResult?.total ?? 0})`,
      `- End-to-End EX (fixed run denominator): ${official.execResult?.fixedDenominator?.score ?? "not available"} (${official.execResult?.fixedDenominator?.correct ?? 0}/${official.execResult?.fixedDenominator?.total ?? summary.total})`,
    ] : []),
    "",
    "## Cases needing review",
    "",
    ...(failures.length ? failures.map((item) => `- ${item.instanceId}: status=${item.status}, sql=${Boolean(item.finalSql)}, csv=${item.csvGenerated}, sqlEX=${sqlCaseScores[item.instanceId] ?? "n/a"}, csvEX=${csvCaseScores[item.instanceId] ?? "n/a"}${item.csvError ? `, csvError=${item.csvError}` : ""}${item.error?.message ? `, error=${item.error.message}` : ""}`) : ["None."]),
    "",
  ].join("\n");
  await writeFile(path.join(runDir, "report.md"), report, "utf8");
  console.log(`Report: ${path.join(runDir, "report.md")}`);
  return report;
}

async function runGoldCompatibilityCheck(config, selected, option) {
  const goldSqlDir = path.join(config.evaluationSuite, "gold", "sql");
  let candidates = [];
  for (const instance of selected) {
    if (backendForCase(instance) !== "sqlite") continue;
    const source = path.join(goldSqlDir, `${instance.instance_id}.sql`);
    if (await exists(source)) candidates.push({ instance, source });
  }
  const requested = option === true ? undefined : String(option);
  if (requested && !/^\d+$/.test(requested)) candidates = candidates.filter(({ instance }) => instance.instance_id === requested);
  else candidates = candidates.slice(0, requested ? Math.max(1, Number(requested)) : 3);
  if (candidates.length === 0) return { ok: false, error: "NO_GOLD_SQL_CASES_AVAILABLE", testedIds: [] };

  const checkRoot = path.join(config.runsRoot, "_preflight", `gold-${timestampId()}`);
  const submissionDir = path.join(checkRoot, "submission");
  const outputDir = path.join(checkRoot, "official_score");
  await Promise.all([mkdir(submissionDir, { recursive: true }), mkdir(outputDir, { recursive: true })]);
  for (const { instance, source } of candidates) await copyFile(source, path.join(submissionDir, `${instance.instance_id}.sql`));
  const score = await runEvaluator(config, submissionDir, "sql", outputDir);
  const result = {
    ok: !score.error && score.total === candidates.length && score.correct === candidates.length,
    testedIds: candidates.map(({ instance }) => instance.instance_id),
    score,
    spider2Commit: await gitCommit(config.spider2Repo),
    datasetSha256: await sha256File(config.datasetPath),
    evaluatorSha256: await sha256File(path.join(config.evaluationSuite, "evaluate.py")),
    checkedAt: new Date().toISOString(),
    evidenceDir: checkRoot,
  };
  await mkdir(path.join(config.runsRoot, "_preflight"), { recursive: true });
  await writeFile(path.join(config.runsRoot, "_preflight", "gold-compatibility.json"), JSON.stringify(result, null, 2), "utf8");
  return result;
}

async function preflightCommand(config, options) {
  const required = [
    config.datasetPath,
    path.join(config.evaluationSuite, "evaluate.py"),
    path.join(config.evaluationSuite, "gold", "spider2lite_eval.jsonl"),
    path.join(projectRoot, "packages", "runtime", "dist", "index.js"),
    path.join(projectRoot, "apps", "server", "dist", "mcp-query-executor.js"),
    path.join(projectRoot, "apps", "server", "dist", "reference-sqlite-mcp.js"),
  ];
  const missing = [];
  for (const target of required) if (!(await exists(target))) missing.push(target);
  if (missing.length) throw new Error(`PREFLIGHT_MISSING:\n${missing.join("\n")}`);
  const cases = await loadCases(config.datasetPath);
  const counts = {};
  for (const item of cases) counts[backendForCase(item)] = (counts[backendForCase(item)] ?? 0) + 1;
  const ids = options.idsFile ? (await readFile(path.resolve(options.idsFile), "utf8")).split(/\r?\n/).map((item) => item.trim()).filter(Boolean) : undefined;
  const selected = selectCases(cases, {
    backend: options.backend,
    instanceId: options.instanceId,
    ids,
    maxCases: options.maxCases ? Number(options.maxCases) : undefined,
  });
  const issues = [];
  for (const instance of selected) {
    try {
      await resolveMetadataDirectory(config.spider2LiteRoot, instance);
      await resolveExternalKnowledge(config.spider2LiteRoot, instance);
      if (backendForCase(instance) === "sqlite") await resolveLocalDatabase(config, config.spider2LiteRoot, instance);
      else if (!config.backends?.[backendForCase(instance)]?.mcp?.command) issues.push(`${instance.instance_id}:BACKEND_MCP_NOT_CONFIGURED`);
    } catch (error) {
      issues.push(`${instance.instance_id}:${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const goldCompatibility = options.goldCheck ? await runGoldCompatibilityCheck(config, selected, options.goldCheck) : undefined;
  if (goldCompatibility && !goldCompatibility.ok) issues.push(`GOLD_COMPATIBILITY_FAILED:${goldCompatibility.testedIds.join(",") || goldCompatibility.error}`);
  let modelCanary;
  if (options.modelCanary) {
    try { modelCanary = await runModelCanary(config); }
    catch (error) { issues.push(error instanceof Error ? error.message : String(error)); }
  }
  const result = {
    ok: issues.length === 0,
    config: config.__path,
    spider2Repo: config.spider2Repo,
    spider2LiteRoot: config.spider2LiteRoot,
    runsRoot: config.runsRoot,
    totalCases: cases.length,
    counts,
    checkedCases: selected.length,
    issues: issues.slice(0, 100),
    ...(goldCompatibility ? { goldCompatibility } : {}),
    ...(modelCanary ? { modelCanary } : {}),
    llmKeyAvailable: Boolean(process.env[config.llm?.apiKeyEnv ?? "OPENAI_API_KEY"]),
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
  return result;
}

function usage() {
  return [
    "Usage: node evaluations/spider2/run.mjs <preflight|freeze|run|score|report> [options]",
    "",
    "Safety: `run` executes model/database work. Always pass an explicit --run-id and case selector.",
    "Use `<command> --help` only for this usage text; it never loads credentials or starts work.",
  ].join("\n");
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === "help" || options.help) {
    console.log(usage());
    return;
  }
  if (options.envFile) await loadEnvironmentFile(path.resolve(options.envFile));
  else {
    await loadEnvironmentFile(path.join(projectRoot, ".env"));
    await loadEnvironmentFile(path.join(here, ".env.local"));
  }
  const config = selectModelProfile(await loadConfig(options.config), options.modelProfile);
  if (command === "preflight") await preflightCommand(config, options);
  else if (command === "freeze") await freezeCommand(config);
  else if (command === "run") await runCommand(config, options);
  else if (command === "score") await scoreCommand(config, options);
  else if (command === "report") await reportCommand(config, options);
  else throw new Error(`UNKNOWN_COMMAND:${command}`);
}

async function flushCliOutput() {
  const flush = (stream) => new Promise((resolve) => {
    if (!stream || stream.destroyed || !stream.writable) resolve();
    else stream.write("", resolve);
  });
  await Promise.all([flush(process.stdout), flush(process.stderr)]);
}

async function terminateCli(exitCode) {
  await flushCliOutput();
  process.exit(exitCode);
}

main().then(
  () => terminateCli(process.exitCode ?? 0),
  async (error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    await terminateCli(1);
  },
);
