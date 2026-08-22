import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateLegacyData } from "./legacy-migration.js";

describe("legacy migration", () => {
  it("creates a backup and is idempotent", async () => {
    const source = await mkdtemp(join(tmpdir(), "data-agent-legacy-"));
    const target = await mkdtemp(join(tmpdir(), "data-agent-target-"));
    await writeFile(join(source, "legacy.json"), "{}", "utf8");
    const first = await migrateLegacyData(source, target);
    const second = await migrateLegacyData(source, target);
    expect(first.migrationId).toBe(second.migrationId);
    expect(first.backupPath).toBeTruthy();
    await rm(source, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  });
});
