import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateLegacyData } from "./legacy-migration.js";
import Database from "better-sqlite3";

describe("legacy migration", () => {
  it("creates a backup and is idempotent", async () => {
    const source = await mkdtemp(join(tmpdir(), "data-agent-legacy-"));
    const target = await mkdtemp(join(tmpdir(), "data-agent-target-"));
    await writeFile(join(source, "legacy.json"), "{}", "utf8");
    const db = new Database(join(source, "app.sqlite3"));
    db.exec("CREATE TABLE tasks (id TEXT, name TEXT); CREATE TABLE chat_sessions (id TEXT, task_id TEXT, name TEXT, ui_transcript_json TEXT, context_messages_json TEXT, active_skills_json TEXT, attached_files_json TEXT, conversation_version INTEGER)");
    db.prepare("INSERT INTO tasks VALUES (?, ?)").run("task-1", "Task");
    db.prepare("INSERT INTO chat_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("session-1", "task-1", "Session", "[]", "[]", "[]", "[]", 1);
    db.close();
    const first = await migrateLegacyData(source, target);
    const second = await migrateLegacyData(source, target);
    expect(first.migrationId).toBe(second.migrationId);
    expect(first.migrated).toBe(2);
    expect(first.backupPath).toBeTruthy();
    await rm(source, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  });
});
