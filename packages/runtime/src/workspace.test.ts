import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceStore } from "./workspace.js";

describe("WorkspaceStore", () => {
  it("rejects paths outside the workspace root", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-workspace-"));
    const store = new WorkspaceStore(root);
    await expect(store.read("../outside.txt")).rejects.toThrow("WORKSPACE_PATH_ESCAPE");
    await rm(root, { recursive: true, force: true });
  });
});
