import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataAgentRuntime } from "./index.js";
import { KnowledgeIndex } from "./knowledge.js";

describe("knowledge commands", () => {
  it("searches and reads through DataAgentRuntime", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-knowledge-cmd-"));
    await mkdir(join(root, "doc"), { recursive: true });
    await writeFile(join(root, "doc", "rules.md"), "# 规范\n\nSQL 查询必须带 LIMIT。", "utf8");
    const runtime = new DataAgentRuntime({ knowledge: new KnowledgeIndex(), knowledgeRoot: root });
    const context = { userId: "local", host: "electron" as const };
    const search = await runtime.dispatch({ protocolVersion: 1, requestId: "s", command: { type: "knowledge.search", query: "LIMIT" } }, context);
    expect((search.response as { hits: unknown[] }).hits.length).toBeGreaterThan(0);
    const read = await runtime.dispatch({ protocolVersion: 1, requestId: "r", command: { type: "knowledge.read", path: "doc/rules.md" } }, context);
    expect((read.response as { content: string }).content).toContain("LIMIT");
    await expect(runtime.dispatch({ protocolVersion: 1, requestId: "x", command: { type: "knowledge.read", path: "../outside.md" } }, context)).rejects.toMatchObject({ code: "INVALID_COMMAND" });
    await rm(root, { recursive: true, force: true });
  });
});
