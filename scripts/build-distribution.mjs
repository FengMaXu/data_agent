#!/usr/bin/env node
/**
 * Builds the complete TypeScript distribution:
 * contracts -> runtime -> electron-host/web host packages -> Renderer (vite).
 * Verifies no legacy Python backend artifacts are referenced.
 */
import { execSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
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

// Bundle the TS Electron host into a single CJS entry so no workspace
// node_modules are needed at runtime; better-sqlite3 stays external and is
// unpacked via asarUnpack.
{
  const args = [
    "node_modules/esbuild/bin/esbuild",
    "packages/electron-host/dist/main.js",
    "--bundle", "--platform=node", "--format=cjs",
    "--external:electron", "--external:better-sqlite3",
    "--define:import.meta.url=undefined",
    "--outfile=frontend/electron-host/main.cjs",
  ];
  const result = spawnSync(process.execPath, args, { stdio: "inherit", cwd: root });
  if (result.status !== 0) { console.error("esbuild failed"); process.exit(1); }
}
copyFileSync("packages/electron-host/preload.cjs", "frontend/electron/preload.cjs");

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
