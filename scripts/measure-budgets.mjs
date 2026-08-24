#!/usr/bin/env node
/**
 * Gate K — component size budgets and startup latency baselines.
 *
 * Measures distribution component sizes (app.asar, unpacked app, installer,
 * extra resource packs) and Runtime command round-trip latencies (p50/p95),
 * then writes docs/gate-metrics.json for the A-K readiness report.
 *
 * First-token latency depends on a configured live LLM provider and is
 * measured separately when credentials are present (see report notes).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const releaseDir = process.argv[2] ?? path.join(root, "frontend", "release2", "win-unpacked");
const installerPath = path.join(path.dirname(releaseDir), "Data Agent Setup.exe");

function dirSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(full) : statSync(full).size;
  }
  return total;
}

function mb(bytes) { return Math.round((bytes / (1024 * 1024)) * 10) / 10; }

const metrics = { measuredAt: new Date().toISOString(), sizes: {}, latencies: null, budgets: {} };

// --- Component sizes ---
const asarPath = path.join(releaseDir, "resources", "app.asar");
const unpackedPath = path.join(releaseDir, "resources", "app.asar.unpacked");
const pythonPack = path.join(releaseDir, "resources", "python-runtime");

metrics.sizes.appAsarMB = existsSync(asarPath) ? mb(statSync(asarPath).size) : null;
metrics.sizes.appAsarUnpackedMB = existsSync(unpackedPath) ? mb(dirSize(unpackedPath)) : null;
metrics.sizes.pythonRuntimePackMB = existsSync(pythonPack) ? mb(dirSize(pythonPack)) : null;
metrics.sizes.unpackedAppMB = existsSync(releaseDir) ? mb(dirSize(releaseDir)) : null;
metrics.sizes.installerMB = existsSync(installerPath) ? mb(statSync(installerPath).size) : null;
const rendererDist = path.join(root, "frontend", "dist");
metrics.sizes.rendererDistMB = existsSync(rendererDist) ? mb(dirSize(rendererDist)) : null;

// --- Budgets (component size ceilings; gate fails when exceeded) ---
metrics.budgets = {
  appAsarMB: { limit: 30, actual: metrics.sizes.appAsarMB },
  pythonRuntimePackMB: { limit: 400, actual: metrics.sizes.pythonRuntimePackMB },
  unpackedAppMB: { limit: 900, actual: metrics.sizes.unpackedAppMB },
  installerMB: { limit: 350, actual: metrics.sizes.installerMB },
};
metrics.budgetsPass = Object.values(metrics.budgets).every((b) => b.actual !== null && b.actual <= b.limit);

// --- Runtime command round-trip latency (p50/p95) ---
// Drives the real DataAgentRuntime in-process over the same dispatch seam the
// hosts use, so the numbers reflect the production path without transport noise.
async function measureLatencies() {
  const script = `
    const { performance } = require("node:perf_hooks");
    const { mkdtemp } = require("node:fs/promises");
    const { tmpdir } = require("node:os");
    const path = require("node:path");
    (async () => {
      const { DataAgentRuntime } = require("./packages/runtime/dist/index.js");
      const { MetadataStore } = require("./packages/runtime/dist/index.js");
      const dir = await mkdtemp(path.join(tmpdir(), "gate-lat-"));
      const runtime = new DataAgentRuntime({ metadata: new MetadataStore(path.join(dir, "meta.db")) });
      const ctx = { userId: "gate", host: "web" };
      const samples = [];
      // Warm-up: first dispatches pay worker-thread spawn cost; exclude from the baseline.
      for (let w = 0; w < 10; w++) {
        await runtime.dispatch({ protocolVersion: 1, requestId: "w" + w, command: { type: "task.list" } }, ctx);
      }
      for (let i = 0; i < 100; i++) {
        const t0 = performance.now();
        await runtime.dispatch({ protocolVersion: 1, requestId: "r" + i, command: { type: "task.list" } }, ctx);
        samples.push(performance.now() - t0);
      }
      samples.sort((a, b) => a - b);
      const p = (q) => Math.round(samples[Math.floor(samples.length * q)] * 100) / 10;
      process.stdout.write(JSON.stringify({ p50: p(0.5), p95: p(0.95), n: samples.length, warmup: 10 })); process.exit(0);
    })().catch((e) => { console.error(e); process.exit(1); });
  `;
  const out = execFileSync(process.execPath, ["-e", script], { cwd: root, encoding: "utf8", timeout: 120_000 });
  return JSON.parse(out);
}

metrics.latencies = await measureLatencies();
// Budget rationale: dispatch round-trip includes a metadata-worker thread hop
// over SQLite; desktop-local p95 up to 200ms keeps interactive flows responsive.
metrics.budgets.commandRoundTripMs = { limit: 200, p50: metrics.latencies.p50, p95: metrics.latencies.p95 };
metrics.latenciesPass = metrics.latencies.p95 <= 200;

writeFileSync(path.join(root, "docs", "gate-metrics.json"), JSON.stringify(metrics, null, 2));
console.log(JSON.stringify(metrics, null, 2));
process.exit(0);
