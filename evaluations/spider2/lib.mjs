import { createHash } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

export const BACKENDS = ["sqlite", "bigquery", "snowflake"];

/** Selects one credential-free model profile from local evaluation config. */
export function selectModelProfile(config, profileName) {
  if (!profileName) return config;
  const profiles = config?.modelProfiles;
  const selected = profiles?.[profileName];
  if (!selected || typeof selected !== "object" || Array.isArray(selected)) {
    const available = profiles && typeof profiles === "object" ? Object.keys(profiles).sort().join(",") : "";
    throw new Error(`MODEL_PROFILE_NOT_FOUND:${profileName}${available ? `:available=${available}` : ""}`);
  }
  const llm = selected.llm && typeof selected.llm === "object" && !Array.isArray(selected.llm) ? selected.llm : selected;
  if (typeof llm.model !== "string" || !llm.model.trim()) throw new Error(`MODEL_PROFILE_INVALID:${profileName}:model_required`);
  if (llm.apiKey !== undefined) throw new Error(`MODEL_PROFILE_INVALID:${profileName}:inline_api_key_forbidden`);
  if (typeof llm.apiKeyEnv !== "string" || !llm.apiKeyEnv.trim()) throw new Error(`MODEL_PROFILE_INVALID:${profileName}:api_key_env_required`);
  const selectedLlm = { ...(config.llm ?? {}), ...llm };
  const profileAssurance = selected.assurance && typeof selected.assurance === "object" && !Array.isArray(selected.assurance) ? selected.assurance : {};
  const assurance = {
    ...(config.assurance ?? {}),
    ...profileAssurance,
    reviewerModel: profileAssurance.reviewerModel ?? selectedLlm.model,
    plannerLlm: profileAssurance.plannerLlm ?? selectedLlm,
    enumerator: {
      ...(config.assurance?.enumerator ?? {}),
      ...(profileAssurance.enumerator ?? {}),
      model: profileAssurance.enumerator?.model ?? selectedLlm.model,
    },
  };
  return { ...config, llm: selectedLlm, assurance, selectedModelProfile: profileName };
}

export function backendForCase(instance) {
  const id = String(instance?.instance_id ?? "");
  if (id.startsWith("local")) return "sqlite";
  if (id.startsWith("bq") || id.startsWith("ga")) return "bigquery";
  if (id.startsWith("sf")) return "snowflake";
  throw new Error(`UNSUPPORTED_INSTANCE_ID:${id || "missing"}`);
}

export const SQLITE_DIALECT_RULES = `## SQLite 方言规则

- 日期提取：用 strftime('%Y', date_col)，不支持 YEAR() / MONTH() / DATEDIFF() / DATE_FORMAT()
- 日期差：用 julianday(d1) - julianday(d2)
- 浮点除法：用 CAST(x AS REAL) / y 或 1.0 * x / y，整数除法会截断小数
- 字符串连接：用 ||，不支持 CONCAT()
- 字符串截取：用 substr()，不支持 SUBSTRING_INDEX()
- 系统表：用 sqlite_master，不支持 information_schema
- 不支持 LIMIT x, y 的双参数形式，用 LIMIT y OFFSET x
- GROUP BY 中引用列别名是合法的
- 没有 IF() 函数，用 CASE WHEN ... THEN ... ELSE ... END
- 使用 COALESCE() 处理空值
`;

export function buildEvaluationRules(baseRules, instance) {
  const base = typeof baseRules === "string" ? baseRules.trimEnd() : "";
  const backend = backendForCase(instance);
  const evaluation = [
    "## Evaluation Database Rules",
    "",
    `Database: ${instance.db}`,
    `Backend: ${backend}`,
    "Queries must remain read-only.",
  ].join("\n");
  return `${base ? `${base}\n\n` : ""}${evaluation}${backend === "sqlite" ? `\n\n${SQLITE_DIALECT_RULES.trim()}` : ""}\n`;
}

export function buildEvaluationLearning(baseLearning) {
  const base = typeof baseLearning === "string" ? baseLearning.trim() : "";
  return base || "# Past Learnings\n\nThis isolated evaluation case starts without prior task-specific learnings.\n";
}

