import { describe, expect, it } from "vitest";
import { JsonlSessionRepo, TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { JsonlChildSessionRepository } from "./child-session-repo.js";

describe("private child Session repository", () => {
  it("removes orphan Sessions while retaining ledger-associated Sessions", async () => {
    const root = await mkdtemp(path.join(process.cwd(), ".tmp-child-session-repo-"));
    try {
      const children = new JsonlChildSessionRepository(root);
      const known = await children.create({ id: "known", parentSessionId: "parent" });
      const orphan = await children.create({ id: "orphan", parentSessionId: "parent" });
      await known.close(TODO_CONTEXT);
      await orphan.close(TODO_CONTEXT);
      await children.removeOrphans(new Set(["known"]));
      const repo = new JsonlSessionRepo({ fileSystem: new NodeExecutionEnv({ cwd: root }), sessionsRoot: root });
      expect((await repo.list({ cwd: root }, TODO_CONTEXT)).map((item) => item.id)).toEqual(["known"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
