import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const source = process.argv[2]; const output = process.argv[3];
if (!source || !output) throw new Error("Usage: node build-python-runtime.mjs <source-runtime> <output-runtime>");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true, force: true });
const hash = createHash("sha256");
const executableRelative = process.platform === "win32" ? (await readFile(path.join(output, "python.exe")).then(() => "python.exe").catch(() => "Scripts/python.exe")) : "bin/python";
const executable = path.join(output, executableRelative);
const files = await readFile(executable);
// The manifest must describe an executable capability, not an intended one.
// Fail the pack build if the visual dependencies are absent or unimportable.
const visualCheck = spawnSync(executable, ["-c", "import matplotlib, numpy, pandas; print('matplotlib='+matplotlib.__version__)"], { encoding: "utf8" });
if (visualCheck.status !== 0) {
  console.error(`Python data/visual pack is incomplete: numpy, pandas, and matplotlib must import successfully\\n${visualCheck.stderr || visualCheck.stdout}`);
  process.exit(1);
}
hash.update(files);
const manifest = { runtimeId: `python-data-${process.platform}-${process.arch}`, pythonVersion: process.env.PYTHON_VERSION ?? "3.13.x", platform: process.platform, arch: process.arch, packs: ["base", "data", "visual"], sha256: hash.digest("hex") };
await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
console.log(JSON.stringify(manifest));
