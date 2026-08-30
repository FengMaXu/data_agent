import { createHash } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

export const BACKENDS = ["sqlite", "bigquery", "snowflake"];

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
  return `${instance.question}\n\nAfter completing the query, use export_query to export the complete final result to ${instance.instance_id}.csv.`;
}

export function classifyProviderFailure(message) {
  if (typeof message !== "string" || !message.trim()) return undefined;
  const statusMatch = /(?:API error|HTTP|status)\s*\(?\s*(\d{3})\s*\)?/i.exec(message);
  const status = statusMatch ? Number(statusMatch[1]) : undefined;
  const providerLike = status !== undefined || /insufficient balance|invalid api key|authentication|rate limit|provider/i.test(message);
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

export function buildEvaluationGuardrails(limits, getTurnCount) {
  return {
    explorationQueryBudget: Number(limits?.maxExploratoryQueries ?? 6),
    taskProgress: () => ({ turnCount: Number(getTurnCount?.() ?? 0), maxTurns: Number(limits?.maxTurns ?? 20) }),
  };
}

export function needsDeliveryFollowUp(toolCalls, turnCount, maxTurns) {
  if (Number(turnCount) >= Number(maxTurns)) return false;
  const completed = toolCalls.filter((call) => call.finishedAt && !call.isError);
  if (completed.some((call) => call.toolName === "export_query")) return false;
  return completed.some((call) => call.toolName === "query_database"
    && call.result?.details?.warning !== "EXPLORATION_BUDGET_EXCEEDED"
    && call.result?.details?.exploratory !== true);
}

export function exceedsTurnBudget(turnCount, maxTurns) {
  return Number(turnCount) > Number(maxTurns);
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

export function selectFinalSql(toolCalls) {
  const successful = toolCalls.filter((call) => call.finishedAt
    && !call.isError
    && call.result?.details?.warning !== "EXPLORATION_BUDGET_EXCEEDED"
    && call.result?.details?.exploratory !== true
    && typeof call.args?.sql === "string"
    && call.args.sql.trim());
  const last = (name) => successful.filter((call) => call.toolName === name).at(-1);
  const selected = last("export_query") ?? last("query_database");
  if (!selected) return undefined;
  return { sql: selected.args.sql.trim(), toolCallId: selected.toolCallId, toolName: selected.toolName };
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
