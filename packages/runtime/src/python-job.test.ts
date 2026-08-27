import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pythonJobEnvironment, runPythonJob } from "./python-job.js";

describe("Python workspace jobs", () => {
  it("removes host credentials from the subprocess environment", () => {
    expect(pythonJobEnvironment({ PATH: "bin", OPENAI_API_KEY: "secret", DATA_AGENT_MYSQL_PASSWORD: "secret", SESSION_TOKEN: "secret" })).toEqual({ PATH: "bin" });
  });

  it("times out long-running code", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "data-agent-python-timeout-"));
    const result = await runPythonJob("import time\ntime.sleep(10)", { workspace, executable: process.platform === "win32" ? "python" : "python3", timeoutMs: 500 });
    expect(result.status).toBe("timeout");
    await rm(workspace, { recursive: true, force: true });
  });

  it("executes code and captures output", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "data-agent-python-"));
    const result = await runPythonJob("print('ok')", { workspace, executable: process.platform === "win32" ? "python" : "python3" });
    expect(result.status).toBe("success");
    expect(result.stdout).toContain("ok");
    expect(result.artifacts).toContain("scripts");
    await rm(workspace, { recursive: true, force: true });
  });
});
