import { checkDeclaredSemantics, datasetKey, validateDashboard, type ChartDataset, type DashboardViewNotice, type SemanticsCheck } from "@data-agent/charts";
import { checkDashboardSpec, dashboardViewData, type DashboardView } from "@data-agent/contracts";
import type { Answering, BusinessContext } from "../answering/public.js";
import type { DashboardDataSource } from "../dashboard.js";
import type { ArtifactDirectory } from "./artifact-directory.js";
import { ChartDataResolver, describeSource } from "./chart-data.js";
import type { WorkspaceStore } from "../workspace.js";

export interface DashboardRefreshRequest {
  /** The dashboard file, e.g. "dashboards/sales.html". */
  readonly path: string;
  readonly viewIds: readonly string[];
  readonly requestId: string;
}

export interface DashboardRefreshResult {
  /** New JSON-safe rows, under the same keys the page already uses. */
  readonly datasets: Readonly<Record<string, ChartDataset>>;
  readonly sources: Readonly<Record<string, DashboardDataSource>>;
  readonly checks: Readonly<Record<string, readonly SemanticsCheck[]>>;
  readonly notices: readonly DashboardViewNotice[];
}

export interface DashboardRefresherOptions {
  readonly workspace: Pick<WorkspaceStore, "readBytes">;
  readonly answering: Pick<Answering, "refresh">;
  readonly artifacts: Pick<ArtifactDirectory, "resolveRows" | "resolveReceipt">;
}

const DASHBOARD_PATH = /^dashboards\/[^/\\]+\.html$/;
// The payload is script JSON with "<" escaped, so its closing tag cannot occur inside it.
const PAYLOAD = /window\.__DATA_AGENT_DASHBOARD__=(\{[\s\S]*?\});<\/script>/;

function jsonSafe(rows: readonly (readonly unknown[])[]): unknown[][] {
  return rows.map((row) => row.map((cell) => (typeof cell === "bigint" ? cell.toString() : cell instanceof Date ? cell.toISOString() : cell === undefined ? null : cell)));
}

/**
 * Refreshes the live views of a dashboard the app has open (ADR-0010). The page
 * names views and nothing else: the spec and its Receipts come from the file in
 * the workspace, every refresh goes through Answering.refresh and the Receipt
 * directory, and the new rows are validated before they are returned. The file
 * is not rewritten.
 */
export class DashboardRefresher {
  constructor(private readonly options: DashboardRefresherOptions) {}

  async refresh(request: DashboardRefreshRequest, context: BusinessContext): Promise<DashboardRefreshResult> {
    if (!DASHBOARD_PATH.test(request.path)) throw new Error("DASHBOARD_PATH_INVALID");
    if (request.viewIds.length === 0) throw new Error("DASHBOARD_REFRESH_NO_VIEWS");
    // The whole file: a bounded text read would stop before the payload at its end.
    const match = PAYLOAD.exec(new TextDecoder().decode(await this.options.workspace.readBytes(request.path)));
    let payload: unknown;
    try {
      payload = match ? JSON.parse(match[1]!) : undefined;
    } catch {
      payload = undefined;
    }
    const checked = checkDashboardSpec((payload as { spec?: unknown } | undefined)?.spec);
    if (!checked.ok) throw new Error("DASHBOARD_FILE_INVALID: the file is not a dashboard this app generated");
    const spec = checked.spec;

    const receipts = new Set<string>();
    for (const viewId of request.viewIds) {
      const view = spec.views.find((item) => item.id === viewId);
      if (!view) throw new Error(`DASHBOARD_VIEW_NOT_FOUND: ${viewId}`);
      const ref = dashboardViewData(view);
      if (ref.kind !== "live") throw new Error(`DASHBOARD_VIEW_NOT_LIVE: ${viewId}`);
      receipts.add(ref.receiptId);
    }

    const resolver = new ChartDataResolver({ publications: this.options.artifacts });
    const datasets: Record<string, ChartDataset> = {};
    const sources: Record<string, DashboardDataSource> = {};
    const profiles: Record<string, Parameters<typeof checkDeclaredSemantics>[1]> = {};
    for (const receiptId of receipts) {
      const refreshed = await this.options.answering.refresh({ receiptId, requestId: `${request.requestId}:${receiptId}` }, context);
      const data = await resolver.resolve({ kind: "live", receiptId: refreshed.receiptId }, context);
      // The page keeps the key of the Receipt its spec names; only the rows behind it change.
      const key = datasetKey({ kind: "live", receiptId });
      datasets[key] = { columns: [...data.columns], rows: jsonSafe(data.rows) };
      profiles[key] = data.physicalProfile?.columns;
      sources[key] = { kind: "publication", id: refreshed.receiptId, label: describeSource(data.source), contentHash: data.source.contentHash, disclosures: [...data.disclosures], live: true, publishedAt: refreshed.createdAt };
    }

    // Every view over a refreshed dataset changes, not only those named.
    const affected: DashboardView[] = spec.views.filter((view) => datasetKey(dashboardViewData(view)) in datasets);
    const validated = validateDashboard({ ...spec, views: affected }, datasets);
    if (!validated.ok) {
      throw new Error(`DASHBOARD_REFRESH_INVALID: ${validated.errors.map((error) => `[${error.code}] ${error.message}`).join("; ")}`);
    }
    const checks: Record<string, readonly SemanticsCheck[]> = {};
    for (const view of affected) {
      checks[view.id] = checkDeclaredSemantics(view.type === "chart" ? view.chart.fields : view.fields, profiles[datasetKey(dashboardViewData(view))]);
    }
    return { datasets, sources, checks, notices: validated.notices };
  }
}
