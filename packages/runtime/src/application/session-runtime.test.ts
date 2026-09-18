import { describe, expect, it } from "vitest";
import { MemorySessionRepo, TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { WorkspaceStore } from "../workspace.js";
import { composeKnowledgeCatalogPrompt, composeSubagentSystemPrompt, createDataAgentSessionHost, type DataAgentModelProfile } from "./session-runtime.js";
import type { BusinessContext } from "../answering/model.js";
import { KnowledgeIndex } from "../knowledge.js";

const profile: DataAgentModelProfile = { provider: "openai", model: "test-model", apiKey: "test" };
const spec = { entity: "orders", metric: "count", filters: [], groupBy: [], time: { state: "not_applicable" }, ranking: { state: "not_applicable" }, output: { rowMode: "scalar", rowCount: 1 } };

const business = (invocationId: string, scope?: { readonly scopeId: string; readonly connectionId: string }): BusinessContext => ({
  principal: { id: "user-1" }, sessionId: "session-1", lane: "main", operationId: "operation-1", invocationId,
  ...(scope ? { queryScope: scope } : {}),
});

describe("Session Runtime scoped query composition", () => {
  it("injects the Knowledge Catalog without injecting document bodies", async () => {
    const root = await mkdtemp(path.join(process.cwd(), ".tmp-session-runtime-catalog-"));
    try {
      await (await import("node:fs/promises")).writeFile(path.join(root, "guide.md"), "---\nknowledgeId: semantic-guide\nname: Semantic Guide\ndescription: Seven-slot query semantics.\n---\n\n# Guide\n\nbody text", "utf8");
      const knowledge = new KnowledgeIndex({ requireMetadata: true });
      await knowledge.loadDirectory(root);
      const prompt = composeKnowledgeCatalogPrompt("BASE", knowledge);
      expect(prompt).toContain("semantic-guide");
      expect(prompt).toContain("Seven-slot query semantics.");
      expect(prompt).not.toContain("body text");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("tells the main agent when to delegate and how to consume or reject child outcomes", () => {
    const prompt = composeSubagentSystemPrompt("BASE");
    expect(prompt).toContain("Delegate only when an independent bounded investigation");
    expect(prompt).toContain("never add or remove prefixes");
    expect(prompt).toContain("failed, timed_out, budget_exhausted, invalid_output, stale, or unavailable");
    expect(prompt).toContain("they never authorize result execution or publication");
  });

  it("routes a delegated exploration only through the explicitly scoped executor", async () => {
    const root = await mkdtemp(path.join(process.cwd(), ".tmp-session-runtime-scope-"));
    const scope = { scopeId: "scope-1", connectionId: "connection-1" };
    let genericCalls = 0;
    let scopedCalls = 0;
    let receivedOptions: unknown;
    const session = await new MemorySessionRepo().create({ id: "session-1" }, TODO_CONTEXT);
    const host = await createDataAgentSessionHost({
      session,
      sessionId: "session-1",
      principalId: "user-1",
      workspace: new WorkspaceStore(path.join(root, "workspace")),
      profile,
      systemPrompt: "You are Data Agent.",
      queryExecutor: {
        run: async () => { genericCalls += 1; throw new Error("UNSCOPED_EXECUTOR_MUST_NOT_RUN"); },
        scopedExploration: {
          scope,
          run: async (_sql, _limit, options) => {
            scopedCalls += 1;
            receivedOptions = options;
            return { columns: ["n"], rows: [[1]], truncated: false, columnTypes: ["INTEGER"] };
          },
        },
      },
    });
    try {
      const begun = await host.answering.begin({ requestMessageId: "request-1", requestId: "begin-1", spec }, business("begin-1"));
      const explored = await host.answering.execute({ kind: "exploration", taskId: begun.taskId, sql: "SELECT 1", limit: 1, maxPreviewBytes: 4 * 1024 }, business("explore-1", scope));
      expect(explored.artifact.kind).toBe("exploration");
      expect(scopedCalls).toBe(1);
      expect(genericCalls).toBe(0);
      expect(receivedOptions).toMatchObject({ kind: "exploration", scope, maxPreviewBytes: 4 * 1024 });
    } finally {
      await host.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
