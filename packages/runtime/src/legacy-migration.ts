import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

export interface MigrationReport { migrationId: string; migrated: number; skipped: number; warnings: string[]; backupPath: string }

async function findFiles(root: string, name: string, result: string[] = []): Promise<string[]> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) await findFiles(full, name, result);
    else if (entry.name === name) result.push(full);
  }
  return result;
}

export async function migrateLegacyData(sourceRoot: string, targetRoot: string): Promise<MigrationReport> {
  const source = path.resolve(sourceRoot); const target = path.resolve(targetRoot); const marker = path.join(target, ".migration-complete.json");
  try { return JSON.parse(await readFile(marker, "utf8")) as MigrationReport; } catch { /* first migration */ }
  const migrationId = randomUUID(); const backupPath = path.join(target, "migration-backup", migrationId);
  await mkdir(backupPath, { recursive: true }); await cp(source, backupPath, { recursive: true, force: true });
  const report: MigrationReport = { migrationId, migrated: 0, skipped: 0, warnings: [], backupPath };
  const databases = await findFiles(source, "app.sqlite3");
  for (const databasePath of databases) {
    try {
      const db = new Database(databasePath, { readonly: true });
      const tasks = db.prepare("SELECT * FROM tasks").all();
      const sessions = db.prepare("SELECT * FROM chat_sessions").all();
      db.close();
      const destination = path.join(target, "sessions", "legacy-metadata.json");
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, JSON.stringify({ source: databasePath, tasks, sessions }, null, 2), "utf8");
      report.migrated += tasks.length + sessions.length;
    } catch (error) { report.skipped += 1; report.warnings.push(`Failed to migrate ${databasePath}: ${error instanceof Error ? error.message : String(error)}`); }
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
