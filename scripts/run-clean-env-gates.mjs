#!/usr/bin/env node
/**
 * Gate C — Windows clean-environment readiness gate.
 *
 * Orchestrates the full pipeline from a clean build state:
 *   1. clean distribution build (contracts, runtime, hosts, MCP packs, renderer)
 *   2. Fastify Web Host startup smoke
 *   3. Python runtime pack smoke (base/data/visual probes)
 *   4. Electron packaging (win-unpacked + NSIS installer)
 *   5. Packaged Electron startup smoke (DATA_AGENT_SMOKE)
 *   6. Component size / latency budgets (Gate K)
 *
 * Exits non-zero on the first failing gate. Each gate's result is printed as
 * [gate-id] PASS/FAIL so the A-K report can quote it verbatim.
 */
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const results = [];

function run(name, cmd, args, { env = {}, cwd = root } = {}) {
  process.stdout.write(`[${name}] running... `);
  const started = Date.now();
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: 20 * 60_000,
    env: { ...process.env, ...env },
  });
  const durationS = Math.round((Date.now() - started) / 1000);
  const ok = result.status === 0;
  results.push({ name, ok, durationS });
  console.log(ok ? `PASS (${durationS}s)` : `FAIL (${durationS}s)`);
  if (!ok) {
    const tail = (result.stdout ?? "").split("\n").slice(-15).join("\n");
    const errTail = (result.stderr ?? "").split("\n").slice(-15).join("\n");
    console.error(tail);
    console.error(errTail);
  }
  return ok;
}

// 1. Clean build
rmSync(path.join(root, "packages", "contracts", "dist"), { recursive: true, force: true });
rmSync(path.join(root, "packages", "runtime", "dist"), { recursive: true, force: true });
rmSync(path.join(root, "packages", "electron-host", "dist"), { recursive: true, force: true });
rmSync(path.join(root, "apps", "server", "dist"), { recursive: true, force: true });
if (!run("C1-build", "node", ["scripts/build-distribution.mjs"])) process.exit(1);

// 2. Web host smoke
if (!run("C2-web-host-smoke", "node", ["scripts/smoke-web-host.mjs"])) process.exit(1);

// 3. Python runtime pack smoke
if (!run("C3-python-pack-smoke", "node", ["scripts/smoke-python-runtime.mjs", "dist/python-runtime"])) process.exit(1);

// 4. Electron packaging (unpacked + installer)
const releaseDir = path.join(root, "frontend", "release2", "win-unpacked");
if (!run("C4-package", "node", ["scripts/package-electron-manual.mjs", releaseDir])) process.exit(1);

// 5. Packaged Electron startup smoke
if (!run("C5-electron-smoke", "node", ["scripts/smoke-electron.mjs", releaseDir])) process.exit(1);

// 6. Budgets
if (!run("C6-budgets", "node", ["scripts/measure-budgets.mjs", releaseDir])) process.exit(1);

console.log("\nGate C summary:");
for (const r of results) console.log(`  [${r.name}] ${r.ok ? "PASS" : "FAIL"} (${r.durationS}s)`);