export function validateCase(value, lineNumber = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`INVALID_CASE:${lineNumber}:object_required`);
  }
  for (const field of ["instance_id", "db", "question"]) {
    if (typeof value[field] !== "string" || !value[field].trim()) {
      throw new Error(`INVALID_CASE:${lineNumber}:${field}_required`);
    }
  }
  const external = value.external_knowledge;
  if (external !== null && external !== undefined && typeof external !== "string" && !Array.isArray(external)) {
    throw new Error(`INVALID_CASE:${lineNumber}:external_knowledge_invalid`);
  }
  if (Array.isArray(external) && external.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`INVALID_CASE:${lineNumber}:external_knowledge_invalid`);
  }
  return value;
}

export function parseJsonl(text) {
  const cases = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    let value;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(`INVALID_JSONL:${index + 1}:${error instanceof Error ? error.message : String(error)}`);
    }
    cases.push(validateCase(value, index + 1));
  });
  const ids = new Set();
  for (const item of cases) {
    if (ids.has(item.instance_id)) throw new Error(`DUPLICATE_INSTANCE_ID:${item.instance_id}`);
    ids.add(item.instance_id);
  }
  return cases;
}

export async function loadCases(jsonlPath) {
  return parseJsonl(await readFile(jsonlPath, "utf8"));
}

export function selectCases(cases, options = {}) {
  let selected = [...cases];
  if (options.instanceId) selected = selected.filter((item) => item.instance_id === options.instanceId);
  if (options.backend) selected = selected.filter((item) => backendForCase(item) === options.backend);
  if (options.ids?.length) {
    const ids = new Set(options.ids);
    selected = selected.filter((item) => ids.has(item.instance_id));
  }
  selected.sort((a, b) => a.instance_id.localeCompare(b.instance_id));
  if (Number.isFinite(options.maxCases)) selected = selected.slice(0, Math.max(0, options.maxCases));
  return selected;
}

