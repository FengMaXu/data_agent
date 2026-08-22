import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

export interface PythonJobResult { jobId: string; status: "success" | "error" | "timeout" | "aborted"; exitCode: number | null; stdout: string; stderr: string; scriptPath: string; artifacts: string[]; durationMs: number }
export async function runPythonJob(code: string, options: { workspace: string; executable: string; timeoutMs?: number; signal?: AbortSignal }): Promise<PythonJobResult> {
  const jobId = randomUUID(); const started = Date.now(); const scripts = path.join(options.workspace, "scripts"); await mkdir(scripts, { recursive: true }); const scriptPath = path.join(scripts, `${jobId}.py`); await writeFile(scriptPath, code, "utf8");
  return await new Promise((resolve) => { const child = spawn(options.executable, [scriptPath], { cwd: options.workspace, shell: false, windowsHide: true }); let stdout="", stderr=""; child.stdout.on("data", chunk => { stdout += chunk.toString(); }); child.stderr.on("data", chunk => { stderr += chunk.toString(); }); let status: PythonJobResult["status"] = "error"; const timer = setTimeout(() => { status="timeout"; child.kill(); }, options.timeoutMs ?? 60000); const abort = () => { status="aborted"; child.kill(); }; options.signal?.addEventListener("abort", abort, { once: true }); child.on("error", error => { clearTimeout(timer); readdir(options.workspace).then((artifacts) => resolve({ jobId,status,exitCode:null,stdout,stderr: `${stderr}${error.message}`,scriptPath,artifacts,durationMs:Date.now()-started })); }); child.on("close", code => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); if(status !== "timeout" && status !== "aborted") status=code===0?"success":"error"; readdir(options.workspace).then((artifacts) => resolve({jobId,status,exitCode:code,stdout,stderr,scriptPath,artifacts,durationMs:Date.now()-started})); }); });
}
