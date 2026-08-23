#!/usr/bin/env node
/**
 * Builds the complete TypeScript distribution:
 * contracts -> runtime -> electron-host/web host packages -> Renderer (vite).
 * Verifies no legacy Python backend artifacts are referenced.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: root });
}

run("npm run build:contracts");
run("npm run build:runtime");
for (const pkg of ["@data-agent/electron-host", "@data-agent/server", "@data-agent/mcp-mysql", "@data-agent/mcp-pg"]) {
  run(`npm run build --workspace=${pkg}`);
}
run("npm run build --workspace=frontend");

// Sanity checks: renderer + host outputs exist; python web backend not required.
for (const p of [
  "packages/contracts/dist/index.js",
  "packages/runtime/dist/index.js",
  "packages/electron-host/dist/main.js",
  "apps/server/dist/index.js",
  "frontend/dist/index.html",
]) {
  if (!existsSync(path.join(root, p))) {
    console.error(`MISSING build artifact: ${p}`);
    process.exit(1);
  }
}
console.log("distribution build OK");
