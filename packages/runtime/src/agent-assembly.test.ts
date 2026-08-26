import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAgentTools, type QueryExportBatch } from "./agent-assembly.js";
import { WorkspaceStore } from "./workspace.js";

function exportTool(workspace: WorkspaceStore, queryExecutor: any, emitArtifact?: (path: string) => void): any {
  return buildAgentTools({ workspace, queryExecutor, emitArtifact }).find((tool) => tool.name === "export_query");
}

async function tempFiles(root: string): Promise<string[]> {
  try {
    return (await readdir(root, { recursive: true }) as string[]).filter((entry) => entry.endsWith(".tmp"));
  } catch {
    return [];
  }
}

describe("export_query", () => {
  it("streams a 100,000-row result and preserves CSV escaping", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-export-stream-"));
    const workspace = new WorkspaceStore(root);
    const batches = async function* (): AsyncGenerator<QueryExportBatch> {
      for (let offset = 0; offset < 100_000; offset += 1_000) {
        yield {
          columns: ["id", "value"],
          rows: Array.from({ length: 1_000 }, (_, index) => [offset + index + 1, index === 98 ? "comma,value" : `row-${offset + index + 1}`]),
        };
      }
    };
    const artifacts: string[] = [];
    const tool = exportTool(workspace, { stream: () => batches(), run: async () => { throw new Error("run should not be used"); } }, (path) => artifacts.push(path));
    try {
      await tool.execute("call-1", { sql: "SELECT id, value FROM rows", filename: "exports/large.csv" });
      const content = await readFile(join(root, "exports", "large.csv"), "utf8");
      expect(content.split("\n")).toHaveLength(100_001);
      expect(content.startsWith("id,value\n1,\"row-1\"\n2,\"row-2\"\n")).toBe(true);
      expect(content).toContain("99,\"comma,value\"");
      expect(artifacts).toEqual(["exports/large.csv"]);
      expect(await tempFiles(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("escapes embedded quotes and newlines according to RFC 4180", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-export-csv-"));
    const workspace = new WorkspaceStore(root);
    const tool = exportTool(workspace, {
      stream: async function* (): AsyncGenerator<QueryExportBatch> {
        yield { columns: ["name", "note"], rows: [["Ada", "say \"hello\"\nthen leave"]] };
      },
      run: async () => { throw new Error("run should not be used"); },
    });
    try {
      await tool.execute("call-csv", { sql: "SELECT name, note", filename: "exports/escaped.csv" });
      expect(await readFile(join(root, "exports", "escaped.csv"), "utf8")).toBe(
        "name,note\n\"Ada\",\"say \"\"hello\"\"\nthen leave\"",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses native skill invocation for the model-visible load_skill tool", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-load-skill-"));
    const workspace = new WorkspaceStore(root);
    const calls: string[] = [];
    const tool = buildAgentTools({
      workspace,
      invokeSkill: async (name) => {
        calls.push(name);
        return { content: [{ type: "text", text: "native result" }] };
      },
    }).find((candidate) => candidate.name === "load_skill") as any;
    try {
      const result = await tool.execute("call-skill", { name: "analysis" });
      expect(calls).toEqual(["analysis"]);
      expect(result.content).toEqual([{ type: "text", text: "native result" }]);
      expect(result.details).toEqual({ nativeSkill: "analysis" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps legacy executors bounded instead of requesting a full result copy", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-export-legacy-"));
    const workspace = new WorkspaceStore(root);
    let requestedLimit: number | undefined;
    const tool = exportTool(workspace, {
      run: async (_sql: string, limit: number) => {
        requestedLimit = limit;
        return { columns: ["id"], rows: [[1]], truncated: true };
      },
    });
    try {
      await expect(tool.execute("call-legacy", { sql: "SELECT id", filename: "exports/legacy.csv" })).rejects.toThrow("EXPORT_STREAM_REQUIRED");
      expect(requestedLimit).toBe(50);
      expect(await tempFiles(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves existing output and cleans the temporary file on failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-export-failure-"));
    const workspace = new WorkspaceStore(root);
    await workspace.write("exports/result.csv", "previous\n");
    const stream = async function* (): AsyncGenerator<QueryExportBatch> {
      yield { columns: ["id"], rows: [[1]] };
      throw new Error("QUERY_FAILED");
    };
    const artifacts: string[] = [];
    const tool = exportTool(workspace, { stream: () => stream(), run: async () => { throw new Error("run should not be used"); } }, (path) => artifacts.push(path));
    try {
      await expect(tool.execute("call-2", { sql: "SELECT id", filename: "exports/result.csv" })).rejects.toThrow("QUERY_FAILED");
      expect(await readFile(join(root, "exports", "result.csv"), "utf8")).toBe("previous\n");
      expect(artifacts).toEqual([]);
      expect(await tempFiles(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("cleans the temporary file and emits no artifact when cancelled", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-export-cancel-"));
    const workspace = new WorkspaceStore(root);
    const controller = new AbortController();
    const stream = async function* (): AsyncGenerator<QueryExportBatch> {
      yield { columns: ["id"], rows: [[1]] };
      controller.abort();
      yield { columns: ["id"], rows: [[2]] };
    };
    const artifacts: string[] = [];
    const tool = exportTool(workspace, { stream: () => stream(), run: async () => { throw new Error("run should not be used"); } }, (path) => artifacts.push(path));
    try {
      await expect(tool.execute("call-3", { sql: "SELECT id", filename: "exports/cancelled.csv" }, controller.signal, undefined, undefined)).rejects.toThrow("EXPORT_CANCELLED");
      await expect(workspace.read("exports/cancelled.csv")).rejects.toThrow();
      expect(artifacts).toEqual([]);
      expect(await tempFiles(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
