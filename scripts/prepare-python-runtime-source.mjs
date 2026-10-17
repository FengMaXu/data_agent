#!/usr/bin/env node
/**
 * Prepares a relocatable Python source for build-python-runtime.mjs.
 *
 * A venv is not relocatable: its pyvenv.cfg points at the base interpreter on
 * the build machine, so a packaged venv fails on any machine without it. This
 * copies a uv-managed standalone CPython and installs the data pack into the
 * copy itself, so the result runs from whatever directory it is installed to.
 *
 * Usage: node scripts/prepare-python-runtime-source.mjs [output-dir]
 * Then:  node scripts/build-python-runtime.mjs <output-dir> dist/python-runtime
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const PYTHON_VERSION = "3.13.13";
// sqlglot is pinned by the Query Digest contract; numpy/pandas are pinned so packs are reproducible.
const PACKAGES = ["numpy==2.5.4", "pandas==3.0.6", "sqlglot==30.17.0"];

const root = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const output = path.resolve(process.argv[2] ?? path.join(root, ".tmp", "python-runtime-source"));
// Packages in the build user's site directory must not satisfy the install or its checks.
const env = { ...process.env, PYTHONNOUSERSITE: "1", PIP_USER: "0" };

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", env, stdio: ["ignore", "pipe", "inherit"] });
  if (result.status !== 0) {
    console.error(`command failed: ${command} ${args.join(" ")}`);
    process.exit(1);
  }
  return result.stdout.trim();
}

run("uv", ["python", "install", PYTHON_VERSION]);
const interpreter = run("uv", ["python", "find", PYTHON_VERSION, "--managed-python"]);
if (!existsSync(interpreter)) {
  console.error(`uv did not return a managed CPython ${PYTHON_VERSION}: ${interpreter}`);
  process.exit(1);
}

rmSync(output, { recursive: true, force: true });
cpSync(path.dirname(interpreter), output, { recursive: true });
// The PEP 668 marker protects uv's shared interpreter; this private copy is ours to install into.
rmSync(path.join(output, "Lib", "EXTERNALLY-MANAGED"), { force: true });
const executable = path.join(output, process.platform === "win32" ? "python.exe" : "bin/python3");
run(executable, ["-s", "-m", "pip", "install", "--disable-pip-version-check", "--no-warn-script-location", ...PACKAGES]);
console.log(run(executable, ["-s", "-c", "import sys, numpy, pandas, sqlglot; print(sys.prefix, numpy.__version__, pandas.__version__, sqlglot.__version__)"]));
console.log(`python runtime source OK -> ${output}`);
