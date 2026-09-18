import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { PiJsonlSessionStore } from "./session-store.js";

export interface MigrationReport { migrationId: string; migrated: number; skipped: number; warnings: string[]; backupPath: string }

export interface RollbackReport { rolledBack: boolean; migrationId?: string; restoredFrom?: string }

/**
 * Roll back a completed migration: remove the completion marker and restore the
 * target data directories from the migration backup snapshot. The backup itself
 * is preserved so the operation remains auditable.
 */
export async function rollbackMigration(targetRoot: string): Promise<RollbackReport> {
  const target = path.resolve(targetRoot);
  const marker = path.join(target, ".migration-complete.json");
  let migrationId: string | undefined;
  let backupPath: string | undefined;
  try {
    const report = JSON.parse(await readFile(marker, "utf8")) as MigrationReport;
    migrationId = report.migrationId;
    backupPath = report.backupPath;
  } catch {
    return { rolledBack: false };
  }
  if (!backupPath) return { rolledBack: false, migrationId };
  const backupStat = await stat(backupPath).catch(() => undefined);
  if (!backupStat?.isDirectory()) return { rolledBack: false, migrationId };
  // Restore: remove migrated artifacts derived from the source, then copy the backup back.
  for (const derived of ["sessions", "metadata"]) {
    await rm(path.join(target, derived), { recursive: true, force: true });
  }
  await cp(backupPath, target, { recursive: true, force: true });
  await rm(marker, { force: true });
  return { rolledBack: true, migrationId, restoredFrom: backupPath };
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || value.length === 0) return [];
  try { return JSON.parse(value); } catch { return []; }
}

async function findFiles(root: string, name: string, result: string[] = []): Promise<string[]> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) await findFiles(full, name, result);
    else if (entry.name === name) result.push(full);
  }
  return result;
}

export async function migrateLegacyData(sourceRoot: string, targetRoot: string, sessionStore?: PiJsonlSessionStore): Promise<MigrationReport> {
  const source = path.resolve(sourceRoot); const target = path.resolve(targetRoot); const marker = path.join(target, ".migration-complete.json");
  try { return JSON.parse(await readFile(marker, "utf8")) as MigrationReport; } catch { /* first migration */ }
  const migrationId = randomUUID(); const backupPath = path.join(target, "migration-backup", migrationId);
  await mkdir(backupPath, { recursive: true }); await cp(source, backupPath, { recursive: true, force: true });
  const report: MigrationReport = { migrationId, migrated: 0, skipped: 0, warnings: [], backupPath };
  const databases = await findFiles(source, "app.sqlite3");
  for (const databasePath of databases) {
    let db: InstanceType<typeof Database> | undefined;
    try {
      db = new Database(databasePath, { readonly: true });
      const tasks = db.prepare("SELECT * FROM tasks").all();
      const sessions = db.prepare("SELECT * FROM chat_sessions").all();
      db.close();
      const destination = path.join(target, "sessions", "legacy-metadata.json");
      await mkdir(path.dirname(destination), { recursive: true });
      const projections = sessions.map((session: any) => ({ id: session.id, taskId: session.task_id, name: session.name, uiTranscript: parseJson(session.ui_transcript_json), contextMessages: parseJson(session.context_messages_json), activeSkills: parseJson(session.active_skills_json), attachedFiles: parseJson(session.attached_files_json), conversationVersion: session.conversation_version }));
      await writeFile(destination, JSON.stringify({ source: databasePath, tasks, sessions, projections }, null, 2), "utf8");
      if (sessionStore) {
        for (const projection of projections) {
          const session = await sessionStore.create({ legacySessionId: projection.id, taskId: projection.taskId });
          for (const message of Array.isArray(projection.contextMessages) ? projection.contextMessages : []) {
            if (message?.role === "user" || message?.role === "assistant" || message?.role === "toolResult") await session.appendMessage(message);
            else report.warnings.push(`Skipped unsupported legacy message in ${projection.id}`);
          }
        }
      }
      report.migrated += tasks.length + sessions.length;
    } catch (error) { report.skipped += 1; report.warnings.push(`Failed to migrate ${databasePath}: ${error instanceof Error ? error.message : String(error)}`); }
    finally { try { db?.close(); } catch { /* already closed */ } }
  }
  const snapshots = await findFiles(source, ".session_snapshot.json");
  for (const snapshot of snapshots) {
    try {
      const data = JSON.parse(await readFile(snapshot, "utf8")) as Record<string, unknown>;
      const sessionId = typeof data.session_id === "string" ? data.session_id : path.basename(path.dirname(snapshot));
      const destination = path.join(target, "sessions", `${sessionId}.legacy.json`);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, JSON.stringify({ legacy: true, source: snapshot, data }, null, 2), "utf8");
      report.migrated += 1;
    } catch (error) { report.skipped += 1; report.warnings.push(`Failed to migrate ${snapshot}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  await mkdir(target, { recursive: true }); await writeFile(marker, JSON.stringify(report, null, 2), "utf8"); return report;
}
