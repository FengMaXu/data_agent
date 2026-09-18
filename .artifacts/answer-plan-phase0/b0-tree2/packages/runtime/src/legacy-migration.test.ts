import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateLegacyData, rollbackMigration } from "./legacy-migration.js";
import { PiJsonlSessionStore } from "./session-store.js";
import Database from "better-sqlite3";

/**
 * Gate B — migration against representative existing data.
 *
 * The fixture mirrors a real legacy install: SQLite metadata with tasks and
 * chat sessions (UI transcript, context messages, active skills, attached
 * files, conversation version), Pi session snapshots, and an interrupted
 * migration artifact (a corrupt database).
 */
async function createRepresentativeLegacyRoot(root: string): Promise<void> {
  const profileDir = join(root, "AppData", "Roaming", "data_agent");
  await mkdir(profileDir, { recursive: true });
  await writeFile(join(profileDir, "app.sqlite3"), Buffer.alloc(0));
  const db = new Database(join(profileDir, "app.sqlite3"));
  db.exec("CREATE TABLE tasks (id TEXT, name TEXT); CREATE TABLE chat_sessions (id TEXT, task_id TEXT, name TEXT, ui_transcript_json TEXT, context_messages_json TEXT, active_skills_json TEXT, attached_files_json TEXT, conversation_version INTEGER)");
  db.prepare("INSERT INTO tasks VALUES (?, ?)").run("task-1", "季度销售分析");
  db.prepare("INSERT INTO chat_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    "session-1", "task-1", "Session A",
    JSON.stringify([{ role: "user", content: "hi" }]),
    JSON.stringify([
      { role: "user", text: "查询销售额" },
      { role: "assistant", text: "正在查询…" },
      { role: "toolResult", toolCallId: "c1", content: "rows" },
      { role: "unknown-future-role", text: "should be skipped with warning" },
    ]),
    JSON.stringify(["sql-guard"]),
    JSON.stringify(["uploads/data.csv"]),
    3,
  );
  db.close();

  const snapshotDir = join(profileDir, "sessions", "session-2");
  await mkdir(snapshotDir, { recursive: true });
  await writeFile(join(snapshotDir, ".session_snapshot.json"), JSON.stringify({ session_id: "session-2", messages: [] }), "utf8");

  // Interrupted migration artifact: a truncated database that must be skipped with a warning.
  await mkdir(join(root, "broken"), { recursive: true });
  await writeFile(join(root, "broken", "app.sqlite3"), Buffer.from("not a database"));
}

describe("legacy migration gate (representative data)", () => {
  it("migrates tasks, sessions, projections and snapshots; warns on corrupt sources", async () => {
    const source = await mkdtemp(join(tmpdir(), "data-agent-legacy-"));
    const target = await mkdtemp(join(tmpdir(), "data-agent-target-"));
    try {
      await createRepresentativeLegacyRoot(source);
      const sessions = new PiJsonlSessionStore(join(target, "sessions"));
      const report = await migrateLegacyData(source, target, sessions);
      expect(report.migrated).toBe(3); // db projection (task+session counted via tasks+sessions) + 1 snapshot
      expect(report.warnings.some((w) => w.includes("not a database") || w.includes("Failed to migrate"))).toBe(true);

      // Pi JSONL sessions were created for legacy sessions with supported messages only.
      const all = await sessions.list();
      const migrated = all.find((s) => (s as { metadata?: { legacySessionId?: string } }).metadata?.legacySessionId === "session-1");
      expect(migrated).toBeTruthy();
    } finally {
      await rm(source, { recursive: true, force: true });
      await rm(target, { recursive: true, force: true });
    }
  });

  it("never re-executes legacy side effects (no tool replay)", async () => {
    const source = await mkdtemp(join(tmpdir(), "data-agent-legacy-"));
    const target = await mkdtemp(join(tmpdir(), "data-agent-target-"));
    try {
      await createRepresentativeLegacyRoot(source);
      const sessions = new PiJsonlSessionStore(join(target, "sessions"));
      const report = await migrateLegacyData(source, target, sessions);
      // Historical toolResult messages are preserved verbatim as transcript entries.
      const all = await sessions.list();
      const migratedMeta = all.find((s) => (s as { metadata?: { legacySessionId?: string } }).metadata?.legacySessionId === "session-1")!;
      const migrated = await sessions.open(migratedMeta);
      const context = await migrated.buildContext();
      const toolResults = context.messages.filter((m: { role?: string }) => m.role === "toolResult");
      expect(toolResults.length).toBe(1); // preserved without re-execution
      // The unsupported legacy role was skipped with a warning, not migrated.
      expect(report.warnings.some((w) => w.includes("unsupported legacy message"))).toBe(true);
      expect(report.migrated).toBeGreaterThan(0);
    } finally {
      await rm(source, { recursive: true, force: true });
      await rm(target, { recursive: true, force: true });
    }
  });

  it("backs up before migrating and rollback restores the pre-migration state", async () => {
    const source = await mkdtemp(join(tmpdir(), "data-agent-legacy-"));
    const target = await mkdtemp(join(tmpdir(), "data-agent-target-"));
    try {
      await createRepresentativeLegacyRoot(source);
      const report = await migrateLegacyData(source, target);
      expect(report.backupPath).toBeTruthy();

      // Backup contains the untouched source tree, and its databases remain readable
      // (a prior-release backup must open for rollback/audit).
      const backupFiles = (await readdir(report.backupPath, { recursive: true })).map(String);
      const backupDbs = backupFiles.filter((f) => f.endsWith("app.sqlite3") && !f.includes("broken"));
      expect(backupDbs.length).toBeGreaterThanOrEqual(1);
      let tasks: Array<{ id: string }> = [];
      const readable = new Database(join(report.backupPath, backupDbs[0]), { readonly: true });
      try {
        tasks = readable.prepare("SELECT * FROM tasks").all() as Array<{ id: string }>;
      } finally {
        readable.close();
      }
      expect(tasks.some((t) => t.id === "task-1")).toBe(true);

      const rollback = await rollbackMigration(target);
      expect(rollback.rolledBack).toBe(true);
      expect(rollback.migrationId).toBe(report.migrationId);
      // Marker removed: a fresh migration can run again after rollback.
      await expect(access(join(target, ".migration-complete.json"))).rejects.toThrow();
      const second = await migrateLegacyData(source, target);
      expect(second.migrationId).not.toBe(report.migrationId);

      // Rollback is safe to call repeatedly and reports no-op when nothing to undo.
      const repeat = await rollbackMigration(target);
      expect(repeat.rolledBack).toBe(true);
      const markerGone = await readFile(join(target, ".migration-complete.json"), "utf8").then(() => true).catch(() => false);
      expect(markerGone).toBe(false);
    } finally {
      await rm(source, { recursive: true, force: true });
      await rm(target, { recursive: true, force: true });
    }
  });

  it("rollback without a migration is a no-op", async () => {
    const target = await mkdtemp(join(tmpdir(), "data-agent-target-"));
    try {
      const rollback = await rollbackMigration(target);
      expect(rollback.rolledBack).toBe(false);
    } finally {
      await rm(target, { recursive: true, force: true });
    }
  });
});
