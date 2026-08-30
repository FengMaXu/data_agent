import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExportCandidateStore, type ExportCandidateBatch } from "./export-candidate.js";
import { WorkspaceStore } from "./workspace.js";

async function temporaryFiles(root: string): Promise<string[]> {
  return (await readdir(root, { recursive: true }) as string[]).filter((entry) => entry.endsWith(".tmp"));
}

describe("ExportCandidateStore", () => {
  it("streams complete metadata into a private candidate and promotes the same file", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-candidate-"));
    const workspace = new WorkspaceStore(root);
    const store = new ExportCandidateStore(workspace);
    const batches: AsyncIterable<ExportCandidateBatch> = (async function* () {
      yield { columns: ["id", "value"], columnTypes: ["INTEGER", "TEXT"], rows: [[1, "a"], [2, null]] };
    })();

    try {
      const candidate = await store.create({ taskId: "task-1", queryArtifactId: "artifact-1", batches });
      expect(candidate.metadata).toMatchObject({
        columns: ["id", "value"],
        columnTypes: ["INTEGER", "TEXT"],
        rowCount: 2,
        truncated: false,
        nullCounts: { id: 0, value: 1 },
      });
      expect(candidate.path).toContain(".query-assurance/candidates/");
      expect(await workspace.list()).not.toContain(candidate.path);
      await expect(workspace.read(candidate.path)).rejects.toThrow("PRIVATE_WORKSPACE_PATH");
      expect(await readFile(join(root, candidate.path), "utf8")).toBe("id,value\n1,\"a\"\n2,");
      await store.publish(candidate, "exports/result.csv");
      expect(await readFile(join(root, "exports/result.csv"), "utf8")).toBe("id,value\n1,\"a\"\n2,");
      await expect(readFile(join(root, candidate.path), "utf8")).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("discards a failed candidate and keeps an existing target unchanged", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-candidate-failure-"));
    const workspace = new WorkspaceStore(root);
    const store = new ExportCandidateStore(workspace);
    await workspace.write("exports/result.csv", "previous\n");
    const batches: AsyncIterable<ExportCandidateBatch> = (async function* () {
      yield { columns: ["id"], rows: [[1]] };
      throw new Error("QUERY_FAILED");
    })();

    try {
      await expect(store.create({ taskId: "task-1", queryArtifactId: "artifact-1", batches })).rejects.toThrow("QUERY_FAILED");
      expect(await readFile(join(root, "exports/result.csv"), "utf8")).toBe("previous\n");
      expect(await temporaryFiles(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
