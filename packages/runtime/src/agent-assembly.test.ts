import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { buildAgentTools, composeDataAgentSystemPrompt, createDataAgentHarness, normalizeAnswerSpecPlannerOutput, resolveSystemPrompt, runtimeCapabilitiesPrompt, unknownToolRecoveryMessage, type AgentAssemblyDeps, type QueryExportBatch } from "./agent-assembly.js";
import { ClarificationManager } from "./clarification.js";
import { createReviewOffQueryAssurance, InMemoryQueryAssurance, type QueryAssurance } from "./query-assurance.js";
import { WorkspaceStore } from "./workspace.js";

function exportTool(workspace: WorkspaceStore, queryExecutor: any, emitArtifact?: (path: string) => void): any {
  return buildAgentTools({ workspace, queryExecutor, emitArtifact, requireValidatedExportSql: false, requireQueryArtifactId: false }).find((tool) => tool.name === "export_query");
}

async function tempFiles(root: string): Promise<string[]> {
  try {
    return (await readdir(root, { recursive: true }) as string[]).filter((entry) => entry.endsWith(".tmp"));
  } catch {
    return [];
  }
}

describe("session workspace isolation", () => {
  it("writes identical relative paths into separate session directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-session-workspace-"));
    const workspace = new WorkspaceStore(root);
    const tool = buildAgentTools({ workspace }).find((candidate) => candidate.name === "write_file") as any;
    try {
      await tool.execute("call-a", { path: "report.txt", content: "session A" }, undefined, undefined, { sessionId: "session-A" });
      await tool.execute("call-b", { path: "report.txt", content: "session B" }, undefined, undefined, { sessionId: "session-B" });
      expect(await readFile(join(root, "session-A", "report.txt"), "utf8")).toBe("session A");
      expect(await readFile(join(root, "session-B", "report.txt"), "utf8")).toBe("session B");
      await expect(readFile(join(root, "report.txt"), "utf8")).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("runs Python with the active session directory as its working directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-session-python-"));
    const workspace = new WorkspaceStore(root);
    const tool = buildAgentTools({ workspace, pythonExecutable: process.platform === "win32" ? "python" : "python3" }).find((candidate) => candidate.name === "run_python") as any;
    try {
      await tool.execute("call-python", { code: "from pathlib import Path\nPath('chart.txt').write_text('session chart', encoding='utf-8')" }, undefined, undefined, { sessionId: "session-python" });
      expect(await readFile(join(root, "session-python", "chart.txt"), "utf8")).toBe("session chart");
      await expect(readFile(join(root, "chart.txt"), "utf8")).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("Answer Spec planner output", () => {
  it("normalizes string hypotheses and ambiguities into safe model-inference objects", () => {
    const normalized = normalizeAnswerSpecPlannerOutput({
      taskId: "task-planner-strings",
      question: "Calculate Recency and report any unresolved segmentation criteria",
    }, {
      hypotheses: ["Recency uses the latest purchase timestamp as its reference"],
      ambiguities: ["The RFM segment thresholds are not stated"],
    });

    expect(normalized.hypotheses).toEqual([{
      statement: "Recency uses the latest purchase timestamp as its reference",
      scope: "task",
      authority: "model_inference",
      source: "planner:hypotheses",
    }]);
    expect(normalized.ambiguities).toEqual([{
      question: "The RFM segment thresholds are not stated",
      alternatives: [],
      scope: "task",
      source: "planner:ambiguities",
    }]);
  });

  it("rejects malformed structured planner arrays instead of silently dropping them", () => {
    expect(() => normalizeAnswerSpecPlannerOutput({ taskId: "task-invalid-planner", question: "q" }, {
      hypotheses: { statement: "not an array" },
    })).toThrow("ANSWER_SPEC_GENERATOR_HYPOTHESES_INVALID");
    expect(() => normalizeAnswerSpecPlannerOutput({ taskId: "task-invalid-planner", question: "q" }, {
      ambiguities: [{ question: "Missing alternatives", alternatives: "a or b", scope: "task" }],
    })).toThrow("ANSWER_SPEC_GENERATOR_AMBIGUITY_ALTERNATIVES_INVALID");
  });
});

describe("native system prompt assembly", () => {
  it("uses Pi's XML skill formatter and exposes the current skill catalog", () => {
    const prompt = composeDataAgentSystemPrompt("base instructions", [{ name: "analysis", description: "Analyze data", content: "body", filePath: "C:/skills/analysis/SKILL.md" }]);
    expect(prompt).toContain("base instructions");
    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("<name>analysis</name>");
    expect(prompt).toContain("<location>C:/skills/analysis/SKILL.md</location>");
  });

  it("fails explicitly when no canonical SYSTEM.md can be found", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-no-system-prompt-"));
    try {
      await expect(resolveSystemPrompt([root], "sqlite")).rejects.toThrow("SYSTEM_PROMPT_NOT_FOUND");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("injects the active database dialect instead of a global MySQL assumption", async () => {
    const prompt = await resolveSystemPrompt([path.resolve(process.cwd(), "../..")], "sqlite");
    expect(prompt).toContain("数据库后端为 SQLite");
    expect(prompt).toContain("sqlite_master");
    expect(prompt).toContain("### 1.4 交付前检查（Query Assurance）");
    expect(prompt).toContain("使用准确的 `queryArtifactId`");
    expect(prompt).toContain("The only sources of truth are the user's inquiry and the business documentation");
    expect(prompt).toContain("Guessing or fabricating non-existent business rules is strictly prohibited");
    expect(prompt).toContain("若该工具不在当前工具列表中");
    expect(prompt).not.toContain("数据库为 MySQL 业务库");
  });

  it("turns native unknown-tool errors into canonical recovery guidance", () => {
    const guidance = unknownToolRecoveryMessage("Tool read_knowledge_file not found", ["search_knowledge", "read_knowledge", "query_database"]);
    expect(guidance).toContain('Tool "read_knowledge_file" does not exist');
    expect(guidance).toContain("Available tools: search_knowledge, read_knowledge, query_database");
    expect(guidance).toContain("Do not retry");
    expect(unknownToolRecoveryMessage("SQL_SYNTAX_ERROR", ["query_database"])).toBeUndefined();
  });

  it("gives a literal no-guessing fallback when clarification is unavailable", () => {
    const guidance = unknownToolRecoveryMessage("Tool ask_user_clarification not found", ["query_database", "export_query"]);
    expect(guidance).toContain("Clarification is unavailable in this runtime");
    expect(guidance).toContain("most literal reading");
    expect(guidance).toContain("never invent thresholds");
  });

  it("lists the exact runtime tool surface for unknown-tool recovery", () => {
    const prompt = runtimeCapabilitiesPrompt(["query_database", "export_query", "read_knowledge"]);
    expect(prompt).toContain("Available tools: query_database, export_query, read_knowledge");
    expect(prompt).toContain("Never call an absent tool");
    expect(prompt).toContain("Unavailable tools:");
    expect(prompt).toContain("ask_user_clarification");
    expect(prompt).toContain("Clarification is unavailable in this session");
    expect(prompt).not.toContain("read_knowledge_file");
  });

  it("accepts one QueryAssurance dependency at the assembly boundary", async () => {
    const workspace = new WorkspaceStore("/tmp/data-agent-query-assurance-dependency");
    const queryAssurance: QueryAssurance = {
      mode: "shadow",
      prepareTask: async (_input, _signal) => ({ taskId: "task-1", mode: "shadow" }),
      recordPreview: async ({ task }, _signal) => ({
        taskId: task.taskId,
        queryArtifactId: "artifact-1",
        normalizedSql: "SELECT 1 AS answer",
        normalizedSqlHash: "hash",
        previewMetadata: { columns: ["answer"], columnTypes: ["INTEGER"], rowCount: 1, truncated: false, nullCounts: { answer: 0 } },
        internalEvidence: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-01T00:05:00.000Z",
      }),
      reviewForPublication: async (_input, _signal) => ({ availability: "unavailable", failure: { code: "TEST", message: "not configured", retryable: false } }),
    };
    const deps: AgentAssemblyDeps = {
      workspace,
      queryAssurance,
      queryExecutor: { run: async () => ({ columns: [], rows: [], truncated: false }) },
    };

    const tools = buildAgentTools(deps);
    expect(tools.map((tool) => tool.name)).toContain("query_database");
    const query = tools.find((tool) => tool.name === "query_database") as any;
    const result = await query.execute("assurance-query", { sql: "SELECT 1 AS answer" }, undefined, undefined, { sessionId: "session-a", taskId: "task-1" });
    expect(result.details).toMatchObject({ taskId: "task-1", internalEvidence: true });
  });

  it("does not expose optional or unavailable capabilities", () => {
    const workspace = new WorkspaceStore("/tmp/data-agent-capabilities");
    const minimalNames = buildAgentTools({ workspace }).map((tool) => tool.name);
    expect(minimalNames).not.toContain("run_python");
    expect(minimalNames).toContain("show_widget");
    expect(minimalNames).toContain("generate_dashboard");

    const queryOnlyNames = buildAgentTools({ workspace, pythonExecutable: "python", enableWidgets: false, enableDashboards: false }).map((tool) => tool.name);
    expect(queryOnlyNames).toContain("run_python");
    expect(queryOnlyNames).not.toContain("show_widget");
    expect(queryOnlyNames).not.toContain("generate_dashboard");
  });

  it("hides Python when a dynamic Python source is unavailable", () => {
    const tools = buildAgentTools({ workspace: new WorkspaceStore("/tmp/data-agent-python-unavailable"), pythonExecutable: () => undefined });
    expect(tools.some((candidate) => candidate.name === "run_python")).toBe(false);
  });

  it("gives a permanent no-retry instruction when a configured Python executable is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-python-missing-"));
    const tool = buildAgentTools({ workspace: new WorkspaceStore(root), pythonExecutable: "definitely-missing-python-executable" }).find((candidate) => candidate.name === "run_python") as any;
    try {
      await expect(tool.execute("call-python-unavailable", { code: "print(1)" })).rejects.toThrow("Do NOT call run_python again");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("isolates repeated-error guidance between sessions", async () => {
    const tool = buildAgentTools({
      workspace: new WorkspaceStore("/tmp/data-agent-session-error-isolation"),
      queryExecutor: { run: async () => { throw new Error("SQL_SYNTAX_ERROR"); } },
    }).find((candidate) => candidate.name === "query_database") as any;
    await expect(tool.execute("a-1", { sql: "SELECT bad" }, undefined, undefined, { sessionId: "a" })).rejects.toThrow("SQL_SYNTAX_ERROR");
    await expect(tool.execute("a-2", { sql: "SELECT bad" }, undefined, undefined, { sessionId: "a" })).rejects.toThrow("SQL_SYNTAX_ERROR");
    await expect(tool.execute("b-1", { sql: "SELECT bad" }, undefined, undefined, { sessionId: "b" })).rejects.not.toThrow("Stop repeating");
    await expect(tool.execute("a-3", { sql: "SELECT bad" }, undefined, undefined, { sessionId: "a" })).rejects.toThrow("Stop repeating the same call");
  });

  it("adds a strategy-switch instruction after repeated identical tool errors", async () => {
    const tool = buildAgentTools({
      workspace: new WorkspaceStore("/tmp/data-agent-repeated-error"),
      queryExecutor: { run: async () => { throw new Error("SQL_SYNTAX_ERROR"); } },
    }).find((candidate) => candidate.name === "query_database") as any;
    await expect(tool.execute("call-error-1", { sql: "SELECT bad" })).rejects.toThrow("SQL_SYNTAX_ERROR");
    await expect(tool.execute("call-error-2", { sql: "SELECT bad" })).rejects.toThrow("SQL_SYNTAX_ERROR");
    await expect(tool.execute("call-error-3", { sql: "SELECT bad" })).rejects.toThrow("Stop repeating the same call");
  });
});

describe("generate_dashboard", () => {
  it("builds a standalone V3 dashboard from a session CSV instead of a V4 semantic shell", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-dashboard-v3-"));
    const workspace = new WorkspaceStore(root);
    const session = await workspace.scoped("session-dashboard");
    await session.write("data/sales.csv", "行业,销售额,增速\n批发业,100,10\n零售业,40,20\n");
    const tool = buildAgentTools({ workspace }).find((candidate) => candidate.name === "generate_dashboard") as any;
    const spec = {
      version: "3",
      title: "行业看板",
      filename: "industry_dashboard",
      datasets: [{ id: "sales", source: { type: "csv", path: "data/sales.csv" }, schema: [] }],
      views: [
        { id: "kpis", type: "metric_cards", title: "核心指标", cards: [{ label: "累计销售额", value: "140" }] },
        { id: "sales_chart", type: "chart", title: "行业销售额", dataset: "sales", x: { field: "行业", type: "category" }, axes: [{ id: "sales_axis", orient: "y", name: "销售额" }], series: [{ name: "销售额", field: "销售额", mark: "bar", axis: "sales_axis" }] },
        { id: "detail", type: "table", title: "明细", dataset: "sales", columns: [{ field: "行业", label: "行业" }, { field: "销售额", label: "销售额" }] },
      ],
    };
    try {
      const result = await tool.execute("call-dashboard", { operation: "create", mode: "static", version: "v3", spec }, undefined, undefined, { sessionId: "session-dashboard" });
      const html = await readFile(join(root, "session-dashboard", "dashboards", "industry_dashboard.html"), "utf8");
      expect(html).toContain("window.__DASHBOARD__");
      expect(html).toContain("行业销售额");
      expect(html).not.toContain("__SEMANTIC_DASHBOARD__");
      expect(result.content[0].text).toContain("/workspace/files/download?path=");
      expect(result.details).toMatchObject({ fileType: "html", relativePath: "dashboards/industry_dashboard.html" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("query task guardrails", () => {
  it("stops executing exploratory SQL after the per-session budget is exhausted", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-exploration-budget-"));
    let executions = 0;
    const tools = buildAgentTools({
      workspace: new WorkspaceStore(root),
      explorationQueryBudget: 2,
      queryExecutor: {
        run: async () => {
          executions++;
          return { columns: ["id"], rows: [[1]], truncated: false };
        },
      },
    });
    const query = tools.find((candidate) => candidate.name === "query_database") as any;
    try {
      await query.execute("explore-1", { sql: "SELECT * FROM users LIMIT 5" }, undefined, undefined, { sessionId: "session-a" });
      await query.execute("explore-2", { sql: "SELECT DISTINCT state FROM users" }, undefined, undefined, { sessionId: "session-a" });
      const blocked = await query.execute("explore-3", { sql: "SELECT name FROM sqlite_master WHERE type='table'" }, undefined, undefined, { sessionId: "session-a" });
      expect(executions).toBe(2);
      expect(blocked.content[0].text).toContain("Stop exploring and write your final analytical SQL now");
      expect(blocked.details).toMatchObject({ warning: "EXPLORATION_BUDGET_EXCEEDED", exploratoryCount: 2, limit: 2 });
      await query.execute("final-full", { sql: "SELECT * FROM users" }, undefined, undefined, { sessionId: "session-a" });
      await query.execute("final-distinct", { sql: "SELECT DISTINCT customer_id FROM orders WHERE status = 'paid'" }, undefined, undefined, { sessionId: "session-a" });
      await query.execute("other-session", { sql: "SELECT * FROM users LIMIT 5" }, undefined, undefined, { sessionId: "session-b" });
      expect(executions).toBe(5);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resets delivery reminders when a new query starts after a completed export", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-export-deadline-reset-"));
    const executor = {
      run: async () => ({ columns: ["answer"], rows: [[1]], truncated: false }),
      stream: async function* (): AsyncGenerator<QueryExportBatch> { yield { columns: ["answer"], rows: [[1]] }; },
    };
    const tools = buildAgentTools({
      workspace: new WorkspaceStore(root),
      taskProgress: () => ({ turnCount: 12, maxTurns: 20 }),
      queryExecutor: executor,
      requireQueryArtifactId: false,
    });
    const query = tools.find((candidate) => candidate.name === "query_database") as any;
    const exportQuery = tools.find((candidate) => candidate.name === "export_query") as any;
    try {
      await query.execute("first-query", { sql: "SELECT 1 AS answer" }, undefined, undefined, { sessionId: "session-a" });
      await exportQuery.execute("first-export", {
        sql: "SELECT 1 AS answer",
        expected_rows: "scalar",
        expected_columns: ["answer"],
      }, undefined, undefined, { sessionId: "session-a" });
      const nextTask = await query.execute("next-query", { sql: "SELECT 2 AS answer" }, undefined, undefined, { sessionId: "session-a" });
      expect(nextTask.content[0].text).toContain("EXPORT_DEADLINE");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reminds the model to export after sixty percent of the turn budget", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-export-deadline-"));
    const query = buildAgentTools({
      workspace: new WorkspaceStore(root),
      taskProgress: () => ({ turnCount: 12, maxTurns: 20 }),
      queryExecutor: {
        run: async () => ({ columns: ["answer"], rows: [[107]], truncated: false }),
      },
    }).find((candidate) => candidate.name === "query_database") as any;
    try {
      const result = await query.execute("late-query", { sql: "SELECT COUNT(*) AS answer FROM actors WHERE qualified = 1" }, undefined, undefined, { sessionId: "session-a" });
      expect(result.content[0].text).toContain("12/20 turns");
      expect(result.content[0].text).toContain("call export_query immediately");
      expect(result.details).toMatchObject({ exportReminder: true, turnCount: 12, maxTurns: 20 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("validation tools", () => {
  it("validates an existing Artifact with EXPLAIN and keeps semantic review advisory", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-validation-tools-"));
    const assurance = createReviewOffQueryAssurance();
    const task = await assurance.prepareTask({ question: "What is the answer?", dialect: "sqlite" }, new AbortController().signal);
    let explainCalls = 0;
    const tools = buildAgentTools({
      workspace: new WorkspaceStore(root),
      databaseDialect: "sqlite",
      queryAssurance: assurance,
      queryExecutor: {
        run: async () => ({ columns: ["answer"], rows: [[1]], truncated: false }),
        explain: async () => { explainCalls += 1; return { columns: ["detail"], rows: [["SCAN CONSTANT ROW"]], truncated: false }; },
      },
    });
    const query = tools.find((candidate) => candidate.name === "query_database") as any;
    const sqlValidate = tools.find((candidate) => candidate.name === "sql_validate") as any;
    const semanticValidate = tools.find((candidate) => candidate.name === "semantic_validate") as any;
    try {
      const preview = await query.execute("validation-preview", { sql: "SELECT 1 AS answer" }, undefined, undefined, { sessionId: "session-a", taskId: task.taskId, specVersion: task.specVersion });
      const sqlResult = await sqlValidate.execute("sql-validate", { queryArtifactId: preview.details.queryArtifactId }, undefined, undefined, { sessionId: "session-a", taskId: task.taskId, specVersion: task.specVersion });
      expect(sqlResult.details).toMatchObject({ status: "valid", queryArtifactId: preview.details.queryArtifactId, explain: { columns: ["detail"] } });
      expect(explainCalls).toBe(1);
      const semanticResult = await semanticValidate.execute("semantic-validate", { queryArtifactId: preview.details.queryArtifactId }, undefined, undefined, { sessionId: "session-a", taskId: task.taskId, specVersion: task.specVersion });
      expect(semanticResult.details).toMatchObject({ status: "advisory", queryArtifactId: preview.details.queryArtifactId });
      expect(semanticResult.content[0].text).toContain("Do not retry semantic_validate");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("export_query", () => {
  it("publishes the exact Query Artifact through a Review Token", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-export-artifact-"));
    const workspace = new WorkspaceStore(root);
    const assurance = createReviewOffQueryAssurance();
    const task = await assurance.prepareTask({ question: "What is the answer?" }, new AbortController().signal);
    const tools = buildAgentTools({
      workspace,
      queryAssurance: assurance,
      databaseDialect: "sqlite",
      queryExecutor: {
        run: async () => ({ columns: ["answer"], rows: [[1]], truncated: false }),
        stream: async function* (): AsyncGenerator<QueryExportBatch> { yield { columns: ["answer"], rows: [[1]] }; },
      },
    });
    const query = tools.find((candidate) => candidate.name === "query_database") as any;
    const exportQuery = tools.find((candidate) => candidate.name === "export_query") as any;
    try {
      const preview = await query.execute("artifact-preview", { sql: "SELECT 1 AS answer" }, undefined, undefined, { sessionId: "session-a", taskId: task.taskId, specVersion: task.specVersion });
      const queryArtifactId = preview.details.queryArtifactId;
      expect(queryArtifactId).toBeTruthy();
      const result = await exportQuery.execute("artifact-export", {
        queryArtifactId,
        filename: "exports/artifact.csv",
        expected_rows: "scalar",
        expected_columns: ["answer"],
      }, undefined, undefined, { sessionId: "session-a", taskId: task.taskId, specVersion: task.specVersion });
      expect(result.details).toMatchObject({ taskComplete: true, publicationReceipt: { status: "published_with_disagreement", queryArtifactId } });
      expect(await readFile(join(root, "session-a", "exports", "artifact.csv"), "utf8")).toBe("answer\n1");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("terminates an export turn when review is unavailable instead of retrying the provider turn", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-export-review-unavailable-"));
    const assurance = new InMemoryQueryAssurance({ mode: "shadow" });
    const task = await assurance.prepareTask({ question: "What is the answer?" }, new AbortController().signal);
    const tools = buildAgentTools({
      workspace: new WorkspaceStore(root),
      queryAssurance: assurance,
      databaseDialect: "sqlite",
      queryExecutor: {
        run: async () => ({ columns: ["answer"], rows: [[1]], truncated: false }),
        stream: async function* (): AsyncGenerator<QueryExportBatch> { yield { columns: ["answer"], rows: [[1]] }; },
      },
    });
    const query = tools.find((candidate) => candidate.name === "query_database") as any;
    const exportQuery = tools.find((candidate) => candidate.name === "export_query") as any;
    try {
      const preview = await query.execute("unavailable-preview", { sql: "SELECT 1 AS answer" }, undefined, undefined, { sessionId: "session-a", taskId: task.taskId, specVersion: task.specVersion });
      const result = await exportQuery.execute("unavailable-export", {
        queryArtifactId: preview.details.queryArtifactId,
        filename: "exports/unavailable.csv",
        expected_rows: "scalar",
        expected_columns: ["answer"],
      }, undefined, undefined, { sessionId: "session-a", taskId: task.taskId, specVersion: task.specVersion });
      expect(result.details).toMatchObject({ status: "blocked", terminal: true, queryArtifactId: preview.details.queryArtifactId });
      expect(result.content[0].text).toContain("do not retry export_query");
      await expect(readFile(join(root, "session-a", "exports", "unavailable.csv"), "utf8")).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("publishes a small Query Artifact inline through the same Receipt path", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-inline-result-"));
    const workspace = new WorkspaceStore(root);
    const assurance = createReviewOffQueryAssurance();
    const task = await assurance.prepareTask({ question: "What is the answer?" }, new AbortController().signal);
    const tools = buildAgentTools({
      workspace,
      queryAssurance: assurance,
      queryExecutor: { run: async () => ({ columns: ["answer"], rows: [[1]], truncated: false }) },
    });
    const query = tools.find((candidate) => candidate.name === "query_database") as any;
    const publish = tools.find((candidate) => candidate.name === "publish_query_result") as any;
    try {
      const preview = await query.execute("inline-preview", { sql: "SELECT 1 AS answer" }, undefined, undefined, { sessionId: "session-a", taskId: task.taskId, specVersion: task.specVersion });
      const result = await publish.execute("inline-publish", { queryArtifactId: preview.details.queryArtifactId }, undefined, undefined, { sessionId: "session-a", taskId: task.taskId, specVersion: task.specVersion });
      expect(result.details).toMatchObject({ publishedInline: true, taskComplete: true, publicationReceipt: { status: "published_with_disagreement" } });
      expect(result.content[0].text).toContain("PUBLISHED_INLINE");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a scalar declaration that produces multiple rows without publishing a file", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-export-scalar-shape-"));
    const workspace = new WorkspaceStore(root);
    const tool = exportTool(workspace, {
      stream: async function* (): AsyncGenerator<QueryExportBatch> {
        yield { columns: ["name"], rows: [["Ada"], ["Grace"]] };
      },
      run: async () => { throw new Error("run should not be used"); },
    });
    try {
      await expect(tool.execute("shape-scalar", {
        sql: "SELECT name FROM users",
        filename: "exports/scalar.csv",
        expected_rows: "scalar",
        expected_columns: ["name"],
      })).rejects.toThrow("SHAPE_MISMATCH: declared scalar but query produced more than 1 row");
      await expect(workspace.read("exports/scalar.csv")).rejects.toThrow();
      expect(await tempFiles(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("exports only the last SQL validated in the same session", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-export-validated-sql-"));
    const workspace = new WorkspaceStore(root);
    const executor = {
      run: async (sql: string) => ({ columns: ["id"], rows: sql.includes("WHERE") ? [[1]] : [[1], [2]], truncated: false }),
      stream: async function* (sql: string): AsyncGenerator<QueryExportBatch> {
        yield { columns: ["id"], rows: sql.includes("WHERE") ? [[1]] : [[1], [2]] };
      },
    };
    const tools = buildAgentTools({ workspace, queryExecutor: executor, requireQueryArtifactId: false });
    const query = tools.find((candidate) => candidate.name === "query_database") as any;
    const exportQuery = tools.find((candidate) => candidate.name === "export_query") as any;
    const finalSql = "SELECT id FROM users WHERE active = 1";
    try {
      await expect(exportQuery.execute("unvalidated", {
        sql: finalSql,
        expected_rows: "scalar",
        expected_columns: ["id"],
      }, undefined, undefined, { sessionId: "session-a" })).rejects.toThrow("EXPORT_SQL_NOT_VALIDATED");
      await query.execute("preview", { sql: finalSql }, undefined, undefined, { sessionId: "session-a" });
      await expect(exportQuery.execute("changed", {
        sql: "SELECT id FROM users WHERE active = 0",
        expected_rows: "scalar",
        expected_columns: ["id"],
      }, undefined, undefined, { sessionId: "session-a" })).rejects.toThrow("EXPORT_SQL_NOT_VALIDATED");
      await expect(exportQuery.execute("cross-session", {
        sql: finalSql,
        expected_rows: "scalar",
        expected_columns: ["id"],
      }, undefined, undefined, { sessionId: "session-b" })).rejects.toThrow("EXPORT_SQL_NOT_VALIDATED");
      await expect(exportQuery.execute("validated", {
        sql: `${finalSql};`,
        filename: "exports/validated.csv",
        expected_rows: "scalar",
        expected_columns: ["id"],
      }, undefined, undefined, { sessionId: "session-a" })).resolves.toMatchObject({ details: { taskComplete: true, rowCount: 1 } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects the legacy SQL export contract by default", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-export-legacy-contract-"));
    const exportQuery = buildAgentTools({
      workspace: new WorkspaceStore(root),
      queryExecutor: { run: async () => ({ columns: ["id"], rows: [[1]], truncated: false }) },
    }).find((candidate) => candidate.name === "export_query") as any;
    try {
      await expect(exportQuery.execute("legacy-contract", { sql: "SELECT id FROM users", expected_rows: "full", expected_columns: ["id"] })).rejects.toThrow("EXPORT_QUERY_REQUIRES_QUERY_ARTIFACT_ID");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("requires a shape declaration before starting the export stream", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-export-shape-required-"));
    let streams = 0;
    const tool = exportTool(new WorkspaceStore(root), {
      stream: async function* (): AsyncGenerator<QueryExportBatch> {
        streams++;
        yield { columns: ["id"], rows: [[1]] };
      },
      run: async () => { throw new Error("run should not be used"); },
    });
    try {
      await expect(tool.execute("shape-required", { sql: "SELECT id FROM users" })).rejects.toThrow(
        "SHAPE_DECLARATION_INVALID: expected_rows is required",
      );
      await expect(tool.execute("columns-required", { sql: "SELECT id FROM users", expected_rows: "full" })).rejects.toThrow(
        "SHAPE_DECLARATION_INVALID: expected_columns is required",
      );
      expect(streams).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects top_n without a row count and enforces the declared tolerance", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-export-topn-shape-"));
    const workspace = new WorkspaceStore(root);
    let streams = 0;
    const tool = exportTool(workspace, {
      stream: async function* (): AsyncGenerator<QueryExportBatch> {
        streams++;
        yield { columns: ["id"], rows: [[1], [2], [3], [4]] };
      },
      run: async () => { throw new Error("run should not be used"); },
    });
    try {
      await expect(tool.execute("shape-topn-missing", {
        sql: "SELECT id FROM users",
        expected_rows: "top_n",
      })).rejects.toThrow("SHAPE_DECLARATION_INVALID: expected_row_count is required for top_n");
      expect(streams).toBe(0);
      await expect(tool.execute("shape-topn-large", {
        sql: "SELECT id FROM users",
        filename: "exports/topn.csv",
        expected_rows: "top_n",
        expected_row_count: 2,
        expected_columns: ["id"],
      })).rejects.toThrow("SHAPE_MISMATCH: declared top_n maximum=2 but query produced more than 2 rows");
      await expect(workspace.read("exports/topn.csv")).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("requires an independent reconciliation query before exporting a JOIN aggregate", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-join-reconciliation-"));
    const workspace = new WorkspaceStore(root);
    const executor = {
      run: async () => ({ columns: ["answer"], rows: [[1]], truncated: false }),
      stream: async function* (): AsyncGenerator<QueryExportBatch> { yield { columns: ["answer"], rows: [[1]] }; },
    };
    const tools = buildAgentTools({ workspace, queryExecutor: executor, requireJoinReconciliation: true, requireQueryArtifactId: false });
    const query = tools.find((candidate) => candidate.name === "query_database") as any;
    const exportQuery = tools.find((candidate) => candidate.name === "export_query") as any;
    const finalSql = "SELECT u.id, SUM(o.amount) AS total FROM users u JOIN orders o ON o.user_id = u.id GROUP BY u.id";
    try {
      await query.execute("join-final", { sql: finalSql }, undefined, undefined, { sessionId: "session-a" });
      await expect(exportQuery.execute("join-export-before-audit", {
        sql: finalSql,
        filename: "exports/join.csv",
        expected_rows: "grouped",
        expected_row_count: 1,
        expected_columns: ["answer"],
      }, undefined, undefined, { sessionId: "session-a" })).rejects.toThrow("JOIN_RECONCILIATION_REQUIRED");
      const reconciliationSql = "SELECT COUNT(*) AS joined_rows, SUM(amount) AS joined_total FROM users u JOIN orders o ON o.user_id = u.id";
      const reconciliation = await query.execute("join-reconciliation", {
        sql: reconciliationSql,
        purpose: "reconciliation",
      }, undefined, undefined, { sessionId: "session-a" });
      expect(reconciliation.content[0].text).toContain("RECONCILIATION_RECORDED");
      await expect(exportQuery.execute("join-export", {
        sql: `${finalSql};`,
        filename: "exports/join.csv",
        expected_rows: "grouped",
        expected_row_count: 1,
        expected_columns: ["answer"],
      }, undefined, undefined, { sessionId: "session-a" })).resolves.toMatchObject({ details: { taskComplete: true } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("records verification queries without replacing the final export SQL", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-verification-purpose-"));
    const workspace = new WorkspaceStore(root);
    const executor = {
      run: async () => ({ columns: ["answer"], rows: [[1]], truncated: false }),
      stream: async function* (): AsyncGenerator<QueryExportBatch> { yield { columns: ["answer"], rows: [[1]] }; },
    };
    const tools = buildAgentTools({ workspace, queryExecutor: executor, requireQueryArtifactId: false });
    const query = tools.find((candidate) => candidate.name === "query_database") as any;
    const exportQuery = tools.find((candidate) => candidate.name === "export_query") as any;
    try {
      await query.execute("final", { sql: "SELECT 1 AS answer" }, undefined, undefined, { sessionId: "session-a" });
      const verification = await query.execute("verification", { sql: "SELECT 1 AS independently_verified", purpose: "verification" }, undefined, undefined, { sessionId: "session-a" });
      expect(verification.content[0].text).toContain("VERIFICATION_RECORDED");
      await expect(exportQuery.execute("export", {
        sql: "SELECT 1 AS answer",
        filename: "exports/verified.csv",
        expected_rows: "scalar",
        expected_columns: ["answer"],
      }, undefined, undefined, { sessionId: "session-a" })).resolves.toMatchObject({ details: { taskComplete: true } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("enforces an optional grouped row-count ceiling", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-export-grouped-shape-"));
    const workspace = new WorkspaceStore(root);
    const tool = exportTool(workspace, {
      stream: async function* (): AsyncGenerator<QueryExportBatch> {
        yield { columns: ["period", "value"], rows: [["2024-01", 1], ["2024-02", 2], ["2024-03", 3]] };
      },
      run: async () => { throw new Error("run should not be used"); },
    });
    try {
      await expect(tool.execute("grouped-too-many", {
        sql: "SELECT period, SUM(value) AS value FROM metrics GROUP BY period",
        filename: "exports/grouped.csv",
        expected_rows: "grouped",
        expected_row_count: 2,
        expected_columns: ["period", "value"],
      })).rejects.toThrow("SHAPE_MISMATCH: declared grouped maximum=2 but query produced more than 2 rows");
      await expect(workspace.read("exports/grouped.csv")).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("requires exactly one scalar row and rejects row-width mismatches", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-export-row-shape-"));
    const workspace = new WorkspaceStore(root);
    const empty = exportTool(workspace, {
      stream: async function* (): AsyncGenerator<QueryExportBatch> { yield { columns: ["answer"], rows: [] }; },
      run: async () => { throw new Error("run should not be used"); },
    });
    const malformed = exportTool(workspace, {
      stream: async function* (): AsyncGenerator<QueryExportBatch> { yield { columns: ["id"], rows: [[1, "extra"]] }; },
      run: async () => { throw new Error("run should not be used"); },
    });
    try {
      await expect(empty.execute("empty-scalar", {
        sql: "SELECT answer",
        expected_rows: "scalar",
        expected_columns: ["answer"],
      })).rejects.toThrow("SHAPE_MISMATCH: declared scalar but query produced 0 rows");
      await expect(malformed.execute("malformed-width", {
        sql: "SELECT id",
        expected_rows: "full",
        expected_columns: ["id"],
      })).rejects.toThrow("SHAPE_MISMATCH: row width 2 does not match 1 columns");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("enforces the expected column whitelist before publishing a file", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-export-column-shape-"));
    const workspace = new WorkspaceStore(root);
    const tool = exportTool(workspace, {
      stream: async function* (): AsyncGenerator<QueryExportBatch> {
        yield { columns: ["id", "diagnostic_count"], rows: [[1, 42]] };
      },
      run: async () => { throw new Error("run should not be used"); },
    });
    try {
      await expect(tool.execute("shape-columns", {
        sql: "SELECT id, diagnostic_count FROM users",
        filename: "exports/columns.csv",
        expected_rows: "scalar",
        expected_columns: ["id"],
      })).rejects.toThrow("SHAPE_MISMATCH: expected columns [id] but query returned [id, diagnostic_count]");
      await expect(workspace.read("exports/columns.csv")).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("streams a 100,000-row result and preserves CSV escaping", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-export-stream-"));
    const workspace = new WorkspaceStore(root);
    const batches = async function* (): AsyncGenerator<QueryExportBatch> {
      for (let offset = 0; offset < 100_000; offset += 1_000) {
        yield {
          columns: ["id", "value"],
          rows: Array.from({ length: 1_000 }, (_, index) => [offset + index + 1, index === 98 ? "comma,value" : `row-${offset + index + 1}`]),
        };
      }
    };
    const artifacts: string[] = [];
    const tool = exportTool(workspace, { stream: () => batches(), run: async () => { throw new Error("run should not be used"); } }, (path) => artifacts.push(path));
    try {
      await tool.execute("call-1", { sql: "SELECT id, value FROM rows", filename: "exports/large.csv", expected_rows: "full", expected_columns: ["id", "value"] });
      const content = await readFile(join(root, "exports", "large.csv"), "utf8");
      expect(content.split("\n")).toHaveLength(100_001);
      expect(content.startsWith("id,value\n1,\"row-1\"\n2,\"row-2\"\n")).toBe(true);
      expect(content).toContain("99,\"comma,value\"");
      expect(artifacts).toEqual(["exports/large.csv"]);
      expect(await tempFiles(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("writes a header for an empty streamed result and marks delivery complete", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-export-empty-"));
    const workspace = new WorkspaceStore(root);
    const tool = exportTool(workspace, {
      stream: async function* (): AsyncGenerator<QueryExportBatch> {
        yield { columns: ["id", "name"], rows: [] };
      },
      run: async () => { throw new Error("run should not be used"); },
    });
    try {
      const result = await tool.execute("call-empty", { sql: "SELECT id, name FROM users WHERE 1 = 0", filename: "exports/empty.csv", expected_rows: "full", expected_columns: ["id", "name"] });
      expect(await readFile(join(root, "exports", "empty.csv"), "utf8")).toBe("id,name");
      expect(result.content[0].text).toContain("TASK_COMPLETE");
      expect(result.details).toMatchObject({ rowCount: 0, taskComplete: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("escapes embedded quotes and newlines according to RFC 4180", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-export-csv-"));
    const workspace = new WorkspaceStore(root);
    const tool = exportTool(workspace, {
      stream: async function* (): AsyncGenerator<QueryExportBatch> {
        yield { columns: ["name", "note"], rows: [["Ada", "say \"hello\"\nthen leave"]] };
      },
      run: async () => { throw new Error("run should not be used"); },
    });
    try {
      await tool.execute("call-csv", { sql: "SELECT name, note", filename: "exports/escaped.csv", expected_rows: "full", expected_columns: ["name", "note"] });
      expect(await readFile(join(root, "exports", "escaped.csv"), "utf8")).toBe(
        "name,note\n\"Ada\",\"say \"\"hello\"\"\nthen leave\"",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses native skill invocation for the model-visible load_skill tool", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-load-skill-"));
    const workspace = new WorkspaceStore(root);
    const calls: string[] = [];
    const tool = buildAgentTools({
      workspace,
      invokeSkill: async (name) => {
        calls.push(name);
        return { content: [{ type: "text", text: "native result" }] };
      },
    }).find((candidate) => candidate.name === "load_skill") as any;
    try {
      const result = await tool.execute("call-skill", { name: "analysis" });
      expect(calls).toEqual(["analysis"]);
      expect(result.content).toEqual([{ type: "text", text: "native result" }]);
      expect(result.details).toEqual({ nativeSkill: "analysis" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("routes OpenRouter profiles through the OpenRouter Chat Completions provider", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-openrouter-profile-"));
    const harness = await createDataAgentHarness({
      workspace: new WorkspaceStore(root),
      projectRoot: path.resolve(process.cwd(), "../.."),
      systemPrompt: "test",
    }, {
      provider: "openrouter",
      model: "qwen/qwen3.8-max",
      apiKey: "test",
      baseUrl: "https://openrouter.ai/api/v1",
      apiFormat: "chat",
      reasoning: true,
      thinkingLevelMap: { off: "low" },
    });
    try {
      expect(harness.getModel()).toMatchObject({
        provider: "openrouter",
        api: "openai-completions",
        baseUrl: "https://openrouter.ai/api/v1",
        reasoning: true,
        thinkingLevelMap: { off: "low" },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("loads skill instructions from resources without recursively running the busy harness", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-load-skill-resource-"));
    const harness = await createDataAgentHarness({
      workspace: new WorkspaceStore(root),
      projectRoot: path.resolve(process.cwd(), "../.."),
      systemPrompt: "test",
      toolContext: { sessionId: "session-skill" },
    }, { provider: "openai", model: "test", apiKey: "test" });
    try {
      const tool = harness.getTools().find((candidate) => candidate.name === "load_skill") as any;
      const result = await tool.execute("call-dashboard-skill", { name: "dashboard" }, undefined, undefined, { sessionId: "session-skill" });
      expect(result.content[0].text).toContain("HTML BI");
      expect(result.details).toEqual({ nativeSkill: "dashboard" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("applies a task-local clarification to the active Answer Spec version", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-clarification-spec-"));
    const workspace = new WorkspaceStore(root);
    const manager = new ClarificationManager(5000);
    let clarificationId = "";
    manager.onAsked = (request) => { clarificationId = request.clarificationId; };
    const assurance = createReviewOffQueryAssurance();
    const task = await assurance.prepareTask({ question: "Which population?" }, new AbortController().signal);
    let changed: string | undefined;
    const tool = buildAgentTools({ workspace, clarifications: manager, queryAssurance: assurance, onTaskSpecVersionChanged: (_taskId, version) => { changed = version; } }).find((candidate) => candidate.name === "ask_user_clarification") as any;
    try {
      const pending = tool.execute("call-clarification-spec", { question: "Include customers with no orders?" }, undefined, undefined, { sessionId: "session-42", taskId: task.taskId, specVersion: task.specVersion });
      expect(clarificationId).not.toBe("");
      expect(manager.answer(clarificationId, "Yes, include them")).toBe(true);
      await expect(pending).resolves.toMatchObject({ details: { taskId: task.taskId, specVersion: "2" } });
      expect(changed).toBe("2");
      expect(assurance.getAnswerSpec?.(task.taskId, "2")?.hardConstraints.at(-1)?.statement).toBe("Yes, include them");
    } finally {
      manager.dropAll();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses the native per-turn session for clarification requests", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-clarification-context-"));
    const workspace = new WorkspaceStore(root);
    const manager = new ClarificationManager(5000);
    let clarificationId = "";
    manager.onAsked = (request) => { clarificationId = request.clarificationId; };
    const tool = buildAgentTools({ workspace, clarifications: manager }).find((candidate) => candidate.name === "ask_user_clarification") as any;
    try {
      const pending = tool.execute("call-clarification", { question: "Which region?" }, undefined, undefined, { sessionId: "session-42" });
      expect(clarificationId).not.toBe("");
      expect(manager.isPending("session-42")).toBe(true);
      expect(manager.isPending("web")).toBe(false);
      expect(manager.answer(clarificationId, "north")).toBe(true);
      await expect(pending).resolves.toMatchObject({ content: [{ text: "north" }] });
    } finally {
      manager.dropAll();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps legacy executors bounded instead of requesting a full result copy", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-export-legacy-"));
    const workspace = new WorkspaceStore(root);
    let requestedLimit: number | undefined;
    const tool = exportTool(workspace, {
      run: async (_sql: string, limit: number) => {
        requestedLimit = limit;
        return { columns: ["id"], rows: [[1]], truncated: true };
      },
    });
    try {
      await expect(tool.execute("call-legacy", { sql: "SELECT id", filename: "exports/legacy.csv", expected_rows: "full", expected_columns: ["id"] })).rejects.toThrow("EXPORT_STREAM_REQUIRED");
      expect(requestedLimit).toBe(50);
      expect(await tempFiles(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves existing output and cleans the temporary file on failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-export-failure-"));
    const workspace = new WorkspaceStore(root);
    await workspace.write("exports/result.csv", "previous\n");
    const stream = async function* (): AsyncGenerator<QueryExportBatch> {
      yield { columns: ["id"], rows: [[1]] };
      throw new Error("QUERY_FAILED");
    };
    const artifacts: string[] = [];
    const tool = exportTool(workspace, { stream: () => stream(), run: async () => { throw new Error("run should not be used"); } }, (path) => artifacts.push(path));
    try {
      await expect(tool.execute("call-2", { sql: "SELECT id", filename: "exports/result.csv", expected_rows: "full", expected_columns: ["id"] })).rejects.toThrow("QUERY_FAILED");
      expect(await readFile(join(root, "exports", "result.csv"), "utf8")).toBe("previous\n");
      expect(artifacts).toEqual([]);
      expect(await tempFiles(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("cleans the temporary file and emits no artifact when cancelled", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-export-cancel-"));
    const workspace = new WorkspaceStore(root);
    const controller = new AbortController();
    const stream = async function* (): AsyncGenerator<QueryExportBatch> {
      yield { columns: ["id"], rows: [[1]] };
      controller.abort();
      yield { columns: ["id"], rows: [[2]] };
    };
    const artifacts: string[] = [];
    const tool = exportTool(workspace, { stream: () => stream(), run: async () => { throw new Error("run should not be used"); } }, (path) => artifacts.push(path));
    try {
      await expect(tool.execute("call-3", { sql: "SELECT id", filename: "exports/cancelled.csv", expected_rows: "full", expected_columns: ["id"] }, controller.signal, undefined, undefined)).rejects.toThrow("EXPORT_CANCELLED");
      await expect(workspace.read("exports/cancelled.csv")).rejects.toThrow();
      expect(artifacts).toEqual([]);
      expect(await tempFiles(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
