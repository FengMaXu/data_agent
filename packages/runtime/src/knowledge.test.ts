import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KnowledgeIndex } from "./knowledge.js";

describe("KnowledgeIndex", () => {
  it("skips Markdown symlinks that point outside the knowledge root", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-knowledge-symlink-"));
    const outside = await mkdtemp(join(tmpdir(), "data-agent-knowledge-outside-"));
    try {
      await writeFile(join(outside, "secret.md"), "secret material", "utf8");
      try { await symlink(join(outside, "secret.md"), join(root, "secret.md")); }
      catch { return; }
      const index = new KnowledgeIndex();
      expect(await index.loadDirectory(root)).toBe(0);
      expect(index.search("secret")).toHaveLength(0);
      await expect(index.loadFile(root, join(root, "secret.md"))).rejects.toThrow("KNOWLEDGE_SYMLINK_ESCAPE");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("requires valid unique document metadata for production indexes and exposes a catalog", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-knowledge-metadata-"));
    try {
      await writeFile(join(root, "missing.md"), "# Missing metadata", "utf8");
      await writeFile(join(root, "one.md"), "---\nknowledgeId: one\nname: One\ndescription: First document.\n---\n\n# One\n\ncontent", "utf8");
      await writeFile(join(root, "two.md"), "---\nknowledgeId: two\nname: Two\ndescription: Second document.\n---\n\n# Two\n\ncontent", "utf8");
      const index = new KnowledgeIndex({ requireMetadata: true });
      expect(await index.loadDirectory(root)).toBe(2);
      expect(index.diagnostics()).toEqual([expect.objectContaining({ code: "missing_metadata", path: "missing.md" })]);
      expect(index.catalog()).toEqual([
        expect.objectContaining({ knowledgeId: "one", name: "One", description: "First document.", path: "one.md" }),
        expect.objectContaining({ knowledgeId: "two", name: "Two", description: "Second document.", path: "two.md" }),
      ]);
      await writeFile(join(root, "duplicate.md"), "---\nknowledgeId: one\nname: Duplicate\ndescription: Duplicate document.\n---\n\n# Duplicate", "utf8");
      await expect(index.loadFile(root, join(root, "duplicate.md"))).rejects.toThrow("KNOWLEDGE_ID_DUPLICATE:one");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps heading-derived section IDs stable and bounds headingless documents", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-knowledge-sections-"));
    try {
      const file = join(root, "guide.md");
      const metadata = "---\nknowledgeId: guide\nname: Guide\ndescription: Test guide.\n---\n\n";
      await writeFile(file, `${metadata}# Root\n\n## Alpha\n\na\n\n## Beta\n\nb`, "utf8");
      const index = new KnowledgeIndex({ requireMetadata: true });
      await index.loadDirectory(root);
      const before = index.getDocument("guide").sections.find((section) => section.title === "Beta")!.sectionId;
      await writeFile(file, `${metadata}# Root\n\n## Inserted\n\nx\n\n## Alpha\n\na\n\n## Beta\n\nb`, "utf8");
      await index.loadFile(root, file);
      const after = index.getDocument("guide").sections.find((section) => section.title === "Beta")!.sectionId;
      expect(after).toBe(before);

      const headingless = join(root, "plain.md");
      await writeFile(headingless, `---\nknowledgeId: plain\nname: Plain\ndescription: Plain document.\n---\n\n${Array.from({ length: 250 }, (_, index) => `line ${index + 1}`).join("\n")}`, "utf8");
      await index.loadFile(root, headingless);
      expect(index.getDocument("plain").sections).toHaveLength(3);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("indexes Markdown with line ranges and ranks Chinese and English queries", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-knowledge-"));
    await mkdir(join(root, "doc"), { recursive: true });
    await writeFile(join(root, "doc", "business.md"), "# 业务口径\n\n批发业销售额是指企业销售总额。\n\n# Other\n\nUnrelated english content about warehouses.", "utf8");
    const index = new KnowledgeIndex();
    expect(await index.loadDirectory(root)).toBe(1);
    const chinese = index.search("批发业 销售额");
    expect(chinese.length).toBeGreaterThan(0);
    expect(chinese[0].path).toBe("doc/business.md");
    expect(chinese[0].category).toBe("doc");
    expect(chinese[0].startLine).toBeGreaterThan(0);
    const english = index.search("warehouses");
    expect(english[0].title).toBe("Other");
    await rm(root, { recursive: true, force: true });
  });
});
