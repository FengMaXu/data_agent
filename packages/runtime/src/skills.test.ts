import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { effectiveTools, loadSkillsFromDir, loadSkillsFromRoots, moveSystemPrompt, resolveSkillRoots } from "./skills.js";

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

  it("intersects global tools with declared skill allowlists", () => {
    const global = ["read_file", "query_database", "run_python"];
    const skill = { name: "s", description: "", filePath: "", allowedTools: ["query_database"], content: "" };
    expect(effectiveTools(global, [skill])).toEqual(["query_database"]);
    expect(effectiveTools(global, [])).toEqual(global);
  });

  it("preserves global tools when a Skill omits allowed-tools", () => {
    const global = ["read_file", "query_database", "run_python"];
    const skill = { name: "s", description: "", filePath: "", content: "" };
    expect(effectiveTools(global, [skill])).toEqual(global);
  });

  it("uses explicit development and packaged roots", () => {
    expect(resolveSkillRoots({ projectRoot: "/project", packagedRoot: "/resources" })).toEqual([
      resolvePath("/project", ".agents", "skills"),
      resolvePath("/resources", ".agents", "skills"),
    ]);
  });

  it("does not let duplicate Skill names choose an implicit root priority", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "data-agent-project-skills-"));
    const packagedRoot = await mkdtemp(join(tmpdir(), "data-agent-packaged-skills-"));
    for (const root of [projectRoot, packagedRoot]) {
      await mkdir(join(root, "same"), { recursive: true });
      await writeFile(join(root, "same", "SKILL.md"), "---\nname: same\ndescription: duplicate\n---\nbody", "utf8");
    }
    const result = await loadSkillsFromRoots([projectRoot, packagedRoot]);
    expect(result.skills).toEqual([]);
    expect(result.diagnostics.filter((item) => item.code === "duplicate_name")).toHaveLength(2);
    await Promise.all([rm(projectRoot, { recursive: true, force: true }), rm(packagedRoot, { recursive: true, force: true })]);
  });

  it("uses the native loader, skips malformed Skills, and never executes their body", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-native-skills-"));
    await mkdir(join(root, "valid", "nested"), { recursive: true });
    await writeFile(join(root, "valid", "nested", "SKILL.md"), "---\nname: nested\ndescription: valid\n---\n# native body", "utf8");
    await mkdir(join(root, "broken"), { recursive: true });
    await writeFile(join(root, "broken", "SKILL.md"), "# no frontmatter\n$(touch SHOULD_NOT_RUN)", "utf8");
    const result = await loadSkillsFromRoots([root]);
    expect(result.skills.map((skill) => skill.name)).toEqual(["nested"]);
    expect(result.skills[0].content).toBe("# native body");
    expect(result.diagnostics.some((item) => item.code === "invalid_metadata")).toBe(true);
    await expect(access(join(root, "SHOULD_NOT_RUN"))).rejects.toThrow();
    await rm(root, { recursive: true, force: true });
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
