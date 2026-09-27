#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

async function hashTree(root) {
  const hash = createHash("sha256");
  const walk = async (directory, relative = "") => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      const child = path.join(relative, entry.name).split(path.sep).join("/");
      if (entry.isDirectory()) await walk(full, child);
      else if (entry.isFile()) {
        hash.update(child);
        hash.update("\0");
        hash.update(await readFile(full));
        hash.update("\0");
      }
    }
  };
  await walk(root);
  return hash.digest("hex");
}

const packageRoot = path.resolve(process.argv[2] ?? process.cwd());
const sourceRoot = path.join(packageRoot, "src");
const distRoot = path.join(packageRoot, "dist");
const packageJson = path.join(packageRoot, "package.json");
const tsconfig = path.join(packageRoot, "tsconfig.json");
const lockfile = path.resolve(packageRoot, "..", "..", "package-lock.json");
const provenance = {
  schemaVersion: 1,
  package: JSON.parse(await readFile(packageJson, "utf8")).name,
  sourceSha256: await hashTree(sourceRoot),
  packageSha256: createHash("sha256").update(await readFile(packageJson)).digest("hex"),
  tsconfigSha256: createHash("sha256").update(await readFile(tsconfig)).digest("hex"),
  lockfileSha256: await readFile(lockfile).then((bytes) => createHash("sha256").update(bytes).digest("hex")).catch(() => null),
};
await mkdir(distRoot, { recursive: true });
await writeFile(path.join(distRoot, "build-provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ package: provenance.package, sourceSha256: provenance.sourceSha256 }, null, 2));
