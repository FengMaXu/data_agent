import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const source = process.argv[2]; const output = process.argv[3];
if (!source || !output) throw new Error("Usage: node build-python-runtime.mjs <source-runtime> <output-runtime>");
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true, force: true });
const hash = createHash("sha256");
const executableRelative = process.platform === "win32" ? (await readFile(path.join(output, "python.exe")).then(() => "python.exe").catch(() => "Scripts/python.exe")) : "bin/python";
const files = await readFile(path.join(output, executableRelative));
hash.update(files);
const manifest = { runtimeId: `python-data-${process.platform}-${process.arch}`, pythonVersion: process.env.PYTHON_VERSION ?? "3.13.x", platform: process.platform, arch: process.arch, packs: ["base", "data", "visual"], sha256: hash.digest("hex") };
await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
console.log(JSON.stringify(manifest));
