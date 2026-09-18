import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAgentTools } from "./agent-assembly.js";
import { KnowledgeIndex } from "./knowledge.js";
import { WorkspaceStore } from "./workspace.js";

function resultText(result: any): string {
  return result.content.find((part: any) => part.type === "text")?.text ?? "";
}

describe("knowledge and file agent tools", () => {
  it("renders knowledge snippets and exposes structured hit details", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-knowledge-tool-"));
    await mkdir(join(root, "doc"), { recursive: true });
    await writeFile(join(root, "doc", "rules.md"), "# Rules\n\nAlways use LIMIT.", "utf8");
    const knowledge = new KnowledgeIndex();
    await knowledge.loadDirectory(root);
    const tools = buildAgentTools({ workspace: new WorkspaceStore(root), knowledge, knowledgeRoot: root });
    const tool = tools.find((candidate) => candidate.name === "search_knowledge")!;
    const result = await (tool.execute as any)("call", { query: "LIMIT" });
    expect(resultText(result)).toContain("Always use LIMIT.");
    expect(result.details[0]).toMatchObject({ path: "doc/rules.md", title: "Rules", startLine: 1, endLine: 3 });
    await rm(root, { recursive: true, force: true });
  });

  it("reads inclusive line ranges while preserving path safety", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-file-tool-"));
    await writeFile(join(root, "note.txt"), "one\ntwo\nthree", "utf8");
    const tools = buildAgentTools({ workspace: new WorkspaceStore(root) });
    const tool = tools.find((candidate) => candidate.name === "read_file")!;
    const result = await (tool.execute as any)("call", { path: "note.txt", startLine: 2, endLine: 2 });
    expect(resultText(result)).toBe("two");
    await expect((tool.execute as any)("call", { path: "../outside.txt" })).rejects.toThrow();
    await rm(root, { recursive: true, force: true });
  });
});
