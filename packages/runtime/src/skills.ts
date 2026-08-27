import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { loadSkills as loadNativeSkills, NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import type { Skill as NativeSkill } from "@earendil-works/pi-agent-core";

export interface SkillDefinition extends NativeSkill {
  /** Tools declared by the Skill, or undefined when no declaration was present. */
  allowedTools?: string[];
}

export interface SkillDiagnostic {
  path: string;
  message: string;
  code?: string;
}

const CANONICAL_TOOLS = new Set([
  "list_workspace", "read_file", "write_file", "run_python",
  "search_knowledge", "read_knowledge", "update_knowledge",
  "load_skill", "generate_dashboard", "show_widget",
  "query_database", "ask_user_clarification",
  "export_query",
]);

export interface SkillRootOptions {
  /** Repository root used by development installs. */
  projectRoot?: string;
  /** Application resources root used by packaged installs. */
  packagedRoot?: string;
}

/** Resolve only the two application-owned Skill roots. */
export function resolveSkillRoots(options: SkillRootOptions = {}): string[] {
  const developmentRoot = path.resolve(options.projectRoot ?? process.cwd(), ".agents", "skills");
  const packagedRoot = path.resolve(options.packagedRoot ?? options.projectRoot ?? process.cwd(), ".agents", "skills");
  return [...new Set([developmentRoot, packagedRoot])];
}

function diagnostic(filePath: string, message: string, code?: string): SkillDiagnostic {
  return code ? { path: filePath, message, code } : { path: filePath, message };
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/**
 * Read only the metadata needed by Data Agent. The Skill body itself is loaded
 * by Pi's native loader; this parser never evaluates body content.
 */
function parseToolMetadata(raw: string, filePath: string): { allowedTools?: string[]; diagnostics: SkillDiagnostic[]; valid: boolean } {
  const diagnostics: SkillDiagnostic[] = [];
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { diagnostics: [diagnostic(filePath, "missing frontmatter", "missing_frontmatter")], valid: false };
  }
  const end = normalized.indexOf("\n---", 4);
  if (end < 0) {
    return { diagnostics: [diagnostic(filePath, "unterminated frontmatter", "parse_failed")], valid: false };
  }
  const frontmatter = normalized.slice(4, end);
  const key = /^allowed-tools\s*:/m.exec(frontmatter) ?? /^allowedTools\s*:/m.exec(frontmatter);
  if (!key) return { diagnostics, valid: true };

  const line = key[0];
  const colon = line.indexOf(":");
  const inline = line.slice(colon + 1).trim();
  let values: string[] = [];
  if (inline) {
    if (!inline.startsWith("[") || !inline.endsWith("]")) {
      diagnostics.push(diagnostic(filePath, "allowed-tools must be a list", "invalid_metadata"));
      return { diagnostics, valid: false };
    }
    values = inline.slice(1, -1).split(",").map((value) => value.trim().replace(/^['\"]|['\"]$/g, "")).filter(Boolean);
  } else {
    const start = frontmatter.slice(key.index + key[0].length);
    for (const item of start.split("\n")) {
      if (/^\s*-\s*/.test(item)) {
        const value = /^\s*-\s*(\S.*?)\s*$/.exec(item)?.[1];
        if (value) values.push(value.replace(/^['\"]|['\"]$/g, ""));
      } else if (item.trim() && !/^\s/.test(item)) {
        break;
      }
    }
  }
  const unknown = values.filter((tool) => !CANONICAL_TOOLS.has(tool));
  if (unknown.length > 0) diagnostics.push(diagnostic(filePath, `unknown tool names: ${unknown.join(", ")}`, "unknown_tool"));
  return { allowedTools: values, diagnostics, valid: true };
}

const isWindows = process.platform === "win32";

/** Paths used by the native loader use `/` even when the host filesystem does not. */
function pathForNativeLoader(value: string): string {
  return isWindows ? value.replaceAll("\\", "/") : value;
}

function pathForNodeFilesystem(value: string): string {
  return isWindows ? value.replaceAll("/", "\\") : value;
}

function fileInfoForNativeLoader(info: { name: string; path: string }): { name: string; path: string } {
  const normalizedPath = pathForNativeLoader(info.path);
  return {
    name: isWindows ? normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1) : info.name,
    path: normalizedPath,
  };
}

/**
 * Keep Pi's native Skill traversal while adapting its slash-based path logic
 * to Node's filesystem implementation on Windows.
 */
class NativeLoaderExecutionEnv extends NodeExecutionEnv {
  override async fileInfo(filePath: string) {
    const result = await super.fileInfo(pathForNodeFilesystem(filePath));
    if (!result.ok) return result;
    return { ...result, value: { ...result.value, ...fileInfoForNativeLoader(result.value) } };
  }

  override async listDir(filePath: string, abortSignal?: AbortSignal) {
    const result = await super.listDir(pathForNodeFilesystem(filePath), abortSignal);
    if (!result.ok) return result;
    return {
      ...result,
      value: result.value.map((info) => ({ ...info, ...fileInfoForNativeLoader(info) })),
    };
  }

  override async canonicalPath(filePath: string) {
    const result = await super.canonicalPath(pathForNodeFilesystem(filePath));
    if (!result.ok) return result;
    return { ...result, value: pathForNativeLoader(result.value) };
  }

  override async readTextFile(filePath: string, abortSignal?: AbortSignal) {
    return super.readTextFile(pathForNodeFilesystem(filePath), abortSignal);
  }
}

/** Load Skills through Pi's native AgentHarness resource loader. */
export async function loadSkillsFromRoots(roots: string[]): Promise<{ skills: SkillDefinition[]; diagnostics: SkillDiagnostic[] }> {
  const normalizedRoots = [...new Set(roots.map((root) => path.resolve(root)))];
  const env = new NativeLoaderExecutionEnv({ cwd: process.cwd() });
  try {
    const nativeResult = await loadNativeSkills(env, normalizedRoots.map(pathForNativeLoader));
    const diagnostics: SkillDiagnostic[] = nativeResult.diagnostics.map((item) => ({
      path: item.path,
      message: item.message,
      code: item.code,
    }));
    const trustedRoots: string[] = [];
    for (const root of normalizedRoots) {
      try {
        trustedRoots.push(await realpath(root));
      } catch {
        // The native loader already reports non-missing root failures.
      }
    }
    const candidates: SkillDefinition[] = [];
    for (const nativeSkill of nativeResult.skills) {
      const filePath = path.resolve(nativeSkill.filePath);
      let canonicalFilePath: string;
      try {
        canonicalFilePath = await realpath(filePath);
      } catch (error) {
        diagnostics.push(diagnostic(filePath, error instanceof Error ? error.message : String(error), "read_failed"));
        continue;
      }
      if (!trustedRoots.some((root) => isWithinRoot(root, canonicalFilePath))) {
        diagnostics.push(diagnostic(filePath, "skill path escapes configured root", "path_escape"));
        continue;
      }
      let raw: string;
      try {
        raw = await readFile(filePath, "utf8");
      } catch (error) {
        diagnostics.push(diagnostic(filePath, error instanceof Error ? error.message : String(error), "read_failed"));
        continue;
      }
      const metadata = parseToolMetadata(raw, filePath);
      diagnostics.push(...metadata.diagnostics);
      if (!metadata.valid) continue;
      const invalidNativeMetadata = nativeResult.diagnostics.some((item) => item.path === nativeSkill.filePath && item.code === "invalid_metadata");
      if (invalidNativeMetadata) continue;
      candidates.push({ ...nativeSkill, filePath, allowedTools: metadata.allowedTools });
    }

    // A duplicate name is not assigned an implicit development/packaged priority.
    const counts = new Map<string, number>();
    for (const skill of candidates) counts.set(skill.name, (counts.get(skill.name) ?? 0) + 1);
    const skills = candidates.filter((skill) => {
      if ((counts.get(skill.name) ?? 0) <= 1) return true;
      diagnostics.push(diagnostic(skill.filePath, `duplicate skill name: ${skill.name}`, "duplicate_name"));
      return false;
    });
    return { skills, diagnostics };
  } finally {
    await env.cleanup();
  }
}

export async function loadSkillsFromDir(dir: string): Promise<{ skills: SkillDefinition[]; diagnostics: SkillDiagnostic[] }> {
  return loadSkillsFromRoots([dir]);
}

/**
 * Declared allowlists constrain the active global tools. A Skill without an
 * allowed-tools declaration intentionally leaves the global set unchanged.
 */
export function effectiveTools(globalTools: string[], activeSkills: SkillDefinition[]): string[] {
  const declared = activeSkills.filter((skill) => skill.allowedTools !== undefined);
  if (declared.length === 0) return globalTools;
  const allowed = new Set(declared.flatMap((skill) => skill.allowedTools ?? []));
  return globalTools.filter((tool) => allowed.has(tool));
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
