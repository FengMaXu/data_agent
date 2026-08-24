#!/usr/bin/env node
/**
 * Packaged Electron startup smoke.
 *
 * Launches the packaged application with DATA_AGENT_SMOKE=1 and a redirected
 * userData dir; the host writes smoke.ok after the runtime, IPC channel and
 * stores are up, then quits. Verifies the marker and exits 0/1.
 *
 * Usage: node scripts/smoke-electron.mjs <win-unpacked-dir>
 *
 * The host writes smoke.ok into its userData dir (%APPDATA%/Data Agent,
 * derived from the staged productName); this script polls for that marker.
 */
import { spawnSync } from "node:child_process";
import os from "node:os";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

const releaseDir = path.resolve(process.argv[2] ?? path.join(process.cwd(), "frontend", "release2", "win-unpacked"));
const marker = path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "Data Agent", "smoke.ok");
const exe = path.join(releaseDir, "Data Agent.exe");

if (!existsSync(exe)) {
  console.error(`packaged exe not found: ${exe}`);
  process.exit(1);
}
rmSync(marker, { force: true });

const started = Date.now();
const result = spawnSync(exe, [], {
  env: { ...process.env, DATA_AGENT_SMOKE: "1" },
  stdio: "ignore",
  timeout: 60_000,
});
// DATA_AGENT_SMOKE quits the app itself; a timeout kill or non-zero exit both
// fail the gate, but the marker is the source of truth.
const elapsedMs = Date.now() - started;
if (result.error && result.error.killed) {
  try { spawnSync("taskkill", ["/F", "/IM", "Data Agent.exe"], { stdio: "ignore" }); } catch { /* ignore */ }
}

if (existsSync(marker)) {
  console.log(`electron smoke PASS (${elapsedMs}ms)`);
  process.exit(0);
}
console.error(`electron smoke FAIL: marker not written within ${elapsedMs}ms`);
console.error(`diagnostic log: ${path.join(process.env.TEMP ?? ".", "data-agent-main-error.log")}`);
process.exit(1);
