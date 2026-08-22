import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPythonJob } from "./python-job.js";

describe("Python workspace jobs", () => {
  it("executes code and captures output", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "data-agent-python-"));
    const result = await runPythonJob("print('ok')", { workspace, executable: process.platform === "win32" ? "python" : "python3" });
    expect(result.status).toBe("success");
    expect(result.stdout).toContain("ok");
    expect(result.artifacts).toContain("scripts");
    await rm(workspace, { recursive: true, force: true });
  });
});
