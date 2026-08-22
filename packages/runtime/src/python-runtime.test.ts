import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRuntimeManifest, resolvePythonRuntime } from "./python-runtime.js";

describe("Python Runtime packs", () => {
  it("loads a manifest and falls back to bundled runtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-python-runtime-"));
    await writeFile(join(root, "manifest.json"), JSON.stringify({ runtimeId: "bundled", pythonVersion: "3.13", platform: "win32", arch: "x64", packs: ["base", "data", "visual"] }));
    const manifest = await loadRuntimeManifest(root);
    expect((await resolvePythonRuntime(undefined, join(root, "python.exe"), manifest)).mode).toBe("bundled");
    await rm(root, { recursive: true, force: true });
  });
});
