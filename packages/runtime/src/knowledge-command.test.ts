import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataAgentRuntime } from "./index.js";
import { KnowledgeIndex } from "./knowledge.js";
import { MAX_TEXT_BYTES } from "./bounded-read.js";

describe("knowledge commands", () => {
  it("searches and reads through DataAgentRuntime", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-knowledge-cmd-"));
    await mkdir(join(root, "doc"), { recursive: true });
    await writeFile(join(root, "doc", "rules.md"), "# 规范\n\nSQL 查询必须带 LIMIT。", "utf8");
    const runtime = new DataAgentRuntime({ knowledge: new KnowledgeIndex(), knowledgeRoot: root });
    const context = { userId: "local", host: "electron" as const };
    const search = await runtime.dispatch({ protocolVersion: 1, requestId: "s", command: { type: "knowledge.search", query: "LIMIT" } }, context);
    const hit = (search.response as { hits: Array<{ path: string; title: string; startLine: number; endLine: number; snippet: string }> }).hits[0];
    expect(hit.path).toBe("doc/rules.md");
    expect(hit.title).toBe("规范");
    expect(hit.startLine).toBe(1);
    expect(hit.endLine).toBe(3);
    expect(hit.snippet).toContain("LIMIT");
    const read = await runtime.dispatch({ protocolVersion: 1, requestId: "r", command: { type: "knowledge.read", path: "doc/rules.md", startLine: 3, endLine: 3 } }, context);
    expect((read.response as { content: string }).content).toBe("SQL 查询必须带 LIMIT。");
    await expect(runtime.dispatch({ protocolVersion: 1, requestId: "invalid", command: { type: "knowledge.read", path: "doc/rules.md", startLine: 3, endLine: 2 } }, context)).rejects.toMatchObject({ code: "INVALID_COMMAND" });
    await expect(runtime.dispatch({ protocolVersion: 1, requestId: "x", command: { type: "knowledge.read", path: "../outside.md" } }, context)).rejects.toMatchObject({ code: "INVALID_COMMAND" });
    await rm(root, { recursive: true, force: true });
  });

  it("caps knowledge reads at 50 KiB and supports omitted boundaries", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-knowledge-cap-"));
    await mkdir(join(root, "doc"), { recursive: true });
    await writeFile(join(root, "doc", "large.md"), Array.from({ length: 60000 }, () => "x").join("\n"), "utf8");
    const runtime = new DataAgentRuntime({ knowledge: new KnowledgeIndex(), knowledgeRoot: root });
    const context = { userId: "local", host: "electron" as const };
    const read = await runtime.dispatch({ protocolVersion: 1, requestId: "cap", command: { type: "knowledge.read", path: "doc/large.md" } }, context);
    const content = (read.response as { content: string }).content;
    expect(Buffer.byteLength(content, "utf8")).toBeLessThanOrEqual(MAX_TEXT_BYTES);
    expect(content.startsWith("x\nx")).toBe(true);
    await rm(root, { recursive: true, force: true });
  });
});