export function externalKnowledgeNames(instance) {
  const value = instance.external_knowledge;
  if (value === null || value === undefined || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

function normalizedName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function resolveMetadataDirectory(spider2LiteRoot, instance) {
  const backend = backendForCase(instance);
  const typeDir = backend === "sqlite" ? "sqlite" : backend;
  const parent = path.join(spider2LiteRoot, "resource", "databases", typeDir);
  const entries = await readdir(parent, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());
  const exact = directories.find((entry) => entry.name === instance.db);
  if (exact) return path.join(parent, exact.name);
  const caseInsensitive = directories.filter((entry) => entry.name.toLowerCase() === instance.db.toLowerCase());
  if (caseInsensitive.length === 1) return path.join(parent, caseInsensitive[0].name);
  const normalized = directories.filter((entry) => normalizedName(entry.name) === normalizedName(instance.db));
  if (normalized.length === 1) return path.join(parent, normalized[0].name);
  if (normalized.length > 1) throw new Error(`AMBIGUOUS_METADATA_DIR:${instance.db}`);
  throw new Error(`METADATA_DIR_NOT_FOUND:${instance.db}`);
}

export async function resolveExternalKnowledge(spider2LiteRoot, instance) {
  const root = path.resolve(spider2LiteRoot, "resource", "documents");
  const resolved = [];
  for (const name of externalKnowledgeNames(instance)) {
    const target = path.resolve(root, name);
    const relative = path.relative(root, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`EXTERNAL_KNOWLEDGE_PATH_ESCAPE:${name}`);
    await access(target);
    if (!(await stat(target)).isFile()) throw new Error(`EXTERNAL_KNOWLEDGE_NOT_FILE:${name}`);
    resolved.push(target);
  }
  return resolved;
}

export async function resolveLocalDatabase(config, spider2LiteRoot, instance) {
  const configured = config.backends?.sqlite?.databaseDir;
  const directories = [...new Set([
    configured,
    path.join(spider2LiteRoot, "resource", "databases"),
    path.join(spider2LiteRoot, "resource", "databases", "spider2-localdb"),
  ].filter(Boolean).map((value) => path.resolve(value)))];
  for (const directory of directories) {
    const candidate = path.join(directory, `${instance.db}.sqlite`);
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Try the next supported official layout.
    }
  }
  throw new Error(`LOCAL_DATABASE_NOT_FOUND:${instance.db}:${directories.join("|")}`);
}

export function buildAgentPrompt(instance) {
  return `${instance.question}\n\n请完成原始题目，并将最终成果导出为 CSV。只导出回答题目所需的最终结果，不要导出中间结果、候选数据或诊断字段；本次评测需要使用 export_query 生成 CSV，不要用 publish_query_result 代替。`;
}

export function classifyProviderFailure(message) {
  if (typeof message !== "string" || !message.trim()) return undefined;
  const statusMatch = /(?:API error|HTTP|status)\s*\(?\s*(\d{3})\s*\)?/i.exec(message);
  const status = statusMatch ? Number(statusMatch[1]) : undefined;
  const providerLike = status !== undefined || /insufficient balance|invalid api key|authentication|rate limit|provider|connection error|stream ended|network|fetch failed|request failed|econn/i.test(message);
  if (!providerLike) return undefined;
  return {
    status: status ?? null,
    message,
    fatal: status === undefined || [400, 401, 402, 403].includes(status),
  };
}

export function extractProviderFailure(event) {
  const messages = event?.type === "message_end" ? [event.message]
    : event?.type === "agent_end" && Array.isArray(event.messages) ? event.messages
      : [];
  for (const message of messages) {
    if (message?.role !== "assistant") continue;
    if (message.stopReason !== "error" && !message.errorMessage) continue;
    const failure = classifyProviderFailure(message.errorMessage ?? "Provider returned stopReason=error");
    if (failure) return failure;
  }
  return undefined;
}

export function parseCorrectIdsCsv(text) {
  const rows = parseCsvRows(text);
  return rows.slice(1).map((row) => row[0]?.trim()).filter(Boolean).map((id) => id.startsWith("sf_local") ? id.slice(3) : id);
}

export function buildEvaluationGuardrails(limits, getTurnCount, getToolCallCount) {
  const explorationQueryBudget = limits?.maxExploratoryQueries == null
    ? undefined
    : Number(limits.maxExploratoryQueries);
  const maxTurns = limits?.maxTurns == null ? 0 : Number(limits.maxTurns);
  const maxToolCalls = limits?.maxToolCalls == null ? undefined : Number(limits.maxToolCalls);
  return {
    ...(explorationQueryBudget === undefined ? {} : { explorationQueryBudget }),
    taskProgress: () => ({ turnCount: Number(getTurnCount?.() ?? 0), maxTurns, toolCallCount: Number(getToolCallCount?.() ?? 0), ...(maxToolCalls === undefined ? {} : { maxToolCalls }) }),
  };
}

export function exceedsTurnBudget(turnCount, maxTurns) {
  if (maxTurns == null || !Number.isFinite(Number(maxTurns)) || Number(maxTurns) <= 0) return false;
  return Number(turnCount) > Number(maxTurns);
}

export function deterministicGateCasesFromLabels(labels) {
  if (!Array.isArray(labels)) throw new Error("DETERMINISTIC_GATE_LABELS_INVALID");
  return labels.flatMap((label) => {
    if (!label || typeof label.caseId !== "string") throw new Error("DETERMINISTIC_GATE_LABEL_CASE_REQUIRED");
    const entries = label.gates ?? label.deterministicGates ?? [];
    if (!Array.isArray(entries)) throw new Error(`DETERMINISTIC_GATE_LABELS_INVALID:${label.caseId}`);
    return entries.map((entry) => {
      const gate = entry?.gate;
      const expected = entry?.expected;
      const dialect = entry?.dialect ?? label.dialect;
      if (!["g1_shape", "g2_population", "g3_fanout", "g4_candidate"].includes(gate)) throw new Error(`DETERMINISTIC_GATE_GATE_REQUIRED:${label.caseId}`);
      if (!["pass", "block"].includes(expected)) throw new Error(`DETERMINISTIC_GATE_EXPECTED_REQUIRED:${label.caseId}`);
      if (typeof dialect !== "string" || !dialect.trim()) throw new Error(`DETERMINISTIC_GATE_DIALECT_REQUIRED:${label.caseId}`);
      const applicability = entry?.applicability ?? "checked";
      if (!["checked", "not_applicable", "unsupported", "inconclusive"].includes(applicability)) throw new Error(`DETERMINISTIC_GATE_APPLICABILITY_INVALID:${label.caseId}`);
      return {
        caseId: `${label.caseId}:${gate}`,
        sourceCaseId: label.caseId,
        dialect,
        gate,
        expected,
        variant: entry?.variant ?? (expected === "block" ? "neighbor_negative" : "positive"),
        // Diagnostic only. Calibration must replace this with a frozen Runtime
        // input and replay evaluateGates; labels never grant observed status.
        result: { gate, applicability, blocking: Boolean(entry?.blocking) },
      };
    });
  });
}

export function fixedDenominatorScore(correct, expectedTotal, submittedTotal = expectedTotal) {
  const total = Math.max(0, Number(expectedTotal) || 0);
  const submitted = Math.max(0, Number(submittedTotal) || 0);
  return {
    score: total ? Number(correct ?? 0) / total : 0,
    correct: Number(correct ?? 0),
    total,
    submittedTotal: submitted,
    missingSubmissions: Math.max(0, total - submitted),
  };
}

export function selectFinalSql(toolCalls, options = {}) {
  // The current Application Host exposes only opaque Answering handles. A
  // published branch is valid only when its Receipt binds the same candidate
  // and ResultRef as exactly one successful result query.
  const currentQueries = toolCalls.filter((call) => {
    const details = call.result?.details ?? {};
    const artifact = details.artifact;
    return call.finishedAt && !call.isError && call.toolName === "query_database"
      && artifact?.kind === "candidate"
      && typeof artifact.candidateId === "string"
      && typeof artifact.resultRef === "string"
      && typeof call.args?.sql === "string"
      && call.args.sql.trim();
  });
  const currentDeliveries = toolCalls.filter((call) => {
    const details = call.result?.details ?? {};
    const receipt = details.receiptId && details.candidateId ? details : details.publicationReceipt;
    return call.finishedAt && !call.isError
      && (call.toolName === "export_query" || call.toolName === "publish_query_result")
      && receipt && typeof receipt === "object"
      && typeof receipt.receiptId === "string"
      && typeof receipt.candidateId === "string"
      && typeof receipt.resultRef === "string";
  });
  if (currentQueries.length > 0 || currentDeliveries.length > 0) {
    if (currentDeliveries.length !== 1) return undefined;
    const delivery = currentDeliveries[0];
    const details = delivery.result?.details ?? {};
    const receipt = details.receiptId && details.candidateId ? details : details.publicationReceipt;
    const queryMatches = currentQueries.filter((call) => {
      const artifact = call.result?.details?.artifact;
      return artifact?.candidateId === receipt.candidateId && artifact?.resultRef === receipt.resultRef;
    });
    if (queryMatches.length !== 1) return undefined;
    return { sql: queryMatches[0].args.sql.trim(), toolCallId: delivery.toolCallId, toolName: delivery.toolName, queryArtifactId: receipt.candidateId, candidateId: receipt.candidateId, resultRef: receipt.resultRef };
  }

  const completed = toolCalls.filter((call) => call.finishedAt && !call.isError);
  const successfulQueries = completed.filter((call) => {
    if (call.toolName !== "query_database" || call.result?.details?.warning === "EXPLORATION_BUDGET_EXCEEDED") return false;
    const details = call.result?.details ?? {};
    // New runs carry an explicit artifact kind. Old runs are accepted only by
    // their legacy exploratory=false flag during the migration window.
    return (details.artifactKind === "result_candidate"
      || details.artifactKind === undefined && details.exploratory !== true)
      && typeof call.args?.sql === "string"
      && call.args.sql.trim();
  });
  // Publication is the delivery decision for every assurance mode. Never
  // fall back to an un-published preview: it may be exploration SQL, an old
  // candidate, or a result that did not pass the exact Artifact identity path.
  const deliveryAttempts = toolCalls.filter((call) => (call.toolName === "export_query" || call.toolName === "publish_query_result" || call.toolName === "query_database" && call.args?.deliverIfEligible === true) && call.finishedAt);
  const successfulDeliveries = deliveryAttempts.flatMap((call) => {
    const details = call.result?.details ?? {};
    const receipt = details.publicationReceipt;
    // Current model tools expose the Query Artifact as an opaque candidateId;
    // queryArtifactId remains an internal/legacy replay field only. A delivery
    // may never mix both model-facing handles, even when their values match.
    const mixedHandles = call.args?.candidateId !== undefined && call.args?.queryArtifactId !== undefined;
    const artifactId = call.args?.candidateId ?? call.args?.queryArtifactId ?? details.queryArtifactId;
    return !mixedHandles && !call.isError && details.taskComplete === true && receipt && typeof receipt === "object" && typeof artifactId === "string" && receipt.queryArtifactId === artifactId ? [{ call, details, receipt, artifactId }] : [];
  });
  // Current protocol permits exactly one successful published branch. Failed
  // attempts do not mask it, but multiple successful branches are ambiguous
  // and must never be resolved by call/file order.
  if (successfulDeliveries.length !== 1) return undefined;
  const [{ call: delivery, receipt, artifactId }] = successfulDeliveries;
  const matchingQueries = successfulQueries.filter((call) => (call.result?.details?.candidateId ?? call.result?.details?.queryArtifactId) === artifactId);
  if (matchingQueries.length !== 1) return undefined;
  const query = matchingQueries[0];
  const queryDetails = query.result?.details ?? {};
  const currentProtocol = queryDetails.planProtocolVersion === "evidence-plan-v2";
  const artifactDecisionRefs = queryDetails.selectedDecisionRefs ?? [];
  const artifactSelectionHashes = queryDetails.decisionSelectionInputHashes ?? [];
  const decisionBinding = receipt.decisionBinding;
  if (currentProtocol && (!decisionBinding || !Array.isArray(decisionBinding.selectedDecisionRefs) || !Array.isArray(decisionBinding.selectionInputHashes))) return undefined;
  const receiptDecisionRefs = decisionBinding?.selectedDecisionRefs;
  const receiptSelectionHashes = decisionBinding?.selectionInputHashes;
  // Legacy traces expose Artifact binding arrays and can be compared directly.
  // The current opaque-handle protocol intentionally keeps those internal;
  // its immutable Publication Receipt is the authoritative delivery binding.
  const artifactRefsVisible = Array.isArray(queryDetails.selectedDecisionRefs);
  const artifactHashesVisible = Array.isArray(queryDetails.decisionSelectionInputHashes);
  if (currentProtocol && artifactRefsVisible !== artifactHashesVisible) return undefined;
  const artifactBindingVisible = artifactRefsVisible && artifactHashesVisible;
  if (artifactBindingVisible && Array.isArray(receiptDecisionRefs) && JSON.stringify(receiptDecisionRefs) !== JSON.stringify(artifactDecisionRefs)) return undefined;
  if (artifactBindingVisible && !Array.isArray(receiptDecisionRefs) && artifactDecisionRefs.length > 0) return undefined;
  if (artifactBindingVisible && Array.isArray(receiptSelectionHashes) && JSON.stringify(receiptSelectionHashes) !== JSON.stringify(artifactSelectionHashes)) return undefined;
  if (artifactBindingVisible && !Array.isArray(receiptSelectionHashes) && artifactSelectionHashes.length > 0) return undefined;
  return { sql: query.args.sql.trim(), toolCallId: delivery.toolCallId, toolName: delivery.toolName, queryArtifactId: artifactId };
}

export function publishedCsvPath(finalSql, toolCalls) {
  if (!finalSql) return undefined;
  const call = toolCalls.find((item) => item.toolCallId === finalSql.toolCallId);
  const details = call?.result?.details ?? {};
  const resultPath = details.relativePath ?? details.publicationReceipt?.targetPath;
  const requestedPath = finalSql.toolName === "export_query" && typeof call?.args?.filename === "string" ? call.args.filename : undefined;
  return resultPath ?? requestedPath;
}

export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (quoted) throw new Error("INVALID_CSV:unterminated_quote");
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

export function ddlCsvToSql(csvText) {
  const rows = parseCsvRows(csvText);
  if (rows.length === 0) return "";
  const header = rows[0].map((value) => value.trim().toLowerCase());
  const ddlIndex = header.indexOf("ddl");
  if (ddlIndex < 0) throw new Error("INVALID_DDL_CSV:DDL_REQUIRED");
  return rows.slice(1).map((row) => row[ddlIndex]?.trim()).filter(Boolean).join("\n");
}

export function ddlCsvToMarkdown(csvText, databaseName) {
  const rows = parseCsvRows(csvText);
  if (rows.length === 0) return `# Database Schema: ${databaseName}\n`;
  const header = rows[0].map((value) => value.trim().toLowerCase());
  const tableIndex = header.indexOf("table_name");
  const ddlIndex = header.indexOf("ddl");
  if (tableIndex < 0 || ddlIndex < 0) throw new Error("INVALID_DDL_CSV:table_name_and_DDL_required");
  const sections = rows.slice(1).filter((row) => row.some(Boolean)).map((row) => {
    const table = row[tableIndex]?.trim() || "unknown_table";
    const ddl = row[ddlIndex]?.trim() || "";
    return `## Table: ${table}\n\n\`\`\`sql\n${ddl}\n\`\`\``;
  });
  return [`# Database Schema: ${databaseName}`, "", ...sections].join("\n\n");
}

export function safeJson(value) {
  const seen = new WeakSet();
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === "bigint") return item.toString();
    if (item instanceof Error) return { name: item.name, message: item.message, stack: item.stack };
    if (item && typeof item === "object") {
      if (seen.has(item)) return "[Circular]";
      seen.add(item);
    }
    return item;
  });
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  hash.update(await readFile(filePath));
  return hash.digest("hex");
}

