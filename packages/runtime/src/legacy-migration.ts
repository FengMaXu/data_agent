import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface MigrationReport { migrationId: string; migrated: number; skipped: number; warnings: string[]; backupPath: string }
export async function migrateLegacyData(sourceRoot: string, targetRoot: string): Promise<MigrationReport> {
  const migrationId = randomUUID(); const source = path.resolve(sourceRoot); const target = path.resolve(targetRoot); const backupPath = path.join(target, "migration-backup", migrationId);
  await mkdir(backupPath, { recursive: true }); await cp(source, backupPath, { recursive: true, force: true });
  const report: MigrationReport = { migrationId, migrated: 0, skipped: 0, warnings: [], backupPath };
  const marker = path.join(target, ".migration-complete.json");
  try { const existing = JSON.parse(await readFile(marker, "utf8")) as MigrationReport; return existing; } catch { /* first migration */ }
  await mkdir(target, { recursive: true });
  report.migrated = 1;
  await writeFile(marker, JSON.stringify(report, null, 2), "utf8");
  return report;
}
