import { access, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "");
if (!root) throw new Error("Usage: node smoke-python-runtime.mjs <runtime-root>");
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const executable = path.join(root, process.platform === "win32" ? "python.exe" : "bin/python");
const fallbackExecutable = path.join(root, "Scripts", "python.exe");
const resolvedExecutable = await access(executable).then(() => executable).catch(() => fallbackExecutable);
await access(resolvedExecutable);
await new Promise((resolve, reject) => {
  const child = spawn(resolvedExecutable, ["-c", "import matplotlib, numpy, pandas; print('data-agent-python-runtime-ok'); print('matplotlib='+matplotlib.__version__)"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let error = "";
  child.stdout.on("data", chunk => output += chunk);
  child.stderr.on("data", chunk => error += chunk);
  child.on("error", reject);
  child.on("close", code => code === 0 && output.includes("data-agent-python-runtime-ok") && output.includes("matplotlib=")
    ? resolve()
    : reject(new Error(`runtime smoke failed: ${code}: ${error || output}`)));
});
console.log(JSON.stringify({ ok: true, runtimeId: manifest.runtimeId, pythonVersion: manifest.pythonVersion }));
