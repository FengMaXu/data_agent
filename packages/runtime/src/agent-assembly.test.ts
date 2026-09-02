import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { buildAgentTools, collectTaskSemanticEvidence, composeDataAgentSystemPrompt, createDataAgentHarness, deriveRequestAnswerShape, deriveRequestFilterConstraints, normalizeAnswerSpecPlannerOutput, resolveSystemPrompt, runtimeCapabilitiesPrompt, solverPromptForTask, unknownToolRecoveryMessage, type AgentAssemblyDeps, type QueryExportBatch } from "./agent-assembly.js";
import { ClarificationManager } from "./clarification.js";
import { createReviewOffQueryAssurance, InMemoryQueryAssurance, type QueryAssurance } from "./query-assurance.js";
import { WorkspaceStore } from "./workspace.js";
import { KnowledgeIndex } from "./knowledge.js";
import { createQueryDigestCompiler, type QueryDigestCompiler } from "./query-digest.js";

const testAuthoritativeDigestCompiler: QueryDigestCompiler = {
  compile(input) {
    return { ...createQueryDigestCompiler().compile(input), parserEngine: "sqlglot", parserVersion: "test-sqlglot" };
  },
};

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
  it("separates final answer shape from intermediate analysis shape", () => {
    expect(deriveRequestAnswerShape("List the top five categories, then how many have no sales?")).toEqual({ rowMode: "scalar", rowCount: 1 });
    expect(deriveRequestAnswerShape("Distribute city pairs into ranges. Then how many pairs are in the least populated range?")).toEqual({ rowMode: "scalar", rowCount: 1 });
    expect(deriveRequestAnswerShape("Identify the top three customers by delivered order count.")).toEqual({ rowMode: "top_n", rowCount: 3 });
    expect(deriveRequestAnswerShape("Calculate the average of the most used payment count for each category.")).toEqual({ rowMode: "scalar", rowCount: 1 });
    expect(deriveRequestAnswerShape("List the projected average sales by month.")).toEqual({});
  });

  it("extracts only explicit SQL-shaped request predicates for G2 authorization", () => {
    expect(deriveRequestFilterConstraints("Return orders where status = 'paid' and region != 'CN'. What is the count?")).toEqual([
      { statement: "status = 'paid'", authority: "request_wording", scope: "filter", source: "request-question" },
      { statement: "region != 'CN'", authority: "request_wording", scope: "filter", source: "request-question" },
    ]);
    expect(deriveRequestFilterConstraints("What is the average?" )).toEqual([]);
  });

  it("builds a bounded task-document evidence pack before planning", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-semantic-evidence-"));
    try {
      await mkdir(join(root, "doc"), { recursive: true });
      await writeFile(join(root, "doc", "business.md"), "# RFM definition\n\nRecency uses the latest delivered purchase. Segment thresholds come from this reviewed table.", "utf8");
      await writeFile(join(root, "doc", "learning.md"), "# Learning\n\nRecency guesses must never become business rules.", "utf8");
      for (let index = 0; index < 70; index += 1) {
        await writeFile(join(root, "doc", `unrelated-${index}.md`), `# Unrelated ${index}\n\nRecency segment query notes unrelated to business definitions.`, "utf8");
      }
      const knowledge = new KnowledgeIndex();
      await knowledge.loadDirectory(root);

      const evidence = collectTaskSemanticEvidence(knowledge, "How is Recency defined for RFM segments?", { maxEntries: 2, maxChars: 80 });

      expect(evidence).toHaveLength(1);
      expect(evidence[0]).toMatchObject({ authority: "task_document", path: "doc/business.md", startLine: 1 });
      expect(evidence[0].content.length).toBeLessThanOrEqual(80);
      expect(evidence[0].content).toContain("Recency");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

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

  it("normalizes common JSON wire variants in structured Answer Contract fields", () => {
    const normalized = normalizeAnswerSpecPlannerOutput({ taskId: "task-planner-wire", question: "Show the top 3 customers by average payment" }, {
      answerContract: {
        output: { value: "customer_id", rowMode: "top-3", rowCount: "3" },
        measures: { value: { kind: "average", name: "average payment" } },
        ranking: { value: { n: "3", partitionBy: "customer_state", orderBy: ["average payment DESC", "customer_id ASC"], tiePolicy: "exactly_n" } },
        rounding: { value: { mode: "decimal_places", places: "2" } },
      },
    });

    expect(normalized.answerContract?.output?.value).toEqual({ columns: ["customer_id"], rowMode: "top_n", rowCount: 3 });
    expect(normalized.answerContract?.measures?.[0]?.value).toEqual({ kind: "avg", name: "average payment" });
    expect(normalized.answerContract?.ranking?.value).toEqual({ n: 3, partitionBy: ["customer_state"], orderBy: "average payment DESC, customer_id ASC", tiePolicy: "strict" });
    expect(normalized.answerContract?.rounding?.value).toEqual({ mode: "decimal_places", places: 2 });
  });

  it("normalizes scalar and array wrapper values without losing their facet", () => {
    const normalized = normalizeAnswerSpecPlannerOutput({ taskId: "task-wrapper", question: "Show the requested customers" }, {
      answerContract: {
        output: { value: ["customer_id"], authority: "request_wording", quote: "customers" },
        measures: { value: "count", authority: "request_wording", quote: "count" },
      },
    });
    expect(normalized.answerContract?.output?.value).toEqual({ columns: ["customer_id"] });
    expect(normalized.answerContract?.measures?.[0]?.value).toEqual({ kind: "count" });
  });

  it("keeps Planner output consistent with Runtime-derived final answer shape", () => {
    const normalized = normalizeAnswerSpecPlannerOutput({ taskId: "task-shape", question: "Then how many?", rowMode: "scalar", rowCount: 1 }, {
      answerContract: { output: { value: ["distance_range", "pair_count"], rowMode: "grouped", rowCount: 7 } },
    });

    expect(normalized.answerContract?.output?.value).toEqual({ columns: ["distance_range", "pair_count"], rowMode: "scalar", rowCount: 1 });
  });

  it("omits null optionals and inapplicable planner facets instead of invalidating the whole spec", () => {
    const normalized = normalizeAnswerSpecPlannerOutput({ taskId: "task-planner-null", question: "Group sales by segment without rounding" }, {
      answerContract: {
        output: { value: ["segment", "sales"], rowMode: "grouped", rowCount: null },
        grain: null,
        measures: [null, "not specified"],
        denominator: { value: null },
        ranking: "not applicable",
        time: { value: { displayWindow: "not applicable", lookback: null, asOf: null, boundary: null } },
        rounding: { value: { mode: "none", places: null } },
      },
    });

    expect(normalized.answerContract?.output?.value).toEqual({ columns: ["segment", "sales"], rowMode: "grouped" });
    expect(normalized.answerContract?.grain).toBeUndefined();
    expect(normalized.answerContract?.measures).toBeUndefined();
    expect(normalized.answerContract?.denominator).toBeUndefined();
    expect(normalized.answerContract?.ranking).toBeUndefined();
    expect(normalized.answerContract?.time).toBeUndefined();
    expect(normalized.answerContract?.rounding).toBeUndefined();
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
  it("uses Pi's XML skill formatter and ends the complete system prompt with the language instruction", () => {
    const prompt = composeDataAgentSystemPrompt("base instructions", [{ name: "analysis", description: "Analyze data", content: "body", filePath: "C:/skills/analysis/SKILL.md" }]);
    expect(prompt).toContain("base instructions");
    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("<name>analysis</name>");
    expect(prompt).toContain("<location>C:/skills/analysis/SKILL.md</location>");
    expect(prompt.endsWith("所有文字输出与回应必须使用中文，包括每一轮工具调用前的说明、过程性说明、澄清、错误说明和最终答复。禁止使用英文自然语言。工具调用前不要输出过程性文字，直接调用工具。仅 SQL、代码、工具名、字段名、表名、文件路径和数据库原始值可以保持原样。"));
  });

  it("passes through the original prompt when Query Assurance is off", () => {
    const question = "Original question";
    const answerSpec = { taskId: "task-1", specVersion: "1", question, hardConstraints: [], hypotheses: [], ambiguities: [], provenance: [] };
    expect(solverPromptForTask(question, { mode: "off", answerSpec })).toBe(question);
    expect(solverPromptForTask(question, { mode: "shadow", answerSpec })).toContain("[ANSWER_SPEC_READ_ONLY]");
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
    expect(prompt).toContain("### 1.4 交付前检查");
    expect(prompt).toContain("传入的 `queryArtifactId`");
    expect(prompt).toContain("证据优先级");
    expect(prompt).toContain("只调用出现在当前列表中的工具");
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
      await query.execute("explore-2", { sql: "SELECT * FROM users LIMIT 3" }, undefined, undefined, { sessionId: "session-a" });
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

describe("publication tools", () => {
  it("does not expose advisory validation tools to the Solver", () => {
    const tools = buildAgentTools({
      workspace: new WorkspaceStore("/tmp/data-agent-tools"),
      queryExecutor: { run: async () => ({ columns: [], rows: [], truncated: false }) },
    });
    expect(tools.find((tool) => tool.name === "sql_validate")).toBeUndefined();
    expect(tools.find((tool) => tool.name === "semantic_validate")).toBeUndefined();
  });

  it("publishes the exact Query Artifact selected by queryArtifactId", async () => {
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
      const result = await exportQuery.execute("artifact-export", { queryArtifactId: preview.details.queryArtifactId, filename: "exports/artifact.csv" }, undefined, undefined, { sessionId: "session-a", taskId: task.taskId, specVersion: task.specVersion });
      expect(result.details).toMatchObject({ taskComplete: true, publicationReceipt: { queryArtifactId: preview.details.queryArtifactId } });
      expect(await readFile(join(root, "session-a", "exports", "artifact.csv"), "utf8")).toBe("answer\n1");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not turn an empty Answer Contract into an expected zero-column Candidate", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-export-empty-contract-"));
    const assurance = createReviewOffQueryAssurance();
    const task = await assurance.prepareTask({
      question: "Return the answer",
      answerContract: { output: { value: { columns: [] }, authority: "request_wording", source: "question", quote: "Return the answer" } },
    }, new AbortController().signal);
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
      const preview = await query.execute("empty-contract-preview", { sql: "SELECT 1 AS answer" }, undefined, undefined, { sessionId: "session-a", taskId: task.taskId, specVersion: task.specVersion });
      const result = await exportQuery.execute("empty-contract-export", { queryArtifactId: preview.details.queryArtifactId, filename: "exports/empty-contract.csv" }, undefined, undefined, { sessionId: "session-a", taskId: task.taskId, specVersion: task.specVersion });
      expect(result.details).toMatchObject({ taskComplete: true });
      expect(await readFile(join(root, "session-a", "exports", "empty-contract.csv"), "utf8")).toBe("answer\n1");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("blocks a scalar shape mismatch before the reviewer or publication", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-export-g1-scalar-"));
    const assurance = new InMemoryQueryAssurance({ digestCompiler: testAuthoritativeDigestCompiler, mode: "shadow", reviewer: { review: async () => ({ status: "approved", coverage: {} }) } });
    const task = await assurance.prepareTask({ question: "How many answers?", rowMode: "scalar", rowCount: 1 }, new AbortController().signal);
    const tools = buildAgentTools({
      workspace: new WorkspaceStore(root),
      queryAssurance: assurance,
      databaseDialect: "sqlite",
      queryExecutor: {
        run: async () => ({ columns: ["answer"], rows: [[1], [2]], truncated: false }),
        stream: async function* (): AsyncGenerator<QueryExportBatch> { yield { columns: ["answer"], rows: [[1], [2]] }; },
      },
    });
    const query = tools.find((candidate) => candidate.name === "query_database") as any;
    const exportQuery = tools.find((candidate) => candidate.name === "export_query") as any;
    try {
      const preview = await query.execute("g1-preview", { sql: "SELECT answer FROM answers" }, undefined, undefined, { sessionId: "session-a", taskId: task.taskId, specVersion: task.specVersion });
      const result = await exportQuery.execute("g1-export", { queryArtifactId: preview.details.queryArtifactId, filename: "exports/g1.csv" }, undefined, undefined, { sessionId: "session-a", taskId: task.taskId, specVersion: task.specVersion });
      expect(result.details).toMatchObject({ status: "blocked", terminal: true });
      expect(result.content[0].text).toContain("DETERMINISTIC_GATE_REJECTED");
      await expect(readFile(join(root, "session-a", "exports", "g1.csv"), "utf8")).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects direct SQL export without silently restoring the old contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-export-no-legacy-"));
    const exportQuery = buildAgentTools({
      workspace: new WorkspaceStore(root),
      queryExecutor: { run: async () => ({ columns: ["id"], rows: [[1]], truncated: false }) },
    }).find((candidate) => candidate.name === "export_query") as any;
    try {
      await expect(exportQuery.execute("legacy-contract", { sql: "SELECT id FROM users", expected_rows: "full", expected_columns: ["id"] })).rejects.toThrow("QUERY_ARTIFACT_REQUIRED");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("cleans a private Candidate when the export stream fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-export-stream-failure-"));
    const workspace = new WorkspaceStore(root);
    const assurance = createReviewOffQueryAssurance();
    const task = await assurance.prepareTask({ question: "Return rows" }, new AbortController().signal);
    const tools = buildAgentTools({
      workspace,
      queryAssurance: assurance,
      databaseDialect: "sqlite",
      queryExecutor: {
        run: async () => ({ columns: ["id"], rows: [[1]], truncated: false }),
        stream: async function* (): AsyncGenerator<QueryExportBatch> {
          yield { columns: ["id"], rows: [[1]] };
          throw new Error("QUERY_FAILED");
        },
      },
    });
    const query = tools.find((candidate) => candidate.name === "query_database") as any;
    const exportQuery = tools.find((candidate) => candidate.name === "export_query") as any;
    try {
      const preview = await query.execute("failure-preview", { sql: "SELECT id FROM users" }, undefined, undefined, { sessionId: "session-a", taskId: task.taskId, specVersion: task.specVersion });
      await expect(exportQuery.execute("failure-export", { queryArtifactId: preview.details.queryArtifactId, filename: "exports/failure.csv" }, undefined, undefined, { sessionId: "session-a", taskId: task.taskId, specVersion: task.specVersion })).rejects.toThrow("QUERY_FAILED");
      await expect(readFile(join(root, "session-a", "exports", "failure.csv"), "utf8")).rejects.toThrow();
      expect(await tempFiles(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("remaining agent tools", () => {
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

});
