import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effectiveTools, loadSkillsFromDir, moveSystemPrompt } from "./skills.js";

describe("Skills", () => {
  it("loads migrated skills and flags unknown tools", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-skills-"));
    const skillDir = join(root, "analysis");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), `---\nname: analysis\ndescription: charting\nallowed-tools:\n  - query_database\n  - legacy_tool\n---\n# body`, "utf8");
    const { skills, diagnostics } = await loadSkillsFromDir(root);
    expect(skills).toHaveLength(1);
    expect(skills[0].allowedTools).toEqual(["query_database", "legacy_tool"]);
    expect(diagnostics.some(d => d.message.includes("legacy_tool"))).toBe(true);
    await rm(root, { recursive: true, force: true });
  });

  it("intersects global tools with active skill allowlists", () => {
    const global = ["read_file", "query_database", "run_python"];
    const skill = { name: "s", description: "", filePath: "", allowedTools: ["query_database"], content: "" };
    expect(effectiveTools(global, [skill])).toEqual(["query_database"]);
    expect(effectiveTools(global, [])).toEqual(global);
  });

  it("moves the agent prompt into SYSTEM.md once", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-prompt-"));
    const agentMd = join(root, "agent.md");
    const systemMd = join(root, ".pi", "SYSTEM.md");
    await writeFile(agentMd, "# system prompt", "utf8");
    await moveSystemPrompt(agentMd, systemMd);
    await moveSystemPrompt(agentMd, systemMd);
    const content = await readFile(systemMd, "utf8");
    expect(content).toBe("# system prompt");
    await rm(root, { recursive: true, force: true });
  });
});
