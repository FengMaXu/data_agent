import { access, readFile } from "node:fs/promises";
import path from "node:path";

export interface PythonRuntimeManifest { runtimeId: string; pythonVersion: string; platform: string; arch: string; packs: string[]; sha256?: string }
export interface PythonRuntimeConfig { mode: "external" | "bundled"; executable: string; manifest?: PythonRuntimeManifest }
export async function probePython(executable: string): Promise<boolean> { try { await access(executable); return true; } catch { return false; } }
export async function loadRuntimeManifest(runtimeRoot: string): Promise<PythonRuntimeManifest> { return JSON.parse(await readFile(path.join(runtimeRoot, "manifest.json"), "utf8")) as PythonRuntimeManifest; }
export async function resolvePythonRuntime(external: string | undefined, bundled: string, manifest?: PythonRuntimeManifest): Promise<PythonRuntimeConfig> { if (external && await probePython(external)) return { mode: "external", executable: external }; return { mode: "bundled", executable: bundled, manifest }; }
