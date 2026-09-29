#!/usr/bin/env node
/**
 * Pre-push checks for the workspaces a branch can affect: the changed ones
 * and everything downstream of them. Upstream workspaces are only built,
 * because workspaces consume each other's build output. CI still runs the
 * full suite on every PR into develop or master.
 *
 *   node scripts/check-affected.mjs [--base <ref>] [--dry-run] [--all]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Paths outside any workspace that no workspace test or typecheck reads. */
const IGNORED = [/^docs\//, /^[^/]+\.md$/, /^\.github\//, /^evaluations\//, /^\.gitignore$/, /^\.gitattributes$/];
/** Paths outside a workspace that a workspace's tests do read. */
const READ_BY = [[/^\.agents\//, "@data-agent/runtime"]];
/** Root scripts checked by something narrower than a full run; anything else under scripts/ falls back to full. */
const SCRIPT_CHECKS = [
  // The architecture gate always runs.
  [/^scripts\/verify-backend-architecture\.mjs$/, { scripts: [] }],
  [/^scripts\/check-affected(\.test)?\.mjs$/, { scripts: ["test:scripts"] }],
  // Release-only scripts: typecheck and tests do not run them; verify:backend does.
  [/^scripts\/(build-distribution|smoke-web-host|smoke-electron|smoke-python-runtime|build-python-runtime|package-electron-manual|measure-budgets|write-build-provenance|run-clean-env-gates|start-web-host)\.mjs$/, { scripts: [], hint: "release scripts changed: run npm run verify:backend before merging develop into master" }],
];

/** Workspaces from the root package.json globs, with their in-repo dependencies. */
export function loadWorkspaces(root) {
  const globs = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).workspaces;
  const dirs = globs.flatMap((glob) => {
    if (!glob.endsWith("/*")) return [glob];
    const parent = glob.slice(0, -2);
    return readdirSync(path.join(root, parent), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => `${parent}/${entry.name}`);
  }).filter((dir) => existsSync(path.join(root, dir, "package.json")));
  const manifests = dirs.map((dir) => ({ dir, manifest: JSON.parse(readFileSync(path.join(root, dir, "package.json"), "utf8")) }));
  const names = new Set(manifests.map(({ manifest }) => manifest.name));
  return manifests.map(({ dir, manifest }) => ({
    name: manifest.name,
    dir,
    scripts: Object.keys(manifest.scripts ?? {}),
    deps: Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies }).filter((dep) => names.has(dep)),
  }));
}

/** Workspaces in dependency order, dependencies first. */
function topoOrder(workspaces) {
  const byName = new Map(workspaces.map((workspace) => [workspace.name, workspace]));
  const ordered = [];
  const seen = new Set();
  const visit = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    for (const dep of byName.get(name).deps) visit(dep);
    ordered.push(byName.get(name));
  };
  for (const workspace of workspaces) visit(workspace.name);
  return ordered;
}

function closure(start, next) {
  const result = new Set(start);
  const queue = [...start];
  while (queue.length > 0) for (const name of next(queue.shift())) if (!result.has(name)) { result.add(name); queue.push(name); }
  return result;
}

/**
 * What to build, check and test for a set of changed files.
 * `full` is true when a change can affect every workspace (root manifests, lockfile, shared scripts or config).
 */
export function planChecks(workspaces, changedFiles, { all = false } = {}) {
  const touched = new Set();
  const fullBecause = [];
  const rootScripts = new Set();
  const hints = new Set();
  for (const file of changedFiles) {
    const owner = workspaces.find((workspace) => file.startsWith(`${workspace.dir}/`));
    const scriptCheck = SCRIPT_CHECKS.find(([pattern]) => pattern.test(file));
    if (owner) touched.add(owner.name);
    else if (IGNORED.some((pattern) => pattern.test(file))) continue;
    else if (scriptCheck) {
      for (const script of scriptCheck[1].scripts) rootScripts.add(script);
      if (scriptCheck[1].hint) hints.add(scriptCheck[1].hint);
    } else {
      const reader = READ_BY.find(([pattern]) => pattern.test(file));
      if (reader) touched.add(reader[1]);
      else fullBecause.push(file);
    }
  }
  const full = all || fullBecause.length > 0;
  const dependents = (name) => workspaces.filter((workspace) => workspace.deps.includes(name)).map((workspace) => workspace.name);
  const dependencies = (name) => workspaces.find((workspace) => workspace.name === name).deps;
  const affected = full ? new Set(workspaces.map((workspace) => workspace.name)) : closure(touched, dependents);
  const built = closure(affected, dependencies);
  const order = topoOrder(workspaces);
  return {
    full,
    fullBecause,
    rootScripts: full ? ["test:scripts"] : [...rootScripts],
    hints: [...hints],
    build: order.filter((workspace) => built.has(workspace.name) && workspace.scripts.includes("build")).map((workspace) => workspace.name),
    check: order.filter((workspace) => affected.has(workspace.name)).map((workspace) => ({
      name: workspace.name,
      scripts: ["typecheck", "typecheck:negative", "test"].filter((script) => workspace.scripts.includes(script)),
    })),
  };
}

function git(root, args) {
  // quotePath=false: otherwise non-ASCII paths come back quoted and octal-escaped.
  return execFileSync("git", ["-c", "core.quotePath=false", ...args], { cwd: root, encoding: "utf8" }).split("\n").map((line) => line.trim()).filter(Boolean);
}

/** Committed changes since the merge base, plus staged, unstaged and untracked files. */
function changedFiles(root, base) {
  const mergeBase = git(root, ["merge-base", base, "HEAD"])[0];
  return [...new Set([
    ...git(root, ["diff", "--name-only", mergeBase]),
    ...git(root, ["ls-files", "--others", "--exclude-standard"]),
  ])].map((file) => file.replaceAll("\\", "/"));
}

function run(root, args) {
  console.log(`\n> npm ${args.join(" ")}`);
  // npm is npm.cmd on Windows, which needs a shell.
  const result = spawnSync("npm", args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    console.error(`\ncheck:affected failed at: npm ${args.join(" ")}`);
    process.exit(result.status ?? 1);
  }
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const argv = process.argv.slice(2);
  const baseIndex = argv.indexOf("--base");
  const base = baseIndex >= 0 ? argv[baseIndex + 1] : "origin/develop";
  const files = changedFiles(root, base);
  const plan = planChecks(loadWorkspaces(root), files, { all: argv.includes("--all") });

  console.log(`Changed files since ${base}: ${files.length}`);
  if (plan.full) console.log(`Full run${plan.fullBecause.length > 0 ? `, because of: ${plan.fullBecause.slice(0, 5).join(", ")}${plan.fullBecause.length > 5 ? ", ..." : ""}` : " (--all)"}`);
  console.log(`Build: ${plan.build.join(", ") || "(none)"}`);
  console.log(`Check: ${plan.check.map((item) => `${item.name} [${item.scripts.join(", ")}]`).join("; ") || "(none)"}`);
  if (plan.rootScripts.length > 0) console.log(`Root scripts: ${plan.rootScripts.join(", ")}`);
  for (const hint of plan.hints) console.log(`Note: ${hint}`);
  if (argv.includes("--dry-run")) return;

  run(root, ["run", "verify:architecture"]);
  for (const name of plan.build) run(root, ["run", "build", `--workspace=${name}`]);
  for (const item of plan.check) for (const script of item.scripts) run(root, ["run", script, `--workspace=${item.name}`]);
  for (const script of plan.rootScripts) run(root, ["run", script]);
  console.log("\ncheck:affected OK");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
