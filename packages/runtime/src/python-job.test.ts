import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pythonJobEnvironment, runPythonJob } from "./python-job.js";

describe("Python workspace jobs", () => {
  it("removes host credentials from the subprocess environment", () => {
    expect(pythonJobEnvironment({
      PATH: "bin",
      TEMP: "tmp",
      OPENAI_API_KEY: "secret",
      DATA_AGENT_MYSQL_PASSWORD: "secret",
      DATABASE_URL: "postgres://secret",
      PGHOST: "internal-db",
      AWS_ACCESS_KEY_ID: "cloud-key",
      SESSION_TOKEN: "secret",
    })).toEqual({ PATH: "bin", TEMP: "tmp" });
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

  describe("workspace confinement", () => {
    const executable = process.platform === "win32" ? "python" : "python3";
    const withDirs = async (run: (workspace: string, outside: string) => Promise<void>) => {
      const workspace = await mkdtemp(join(tmpdir(), "data-agent-python-ws-"));
      const outside = await mkdtemp(join(tmpdir(), "..", "data-agent-python-outside-")).catch(() => mkdtemp(join(workspace, "..", "data-agent-python-outside-")));
      try { await run(workspace, outside); }
      finally { await rm(workspace, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
    };

    it("reads and writes files inside the workspace and imports the standard library", async () => {
      await withDirs(async (workspace) => {
        const code = [
          "import json, sqlite3, csv",
          "open('out.txt','w').write('x')",
          "print(open('out.txt').read(), len(__import__('os').listdir('.')) > 0)",
          "con = sqlite3.connect('local.db'); con.execute('select 1'); print('db ok')",
        ].join("\n");
        const result = await runPythonJob(code, { workspace, executable });
        expect(result.stderr).toBe("");
        expect(result.status).toBe("success");
        expect(result.stdout).toContain("x True");
        expect(result.stdout).toContain("db ok");
      });
    });

    it.each([
      ["reading a file", (target: string) => `open(${JSON.stringify(target)}).read()`],
      ["listing a directory", (target: string) => `__import__('os').listdir(${JSON.stringify(join(target, ".."))})`],
      ["connecting to an outside sqlite file", (target: string) => `__import__('sqlite3').connect(${JSON.stringify(target)})`],
      ["opening a sqlite uri", (target: string) => `__import__('sqlite3').connect(${JSON.stringify(`file:${target}?mode=ro`)}, uri=True)`],
      ["escaping through a relative path", () => "open('../../escape.txt','w')"],
    ])("refuses %s outside the workspace", async (_label, statement) => {
      await withDirs(async (workspace, outside) => {
        const target = join(outside, "gold.csv");
        await writeFile(target, "secret", "utf8");
        const result = await runPythonJob(statement(target), { workspace, executable });
        expect(result.status).toBe("error");
        expect(result.stderr).toContain("WORKSPACE_ACCESS_DENIED");
        expect(result.stdout).not.toContain("secret");
      });
    });

    it("walks outside directories without revealing their entries", async () => {
      await withDirs(async (workspace, outside) => {
        await writeFile(join(outside, "gold.csv"), "secret", "utf8");
        const result = await runPythonJob(`print(list(__import__('os').walk(${JSON.stringify(outside)})))`, { workspace, executable });
        expect(result.stdout).not.toContain("gold.csv");
      });
    });

    it("refuses subprocess and shell execution", async () => {
      await withDirs(async (workspace) => {
        for (const statement of ["__import__('subprocess').run(['whoami'])", "__import__('os').system('echo hi')"]) {
          const result = await runPythonJob(statement, { workspace, executable });
          expect(result.status).toBe("error");
          expect(result.stderr).toContain("WORKSPACE_ACCESS_DENIED");
        }
      });
    });

    it("removes the bootstrap after the job", async () => {
      await withDirs(async (workspace) => {
        await runPythonJob("print(1)", { workspace, executable });
        const { readdir } = await import("node:fs/promises");
        expect((await readdir(join(workspace, "scripts"))).some((name) => name.endsWith(".bootstrap.py"))).toBe(false);
      });
    });
  });
});
