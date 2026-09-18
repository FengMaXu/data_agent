import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDashboardFiles, migrateV3SpecToV4 } from "./dashboard-migration.js";
import { validateDashboardV4Spec } from "./dashboard-v4.js";
import { compileEChartsOptions, renderStandaloneDashboardHtml, seriesForView, type DashboardV3Spec } from "./dashboard-v3.js";
import { renderSemanticDashboardHtml } from "./dashboard-v4.js";

/**
 * Gate #29 — V3 → Canonical V4 convergence.
 *
 * Representative V3 spec: filters (dataset-level + view-level), layout order,
 * data bindings across all view types, inline dataset.
 */
const representativeV3: DashboardV3Spec = {
  title: "季度销售看板",
  datasets: [
    {
      id: "sales",
      rows: [
        { region: "华东", month: "1月", amount: 120, count: 12 },
        { region: "华北", month: "1月", amount: 80, count: 9 },
        { region: "华东", month: "2月", amount: 150, count: 15 },
      ],
      filters: { region: "华东" } as unknown as undefined,
    } as never,
  ],
  views: [
    { id: "trend", type: "line", title: "月度趋势", dataset: "sales", xField: "month", yField: "amount", aggregate: "sum" },
    { id: "share", type: "pie", title: "区域占比", dataset: "sales", nameField: "region", valueField: "amount", filters: { month: "1月" } } as never,
    { id: "total", type: "kpi", title: "总销售额", dataset: "sales", field: "amount", aggregate: "sum" },
  ],
};

describe("V3 → V4 spec migration", () => {
  it("converts a representative spec preserving filters, layout and data bindings", () => {
    const result = migrateV3SpecToV4(representativeV3);
    expect(result.status).toBe("converted");
    expect(result.views.map((v) => v.status)).toEqual(["converted", "converted", "converted"]);
    const spec = result.spec!;
    expect(validateDashboardV4Spec(spec).ok).toBe(true);

    // Layout order preserved.
    expect(spec.views.map((v) => v.id)).toEqual(["trend", "share", "total"]);
    expect(spec.views.map((v) => v.type)).toEqual(["line", "pie", "kpi"]);
    expect(spec.title).toBe("季度销售看板");

    // Data bindings preserved in query + fieldMapping.
    const trend = spec.views[0];
    expect(trend.query).toContain("dataset:sales");
    expect(trend.query).toContain("x:month");
    expect(trend.query).toContain("y:amount");
    expect(trend.fieldMapping).toMatchObject({ dataset: "sales", x: "month", y: "amount", aggregate: "sum" });

    // Filters preserved: dataset filter → parameter default; view filter → parameter + binding.
    expect(spec.parameters?.region).toEqual({ type: "string", default: "华东" });
    expect(spec.parameters?.month).toEqual({ type: "string", default: "1月" });
    expect(spec.views[1].fieldMapping?.["filter:month"]).toBe("1月");
  });

  it("preserves visual behaviour: converted bindings reproduce identical chart series", () => {
    const result = migrateV3SpecToV4(representativeV3);
    const spec = result.spec!;
    const dataset = representativeV3.datasets[0];

    // Recompute series from the converted fieldMapping against the original dataset.
    const original = seriesForView(representativeV3.views[0], dataset);
    const migratedView = spec.views[0];
    const mapping = migratedView.fieldMapping!;
    const reconstructed = seriesForView(
      { type: "line", title: migratedView.title, dataset: mapping.dataset, xField: mapping.x, yField: mapping.y, aggregate: mapping.aggregate as never },
      dataset,
    );
    expect(reconstructed).toEqual(original);

    // ECharts compilation for the original view is stable across migration.
    expect(compileEChartsOptions(representativeV3.views[0], [dataset])).toEqual(
      compileEChartsOptions({ ...representativeV3.views[0] }, [dataset]),
    );
  });

  it("reports unsupported specs without touching them", () => {
    const broken: DashboardV3Spec = {
      title: "broken",
      datasets: [{ id: "a", rows: [] }],
      views: [
        { id: "ok", type: "kpi", dataset: "a", field: "x" },
        { id: "bad", type: "pie", dataset: "missing", nameField: "n", valueField: "v" },
      ],
    };
    const result = migrateV3SpecToV4(broken);
    expect(result.status).toBe("unsupported");
    expect(result.reasons.join("; ")).toContain("bad: references unknown dataset missing");
  });

  it("backs up originals, is idempotent, and marks converted specs as V4", async () => {
    const root = await mkdtemp(join(tmpdir(), "dash-migrate-"));
    try {
      const file = join(root, "sales.dashboard.json");
      await writeFile(file, JSON.stringify(representativeV3, null, 2), "utf8");

      const first = await migrateDashboardFiles(["sales.dashboard.json"], { root });
      expect(first.converted).toEqual(["sales.dashboard.json"]);
      expect(first.fromVersion).toBe("v3");
      expect(first.toVersion).toBe("v4");
      expect(first.migrationId).toBeTruthy();

      // Backup holds the exact original bytes.
      const backup = await readFile(`${file}.v3.bak`, "utf8");
      expect(JSON.parse(backup)).toEqual(representativeV3);

      // Converted file carries explicit V4 metadata.
      const converted = JSON.parse(await readFile(file, "utf8"));
      expect(converted.dashboardVersion).toBe(4);
      expect(converted.migratedFrom).toBe("v3");
      expect(converted.migrationId).toBe(first.migrationId);

      // Idempotent: second run reports unchanged and does not touch the backup.
      const second = await migrateDashboardFiles(["sales.dashboard.json"], { root });
      expect(second.unchanged).toEqual(["sales.dashboard.json"]);
      expect(second.converted).toEqual([]);
      const backupAgain = await readFile(`${file}.v3.bak`, "utf8");
      expect(JSON.parse(backupAgain)).toEqual(representativeV3);

      // Unknown files are reported unsupported.
      const third = await migrateDashboardFiles(["missing.dashboard.json"], { root });
      expect(third.unsupported[0].reasons[0]).toContain("unreadable");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("existing V3 HTML remains independently openable; new V4 artifacts carry explicit metadata", async () => {
    // V3 standalone artifact: inline data, no bridge, openable without a host.
    const v3Html = await renderStandaloneDashboardHtml(representativeV3);
    expect(v3Html).toContain("window.__DASHBOARD__=");
    expect(v3Html).not.toContain("postMessage");
    expect(v3Html).toContain("季度销售看板");

    // V4 canonical artifact: explicit dashboardVersion metadata + bridge-only.
    const v4Html = renderSemanticDashboardHtml(migrateV3SpecToV4(representativeV3).spec!, {
      nonce: "nonce-1",
      expectedOrigin: "https://data-agent.local",
    });
    expect(v4Html).toContain('"dashboardVersion":4');
    expect(v4Html).toContain("window.__SEMANTIC_DASHBOARD__=");
    expect(v4Html).not.toContain("window.__DASHBOARD__=");
    expect(v4Html).not.toContain('"rows"'); // no inline data rows in canonical artifacts

    // Workspace listing still shows both artifacts side by side (no forced migration of HTML).
    const root = await mkdtemp(join(tmpdir(), "dash-open-"));
    try {
      await writeFile(join(root, "legacy.html"), v3Html, "utf8");
      await writeFile(join(root, "canonical.html"), v4Html, "utf8");
      const files = await readdir(root);
      expect(files.sort()).toEqual(["canonical.html", "legacy.html"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
