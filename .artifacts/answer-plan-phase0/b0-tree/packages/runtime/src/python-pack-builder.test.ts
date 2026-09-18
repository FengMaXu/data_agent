import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writePythonPackManifest } from "./python-pack-builder.js";

describe("Python pack builder", () => {
  it("writes a reproducible hash manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-pack-"));
    await writeFile(join(root, "runtime.txt"), "python");
    const manifestPath = await writePythonPackManifest(root, { runtimeId: "test", packs: ["base"] });
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(manifest.sha256).toMatch(/^[a-f0-9]{64}$/);
    await rm(root, { recursive: true, force: true });
  });
});
