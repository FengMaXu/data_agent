import { access, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const root = process.argv[2];
if (!root) throw new Error("Usage: node smoke-python-runtime.mjs <runtime-root>");
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const executable = path.join(root, process.platform === "win32" ? "python.exe" : "bin/python");
await access(executable);
await new Promise((resolve, reject) => { const child = spawn(executable, ["-c", "print('data-agent-python-runtime-ok')"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] }); let output=""; child.stdout.on("data", chunk => output += chunk); child.on("error", reject); child.on("close", code => code === 0 && output.includes("data-agent-python-runtime-ok") ? resolve() : reject(new Error(`runtime smoke failed: ${code}`))); });
console.log(JSON.stringify({ ok: true, runtimeId: manifest.runtimeId, pythonVersion: manifest.pythonVersion }));