export async function sha256Tree(root) {
  const hash = createHash("sha256");
  const walk = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      const relative = path.relative(root, full).split(path.sep).join("/");
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        hash.update(relative);
        hash.update("\0");
        hash.update(await readFile(full));
        hash.update("\0");
      }
    }
  };
  await walk(path.resolve(root));
  return hash.digest("hex");
}

export function validateOfficialEvaluatorSource(source) {
  if (typeof source !== "string") throw new Error("INVALID_EVALUATOR_SOURCE:string_required");
  if (/\.decode\s*\(\s*["']gbk["']\s*\)/i.test(source)) {
    throw new Error("EVALUATOR_HARDCODED_GBK_DECODE");
  }
}

export function parseOfficialScore(output) {
  const final = /Final score:\s*([0-9.]+),\s*Correct examples:\s*(\d+),\s*Total examples:\s*(\d+)/.exec(output);
  if (!final) return undefined;
  return { score: Number(final[1]), correct: Number(final[2]), total: Number(final[3]) };
}

export function parseOfficialCaseScores(output) {
  const scores = {};
  for (const match of output.matchAll(/["']([^"']+)["']:\s*([01])(?=\s*[,}])/g)) scores[match[1]] = Number(match[2]);
  return scores;
}

export const IGNORED_STREAMING_EVENTS = new Set(["message_update", "tool_execution_update"]);
const REDUNDANT_TRACE_EVENTS = new Set([
  "message_start",
  "tool_execution_start",
  "tool_execution_end",
  "turn_end",
  "agent_end",
]);

function isCanonicalTraceEvent(event) {
  if (!event || IGNORED_STREAMING_EVENTS.has(event.type) || REDUNDANT_TRACE_EVENTS.has(event.type)) return false;
  // Tool results are already stored once in toolCalls. Keeping the mirrored
  // message_end would duplicate the complete result payload in trace.json.
  if (event.type === "message_end" && event.message?.role === "toolResult") return false;
  return true;
}

/** Mirrors the runtime marker for an unrecoverable database loss in tool result text. */
export function infrastructureFailureOf(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  for (const part of content) {
    const text = part?.type === "text" && typeof part.text === "string" ? part.text : "";
    const start = text.indexOf("DATABASE_UNAVAILABLE:");
    if (start >= 0) return text.slice(start).split(/\r?\n/, 1)[0].slice(0, 500);
  }
  return undefined;
}

export function createRecorder(harness, limits) {
  const events = [];
  const calls = [];
  const callsById = new Map();
  let turnCount = 0;
  let terminalReason = "completed";
  let limitError;
  let providerFailure;
  let infraFailure;
  let abortPromise;
  let abortFailure;
  const requestAbort = (reason) => {
    terminalReason = reason;
    if (!abortPromise) {
      abortPromise = Promise.resolve()
        .then(() => harness.abort())
        .catch((error) => { abortFailure = error; });
    }
    return abortPromise;
  };
  const stopForLimit = (reason) => {
    if (limitError) return;
    limitError = new Error(reason.toUpperCase());
    void requestAbort(reason);
  };
  const unsubscribe = harness.subscribe((event) => {
    if (isCanonicalTraceEvent(event)) events.push(JSON.parse(safeJson(event)));
    const detectedProviderFailure = extractProviderFailure(event);
    if (!providerFailure && detectedProviderFailure) {
      providerFailure = detectedProviderFailure;
      if (terminalReason === "completed") terminalReason = "provider_error";
    }
    if (event?.type === "message_start" && event.message?.role === "assistant") {
      turnCount += 1;
      if (exceedsTurnBudget(turnCount, limits.maxTurns)) stopForLimit("max_turns");
    }
    if (event?.type === "tool_execution_start") {
      const call = {
        sequence: calls.length + 1,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args ?? null,
        startedAt: Date.now(),
        isError: false,
      };
      calls.push(call);
      callsById.set(call.toolCallId, call);
      if (limits.maxToolCalls != null && Number.isFinite(Number(limits.maxToolCalls)) && Number(limits.maxToolCalls) > 0 && calls.length > Number(limits.maxToolCalls)) {
        stopForLimit("max_tool_calls");
      }
    }
    if (event?.type === "tool_execution_end") {
      const call = callsById.get(event.toolCallId);
      if (call) {
        call.finishedAt = Date.now();
        call.durationMs = call.finishedAt - call.startedAt;
        call.result = JSON.parse(safeJson(event.result ?? null));
        call.isError = Boolean(event.isError);
      }
      const failure = infrastructureFailureOf(event.result);
      if (failure && !infraFailure) {
        infraFailure = failure;
        void requestAbort("infra_error");
      }
    }
  });
  return {
    events,
    calls,
    get turnCount() { return turnCount; },
    get terminalReason() { return terminalReason; },
    get limitError() { return limitError; },
    get providerFailure() { return providerFailure; },
    /** A lost database (DATABASE_UNAVAILABLE); the case is an infrastructure failure, not a wrong answer. */
    get infraFailure() { return infraFailure; },
    unsubscribe,
    requestAbort,
    async waitForAbort() {
      await abortPromise;
      if (abortFailure) throw abortFailure;
    },
    setTerminalReason(value) { terminalReason = value; },
  };
}

export async function runPromptWithTimeout(harness, prompt, timeoutMs, recorder) {
  let timer;
  let primaryError;
  const hasTaskTimeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0;
  try {
    const execution = hasTaskTimeout
      ? Promise.race([
        harness.prompt(prompt),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => {
            void recorder.requestAbort("timeout");
            reject(new Error("TASK_TIMEOUT"));
          }, Number(timeoutMs));
        }),
      ])
      : harness.prompt(prompt);
    await execution;
    if (recorder.limitError) throw recorder.limitError;
    if (recorder.providerFailure && recorder.calls.length === 0) {
      const providerError = new Error(recorder.providerFailure.message);
      providerError.name = "ProviderError";
      providerError.providerFailure = recorder.providerFailure;
      throw providerError;
    }
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    try {
      await recorder.waitForAbort();
    } catch (abortError) {
      if (!primaryError) throw abortError;
    }
  }
}
