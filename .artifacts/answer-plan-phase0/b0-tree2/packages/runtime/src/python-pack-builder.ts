import { createHash } from "node:crypto";
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

export async function writePythonPackManifest(packRoot: string, manifest: Record<string, unknown>): Promise<string> {
  const files = await readdir(packRoot, { recursive: true });
  const hash = createHash("sha256");
  for (const file of files.sort()) { try { hash.update(await readFile(path.join(packRoot, file))); } catch { /* directories */ } }
  const output = { ...manifest, sha256: hash.digest("hex") };
  const target = path.join(packRoot, "manifest.json"); await writeFile(target, JSON.stringify(output, null, 2), "utf8"); return target;
}
