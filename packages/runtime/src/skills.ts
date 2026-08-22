import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export interface SkillDefinition {
  name: string;
  description: string;
  filePath: string;
  allowedTools: string[];
  content: string;
}

export interface SkillDiagnostic { path: string; message: string }

const CANONICAL_TOOLS = new Set([
  "list_workspace", "read_file", "write_file", "run_python",
  "search_knowledge", "read_knowledge", "update_knowledge",
  "load_skill", "generate_dashboard", "show_widget",
  "query_database", "ask_user_clarification",
  "export_query",
]);

export async function loadSkillsFromDir(dir: string): Promise<{ skills: SkillDefinition[]; diagnostics: SkillDiagnostic[] }> {
  const skills: SkillDefinition[] = []; const diagnostics: SkillDiagnostic[] = [];
  let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch { return { skills, diagnostics }; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const filePath = path.join(dir, entry.name, "SKILL.md");
    try {
      const raw = await readFile(filePath, "utf8");
      const match = /^---\n([\s\S]*?)\n---\n/.exec(raw);
      if (!match) { diagnostics.push({ path: filePath, message: "missing frontmatter" }); continue; }
      const name = /^name:\s*(.+)$/m.exec(match[1])?.[1]?.trim() ?? entry.name;
      const description = /^description:\s*(.+)$/m.exec(match[1])?.[1]?.trim() ?? "";
      const allowedTools = [...match[1].matchAll(/^\s*-\s*(\S+)\s*$/gm)].map(m => m[1]);
      const unknown = allowedTools.filter(tool => !CANONICAL_TOOLS.has(tool));
      if (unknown.length > 0) diagnostics.push({ path: filePath, message: `unknown tool names: ${unknown.join(", ")}` });
      skills.push({ name, description, filePath, allowedTools, content: raw });
    } catch (error) { diagnostics.push({ path: filePath, message: error instanceof Error ? error.message : String(error) }); }
  }
  return { skills, diagnostics };
}

export function effectiveTools(globalTools: string[], activeSkills: SkillDefinition[]): string[] {
  if (activeSkills.length === 0) return globalTools;
  const allowed = new Set(activeSkills.flatMap(skill => skill.allowedTools));
  return globalTools.filter(tool => allowed.has(tool));
}

export async function moveSystemPrompt(agentMdPath: string, systemMdPath: string): Promise<void> {
  const { writeFile, rename, access } = await import("node:fs/promises");
  try { await access(systemMdPath); return; } catch { /* not yet migrated */ }
  const content = await readFile(agentMdPath, "utf8");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.dirname(systemMdPath), { recursive: true });
  await writeFile(systemMdPath, content, "utf8");
  await rename(agentMdPath, `${agentMdPath}.migrated`);
}
