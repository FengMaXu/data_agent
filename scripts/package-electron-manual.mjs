#!/usr/bin/env node
/**
 * Manual Windows --dir packaging for the TypeScript Electron app.
 *
 * electron-builder's directory packaging intermittently fails on this machine
 * with EPERM when renaming the freshly extracted Electron distribution (real-time
 * antivirus holds a handle on the new directory). This script performs the same
 * steps deterministically:
 *
 *   1. copy the local Electron runtime into <out>/win-unpacked
 *   2. rename electron.exe -> Data Agent.exe
 *   3. pack the application (package.json + dist + electron + electron-host)
 *      into resources/app.asar with *.node unpacked
 *   4. stage extraResources (python-runtime, ktx-semantic-context)
 */
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const frontend = path.join(root, "frontend");
const out = process.argv[2] ?? path.join(frontend, "release-manual", "win-unpacked");
const pkg = JSON.parse(await import("node:fs").then(m => m.readFileSync(path.join(frontend, "package.json"), "utf8")));

if (!existsSync(path.join(frontend, "dist", "index.html"))) {
  console.error("Renderer build missing; run scripts/build-distribution.mjs first");
  process.exit(1);
}
if (!existsSync(path.join(frontend, "electron-host", "main.cjs"))) {
  console.error("Electron host bundle missing; run scripts/build-distribution.mjs first");
  process.exit(1);
}

// Windows AV/indexer can briefly hold handles on a freshly written tree, and a
// previous smoke run's processes may linger; clear both before restaging.
if (process.platform === "win32") {
  spawnSync("taskkill", ["/F", "/IM", "Data Agent.exe"], { stdio: "ignore", shell: true });
}
for (let attempt = 1; ; attempt++) {
  try { rmSync(out, { recursive: true, force: true }); break; }
  catch (error) {
    if (attempt >= 12) throw error;
    // Real-time protection can hold the previous build's asar for ~1 minute
    // after the owning process exits; re-kill stragglers and back off.
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/F", "/IM", "Data Agent.exe"], { stdio: "ignore", shell: true });
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000 * attempt);
  }
}
mkdirSync(out, { recursive: true });

// 1. Electron runtime
cpSync(path.join(frontend, "node_modules", "electron", "dist"), out, { recursive: true });

// The stock default_app.asar is replaced by our application archive.
rmSync(path.join(out, "resources", "default_app.asar"), { force: true });

// 2. Product executable name
const exeName = `${pkg.build?.productName ?? "Data Agent"}.exe`;
renameSync(path.join(out, "electron.exe"), path.join(out, exeName));

// 3. Application archive (*.node stays unpacked next to the asar)
const staging = path.join(root, ".tmp", "electron-app-stage");
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
const appPkg = {
  name: "data-agent",
  productName: "Data Agent",
  version: pkg.version,
  description: pkg.description,
  main: "electron-host/main.cjs",
  type: "commonjs",
};
writeFileSync(path.join(staging, "package.json"), JSON.stringify(appPkg, null, 2));
cpSync(path.join(frontend, "dist"), path.join(staging, "dist"), { recursive: true });
cpSync(path.join(frontend, "electron"), path.join(staging, "electron"), { recursive: true });
mkdirSync(path.join(staging, "electron-host"), { recursive: true });
cpSync(path.join(frontend, "electron-host", "main.cjs"), path.join(staging, "electron-host", "main.cjs"));

// Native module + its runtime deps ship inside the archive but with *.node unpacked.
// npm may hoist better-sqlite3 to the workspace root, so probe both locations.
const moduleRoots = [path.join(frontend, "node_modules"), path.join(root, "node_modules")];
function resolveModule(name) {
  for (const dir of moduleRoots) {
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  console.error(`${name} not found in ${moduleRoots.join(", ")}`);
  process.exit(1);
}
mkdirSync(path.join(staging, "node_modules"), { recursive: true });
for (const name of ["better-sqlite3", "bindings", "file-uri-to-path"]) {
  cpSync(resolveModule(name), path.join(staging, "node_modules", name), { recursive: true });
}

// The workspace copy of better-sqlite3 is compiled for the local Node ABI.
// Re-fetch the prebuilt binary matching the packaged Electron ABI so the
// native module loads inside the shipped application.
const electronMajor = pkg.devDependencies?.electron ?? pkg.dependencies?.electron;
const electronVersion = String(electronMajor).replace(/[^\d.]/g, "");
exec(process.platform === "win32" ? "npx.cmd" : "npx", [
  "prebuild-install",
  "--runtime=electron", `--target=${electronVersion}`, "--arch=x64", "--verbose",
], { cwd: path.join(staging, "node_modules", "better-sqlite3") });

const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
exec(npxCmd, ["@electron/asar", "pack", staging, path.join(out, "resources", "app.asar"), "--unpack=*.node"]);

// 4. extraResources
for (const res of pkg.build?.extraResources ?? []) {
  const from = path.resolve(frontend, res.from);
  if (!existsSync(from)) {
    console.warn(`extraResource missing (skipped): ${res.from}`);
    continue;
  }
  const to = path.join(out, "resources", res.to);
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
}

// 5. Windows installer (NSIS from the electron-builder cache; electron-builder's
// own packaging flow intermittently fails with EPERM renaming its staging dir).
if (process.env.SKIP_INSTALLER !== "1") {
  const makensis = path.join(process.env.LOCALAPPDATA ?? "", "electron-builder", "Cache", "nsis", "nsis-3.0.4.1-nsis-3.0.4.1", "makensis.exe");
  if (!existsSync(makensis)) {
    console.warn("makensis not found; skipping installer");
  } else {
    const template = await import("node:fs").then(m => m.readFileSync(path.join(root, "scripts", "installer.template.nsi"), "utf8"));
    const releaseDir = path.dirname(out);
    const nsi = template
      .replace("{{SRC_DIR}}", path.resolve(out))
      .replace("{{OUT_FILE}}", path.resolve(releaseDir, "Data Agent Setup.exe"));
    const nsiPath = path.join(releaseDir, "data-agent.nsi");
    writeFileSync(nsiPath, nsi);
    exec(makensis, [nsiPath]);
    console.log(`installer OK -> ${path.join(releaseDir, "Data Agent Setup.exe")}`);
  }
}

console.log(`manual packaging OK -> ${out}`);

function exec(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", ...opts });
  if (result.status !== 0) {
    console.error(`command failed: ${cmd} ${args.join(" ")}`);
    process.exit(1);
  }
}
