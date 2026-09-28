import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { MetadataStore } from "./metadata.js";

describe("Metadata SessionDirectory authorization", () => {
  it("persists ownership across restart and fails closed for unknown principals", async () => {
    const root = await mkdtemp(join(process.cwd(), ".tmp-metadata-auth-"));
    const dbPath = join(root, "metadata.db");
    let metadata = new MetadataStore(dbPath);
    try {
      await metadata.call("session.create", "user-a", { idValue: "session-a", taskId: "task-a", name: "A" });
      expect(await metadata.authorizeSession("user-a", "session-a")).toBe("owned");
      expect(await metadata.authorizeSession("user-b", "session-a")).toBe("forbidden");
      await metadata.close();

      metadata = new MetadataStore(dbPath);
      expect(await metadata.authorizeSession("user-a", "session-a")).toBe("owned");
      expect(await metadata.authorizeSession("user-b", "session-a")).toBe("forbidden");
      expect(await metadata.authorizeSession("user-a", "missing")).toBe("missing");
    } finally {
      await metadata.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("enforces globally unique Session ids because Pi storage is keyed by id", async () => {
    const root = await mkdtemp(join(process.cwd(), ".tmp-metadata-ambiguous-"));
    const metadata = new MetadataStore(join(root, "metadata.db"));
    try {
      await metadata.call("session.create", "user-a", { idValue: "shared", taskId: "task-a", name: "A" });
      await expect(metadata.call("session.create", "user-b", { idValue: "shared", taskId: "task-b", name: "B" })).rejects.toThrow();
      expect(await metadata.authorizeSession("user-a", "shared")).toBe("owned");
      expect(await metadata.authorizeSession("user-b", "shared")).toBe("forbidden");
    } finally {
      await metadata.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
