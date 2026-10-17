import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KnowledgeIndex } from "./knowledge.js";
import { ensureKnowledgePlaceholders, KNOWLEDGE_PLACEHOLDERS, placeholderContent } from "./knowledge-seed.js";
import { KnowledgeWriter } from "./knowledge-write.js";
import { DataAgentRuntime } from "./protocol.js";
import { composeKnowledgeCatalogPrompt } from "./application/session-runtime.js";

const doc = (knowledgeId: string, body: string, usage?: "method") =>
  ["---", `knowledgeId: ${knowledgeId}`, `name: ${knowledgeId}`, `description: ${knowledgeId} description`, ...(usage ? [`usage: ${usage}`] : []), "---", "", body, ""].join("\n");

async function withRoots(run: (roots: { builtin: string; user: string }) => Promise<void>): Promise<void> {
  const base = await mkdtemp(join(tmpdir(), "knowledge-builtin-"));
  const roots = { builtin: join(base, "builtin"), user: join(base, "user") };
  try {
    await mkdir(join(roots.builtin, "doc"), { recursive: true });
    await mkdir(join(roots.user, "doc"), { recursive: true });
    await run(roots);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

describe("built-in knowledge roots", () => {
  it("indexes built-in documents read-only beside user documents", async () => {
    await withRoots(async ({ builtin, user }) => {
      await writeFile(join(builtin, "doc", "rules.md"), doc("sql-rules", "# Rules\n\n计数使用 COUNT(DISTINCT key)。", "method"), "utf8");
      await writeFile(join(user, "doc", "business.md"), doc("business-definitions", "# Business\n\n有效订单指未取消订单。"), "utf8");
      const index = new KnowledgeIndex({ requireMetadata: true });
      await index.loadDirectory(builtin, { readOnly: true });
      await index.loadDirectory(user);

      expect(index.catalog()).toEqual([
        expect.objectContaining({ knowledgeId: "business-definitions", readOnly: false }),
        expect.objectContaining({ knowledgeId: "sql-rules", readOnly: true }),
      ]);
      expect(index.isBuiltinPath("doc/rules.md")).toBe(true);
      expect(index.isBuiltinPath("doc/business.md")).toBe(false);
      expect(index.locate("doc/rules.md")).toMatchObject({ readOnly: true });
      expect(await index.isCurrent("sql-rules")).toBe(true);
    });
  });

  it("lets a user copy override a built-in document and restores it when the copy is deleted", async () => {
    await withRoots(async ({ builtin, user }) => {
      await writeFile(join(builtin, "doc", "rules.md"), doc("sql-rules", "built-in rules", "method"), "utf8");
      const index = new KnowledgeIndex({ requireMetadata: true });
      await index.loadDirectory(builtin, { readOnly: true });
      await writeFile(join(user, "doc", "rules.md"), doc("sql-rules", "customized rules", "method"), "utf8");
      await index.loadDirectory(user);

      expect(index.getDocument("sql-rules").content).toContain("customized rules");
      expect(index.locate("doc/rules.md")).toMatchObject({ readOnly: false });
      expect(index.diagnostics()).toEqual([expect.objectContaining({ code: "builtin_overridden", path: "doc/rules.md" })]);

      // The override survives rescans in either order and keeps its diagnostic.
      await index.reload();
      expect(index.getDocument("sql-rules").content).toContain("customized rules");
      expect(index.diagnostics()).toEqual([expect.objectContaining({ code: "builtin_overridden" })]);

      await rm(join(user, "doc", "rules.md"));
      await index.reload();
      expect(index.getDocument("sql-rules").content).toContain("built-in rules");
      expect(index.locate("doc/rules.md")).toMatchObject({ readOnly: true });
      expect(index.diagnostics()).toEqual([]);
    });
  });

  it("drops deleted documents on rescan", async () => {
    await withRoots(async ({ user }) => {
      await writeFile(join(user, "doc", "notes.md"), doc("team-notes", "short-lived note"), "utf8");
      const index = new KnowledgeIndex({ requireMetadata: true });
      await index.loadDirectory(user);
      expect(index.search("short-lived")).toHaveLength(1);
      await rm(join(user, "doc", "notes.md"));
      await index.loadDirectory(user);
      expect(index.catalog()).toEqual([]);
      expect(index.search("short-lived")).toHaveLength(0);
    });
  });

  it("refuses Agent writes to built-in paths", async () => {
    await withRoots(async ({ builtin, user }) => {
      await writeFile(join(builtin, "doc", "semantic_guide.md"), doc("semantic-guide", "guide", "method"), "utf8");
      const index = new KnowledgeIndex({ requireMetadata: true });
      await index.loadDirectory(builtin, { readOnly: true });
      const writer = new KnowledgeWriter(user, undefined, { isBuiltin: (relativePath) => index.isBuiltinPath(relativePath) });
      await expect(writer.write("write_draft", "doc/semantic_guide.md", "overwrite")).rejects.toThrow("BUILTIN_WRITE_DENIED:doc/semantic_guide.md");
      await expect(writer.write("write_draft", "doc/draft.md", "draft")).resolves.toMatchObject({ path: "doc/draft.md" });
    });
  });

  it("lists, reads, and protects built-in documents through runtime commands", async () => {
    await withRoots(async ({ builtin, user }) => {
      await writeFile(join(builtin, "doc", "rules.md"), doc("sql-rules", "# Rules\n\nbuilt-in rule line", "method"), "utf8");
      await writeFile(join(user, "doc", "business.md"), doc("business-definitions", "# Business"), "utf8");
      const index = new KnowledgeIndex({ requireMetadata: true });
      await index.loadDirectory(builtin, { readOnly: true });
      const runtime = new DataAgentRuntime({ knowledge: index, knowledgeRoot: user });
      const context = { userId: "local", host: "web" as const };

      const listed = await runtime.dispatch({ protocolVersion: 1, requestId: "list", command: { type: "knowledge.list" } }, context);
      const files = new Map((listed.response as { files: Array<Record<string, unknown>> }).files.map((file) => [file.path, file]));
      expect(files.get("doc/rules.md")).toMatchObject({ knowledgeId: "sql-rules", readOnly: true, hasContent: true });
      expect(files.get("doc/business.md")).not.toHaveProperty("readOnly");

      const read = await runtime.dispatch({ protocolVersion: 1, requestId: "read", command: { type: "knowledge.read", path: "doc/rules.md" } }, context);
      expect((read.response as { content: string }).content).toContain("built-in rule line");

      await expect(runtime.dispatch({ protocolVersion: 1, requestId: "save", command: { type: "knowledge.save", path: "doc/rules.md", content: "x" } }, context))
        .rejects.toMatchObject({ code: "INVALID_COMMAND" });
    });
  });
});

describe("knowledge placeholders", () => {
  it("writes missing placeholders without touching existing documents and hides them from the Agent catalog", async () => {
    await withRoots(async ({ builtin, user }) => {
      await writeFile(join(user, "doc", "business.md"), doc("business-definitions", "# Business\n\n已有定义。"), "utf8");
      const written = await ensureKnowledgePlaceholders(user);
      expect(written).toEqual(["doc/db_schema.md", "doc/query_patterns.md", "doc/learning.md"]);
      expect(await readFile(join(user, "doc", "business.md"), "utf8")).toContain("已有定义。");
      expect(await ensureKnowledgePlaceholders(user)).toEqual([]);

      await writeFile(join(builtin, "doc", "rules.md"), doc("sql-rules", "# Rules\n\nrule", "method"), "utf8");
      const index = new KnowledgeIndex({ requireMetadata: true });
      await index.loadDirectory(builtin, { readOnly: true });
      await index.loadDirectory(user);
      expect(index.catalog().find((entry) => entry.knowledgeId === "database-schema")).toMatchObject({ hasContent: false });

      const prompt = composeKnowledgeCatalogPrompt("BASE", index);
      expect(prompt).toContain("id: sql-rules");
      expect(prompt).toContain("id: business-definitions");
      expect(prompt).not.toContain("id: database-schema");
      expect(prompt).not.toContain("id: learning-notes");
    });
  });

  it("matches the metadata of the repository's deployment documents", async () => {
    const repositoryKnowledge = join(process.cwd(), "..", "..", "knowledge");
    const index = new KnowledgeIndex({ requireMetadata: true });
    await index.loadDirectory(repositoryKnowledge);
    for (const placeholder of KNOWLEDGE_PLACEHOLDERS) {
      expect(index.locate(placeholder.path), placeholder.path).toBeDefined();
      expect(index.getDocument(placeholder.knowledgeId)).toMatchObject({
        path: placeholder.path,
        name: placeholder.name,
        description: placeholder.description,
        ...(placeholder.usage ? { usage: placeholder.usage } : {}),
      });
      expect(placeholderContent(placeholder)).toContain(`knowledgeId: ${placeholder.knowledgeId}`);
    }
  });
});
