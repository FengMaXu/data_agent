import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KnowledgeIndex } from "./knowledge.js";

describe("KnowledgeIndex", () => {
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
