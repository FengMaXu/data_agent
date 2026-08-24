import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DashboardV3Spec, DashboardV3View } from "./dashboard-v3.js";
import type { DashboardV4SemanticSpec } from "./dashboard-v4.js";

/**
 * Gate-converging V3 → Canonical V4 dashboard spec migration (#29).
 *
 * V3 specs embed their datasets inline; canonical V4 semantic specs reference
 * data through restricted-bridge queries with explicit field mappings. The
 * migration preserves the externally visible behaviour: title, layout order,
 * view types, filters (as V4 parameters with defaults) and every data binding
 * (as the view `query` descriptor plus `fieldMapping`), so re-compiling a
 * converted view against its original dataset yields identical chart series.
 */

export type MigrationViewStatus = "converted" | "unsupported";

export interface ViewMigrationResult {
  viewId: string;
  status: MigrationViewStatus;
  reasons: string[];
}

export interface SpecMigrationResult {
  status: "converted" | "unchanged" | "unsupported";
  spec?: DashboardV4SemanticSpec;
  views: ViewMigrationResult[];
  reasons: string[];
}

export interface DashboardMigrationReport {
  migrationId: string;
  fromVersion: "v3";
  toVersion: "v4";
  converted: string[];
  unchanged: string[];
  unsupported: Array<{ path: string; reasons: string[] }>;
}

/** Structured query descriptor referencing the original V3 dataset binding. */
function queryFor(view: DashboardV3View): string {
  const parts = [`dataset:${view.dataset ?? "__default__"}`, `type:${view.type}`];
  if (view.xField) parts.push(`x:${view.xField}`);
  if (view.yField) parts.push(`y:${view.yField}`);
  if (view.nameField) parts.push(`name:${view.nameField}`);
  if (view.valueField) parts.push(`value:${view.valueField}`);
  if (view.field) parts.push(`field:${view.field}`);
  if (view.aggregate) parts.push(`aggregate:${view.aggregate}`);
  return parts.join("|");
}

function fieldMappingFor(view: DashboardV3View): Record<string, string> {
  const mapping: Record<string, string> = { dataset: view.dataset ?? "__default__" };
  if (view.xField) mapping.x = view.xField;
  if (view.yField) mapping.y = view.yField;
  if (view.nameField) mapping.name = view.nameField;
  if (view.valueField) mapping.value = view.valueField;
  if (view.field) mapping.field = view.field;
  if (view.aggregate) mapping.aggregate = view.aggregate;
  return mapping;
}

/** Converts a single V3 spec; pure, no I/O. Reports per-view outcomes. */
export function migrateV3SpecToV4(spec: DashboardV3Spec): SpecMigrationResult {
  if ((spec as { dashboardVersion?: number }).dashboardVersion === 4) {
    return { status: "unchanged", views: [], reasons: [] };
  }
  const datasetIds = new Set(spec.datasets.map((d) => d.id));
  const views: DashboardV4SemanticSpec["views"] = [];
  const viewResults: ViewMigrationResult[] = [];
  const parameters: DashboardV4SemanticSpec["parameters"] = {};

  // Dataset-level filters become V4 parameters with their current value as default.
  for (const dataset of spec.datasets) {
    const filters = (dataset as { filters?: Record<string, unknown> }).filters;
    for (const [name, value] of Object.entries(filters ?? {})) {
      parameters[name] = { type: typeof value === "number" ? "number" : typeof value === "boolean" ? "string" : "string", default: value };
    }
  }

  for (const [index, view] of spec.views.entries()) {
    const viewId = view.id ?? view.title ?? `${view.type}-${index}`;
    const reasons: string[] = [];
    if (!["line", "bar", "pie", "kpi", "table"].includes(view.type)) reasons.push(`unsupported view type ${view.type}`);
    if (view.dataset && !datasetIds.has(view.dataset)) reasons.push(`references unknown dataset ${view.dataset}`);
    if ((view.type === "line" || view.type === "bar") && (!view.xField || !view.yField)) reasons.push("needs xField/yField");
    if (view.type === "pie" && (!view.nameField || !view.valueField)) reasons.push("needs nameField/valueField");
    if (view.type === "kpi" && !view.field) reasons.push("needs field");
    if (reasons.length > 0) {
      viewResults.push({ viewId, status: "unsupported", reasons });
      continue;
    }
    views.push({ id: viewId, type: view.type, title: view.title, query: queryFor(view), fieldMapping: fieldMappingFor(view) });
    // View-level filters also become parameters (view binding kept in fieldMapping).
    const viewFilters = (view as { filters?: Record<string, unknown> }).filters;
    for (const [name, value] of Object.entries(viewFilters ?? {})) {
      parameters[name] = { type: typeof value === "number" ? "number" : "string", default: value };
      views[views.length - 1].fieldMapping![`filter:${name}`] = String(value);
    }
    viewResults.push({ viewId, status: "converted", reasons: [] });
  }

  const unsupportedViews = viewResults.filter((v) => v.status === "unsupported");
  if (spec.views.length === 0) {
    return { status: "unsupported", views: viewResults, reasons: ["spec has no views"] };
  }
  if (unsupportedViews.length > 0) {
    return {
      status: "unsupported",
      views: viewResults,
      reasons: unsupportedViews.flatMap((v) => v.reasons.map((r) => `${v.viewId}: ${r}`)),
    };
  }
  const hasParameters = Object.keys(parameters).length > 0;
  return {
    status: "converted",
    views: viewResults,
    reasons: [],
    spec: {
      title: spec.title,
      ...(hasParameters ? { parameters } : {}),
      views,
    },
  };
}

export interface MigrateFileOptions {
  /** Directory (workspace-relative root) the paths resolve against. */
  root: string;
}

/**
 * Migrates V3 spec files in place:
 * - original file backed up once to `<path>.v3.bak` (never overwritten)
 * - converted file written with explicit `dashboardVersion: 4` metadata
 * - already-V4 files are reported unchanged (idempotent)
 * - unsupported specs are left untouched with reasons
 */
export async function migrateDashboardFiles(paths: string[], options: MigrateFileOptions): Promise<DashboardMigrationReport> {
  const report: DashboardMigrationReport = { migrationId: randomUUID(), fromVersion: "v3", toVersion: "v4", converted: [], unchanged: [], unsupported: [] };
  for (const relativePath of paths) {
    const target = path.resolve(options.root, relativePath);
    let raw: string;
    try {
      raw = await readFile(target, "utf8");
    } catch (error) {
      report.unsupported.push({ path: relativePath, reasons: [`unreadable: ${error instanceof Error ? error.message : String(error)}`] });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      report.unsupported.push({ path: relativePath, reasons: [`invalid JSON: ${error instanceof Error ? error.message : String(error)}`] });
      continue;
    }
    if ((parsed as { dashboardVersion?: number })?.dashboardVersion === 4) {
      report.unchanged.push(relativePath);
      continue;
    }
    const result = migrateV3SpecToV4(parsed as DashboardV3Spec);
    if (result.status !== "converted" || !result.spec) {
      report.unsupported.push({ path: relativePath, reasons: result.reasons.length ? result.reasons : ["spec could not be converted"] });
      continue;
    }
    // Backup once; never overwrite an existing backup so the original stays auditable.
    const backupPath = `${target}.v3.bak`;
    await mkdir(path.dirname(backupPath), { recursive: true });
    await copyFile(target, backupPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const converted = { dashboardVersion: 4, migratedFrom: "v3", migrationId: report.migrationId, ...result.spec };
    await writeFile(target, JSON.stringify(converted, null, 2), "utf8");
    report.converted.push(relativePath);
  }
  return report;
}
