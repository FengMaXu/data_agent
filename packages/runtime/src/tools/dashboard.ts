import { createHash } from "node:crypto";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type { AgentHarnessTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { CHART_RENDERER_VERSIONS, datasetKey, validateDashboard, type ChartDataset, type DashboardError, type SemanticsCheck } from "@data-agent/charts";
import { CHARTS_BROWSER_SOURCE } from "@data-agent/charts/browser-source";
import { checkDashboardSpec, dashboardViewData, type DashboardSpec, type DatasetRef } from "@data-agent/contracts";
import { renderDashboardHtml, type DashboardDataSource } from "../dashboard.js";
import { readEchartsSource, resolveEchartsAssetPath } from "../echarts-asset.js";
import type { ArtifactDirectory } from "../facets/artifact-directory.js";
import type { PublicationReceipt } from "../answering/public.js";
import type { WorkspaceStore } from "../workspace.js";
import { trustedContext, type DataAgentToolContext } from "./answering.js";
import { MAX_WIDGET_ROWS, jsonSafeRows, semanticChecks } from "./charts.js";
import { defineDataAgentTool, type DataAgentToolDefinition } from "./tool-definition.js";

export const GENERATE_DASHBOARD_PARAMETERS = Type.Object({
  operation: Type.Union([Type.Literal("validate"), Type.Literal("create"), Type.Literal("edit")]),
  /** A DashboardSpec v1; validated against the published results it references. */
  spec: Type.Unknown(),
  /** The dashboard to overwrite on edit, e.g. "dashboards/sales.html". */
  editPath: Type.Optional(Type.String({ pattern: "^dashboards/.+\\.html$" })),
}, { additionalProperties: false });
type GenerateDashboardInput = Static<typeof GENERATE_DASHBOARD_PARAMETERS>;

export interface DashboardToolOptions {
  readonly workspace: WorkspaceStore;
  readonly artifacts: Pick<ArtifactDirectory, "resolveRows">;
  /** ECharts source to inline; defaults to the installed echarts build. */
  readonly echartsSource?: () => Promise<string | undefined>;
}

/** Each view's rows travel inside the HTML, so a dataset holds as many rows as a chat chart. */
export const MAX_DASHBOARD_DATASET_ROWS = MAX_WIDGET_ROWS;

function formatDashboardErrors(errors: readonly Pick<DashboardError, "code" | "message" | "path" | "hint">[]): string {
  const lines = errors.map((error) => `[${error.code}] ${error.message}${error.path ? ` (${error.path})` : ""}${error.hint ? `；建议：${error.hint}` : ""}`);
  return `DASHBOARD_SPEC_INVALID\n${lines.join("\n")}`;
}

async function defaultEchartsSource(): Promise<string | undefined> {
  const assetPath = resolveEchartsAssetPath();
  return assetPath ? readEchartsSource(assetPath) : undefined;
}

function declaredFields(spec: DashboardSpec): string[] {
  const names = spec.views.flatMap((view) => Object.keys((view.type === "chart" ? view.chart.fields : view.fields) ?? {}));
  return [...new Set(names)];
}

function generateDashboardTool(options: DashboardToolOptions): AgentHarnessTool<DataAgentToolContext> {
  return {
    name: "generate_dashboard",
    label: "generate_dashboard",
    description: "Validate or build a standalone snapshot dashboard from published query results.",
    replay: "never",
    parameters: GENERATE_DASHBOARD_PARAMETERS,
    async execute(_toolCallId, input, _onUpdate, toolContext, invocation, context): Promise<AgentToolResult<unknown>> {
      if (!Value.Check(GENERATE_DASHBOARD_PARAMETERS, input)) throw new Error("GENERATE_DASHBOARD_INPUT_INVALID: operation is validate, create or edit; editPath is dashboards/<name>.html");
      const value = input as GenerateDashboardInput;
      if (value.operation === "edit" && !value.editPath) throw new Error("GENERATE_DASHBOARD_INPUT_INVALID: edit requires editPath");
      const checked = checkDashboardSpec(value.spec);
      if (!checked.ok) throw new Error(formatDashboardErrors(checked.errors.map((error) => ({ ...error, code: "SCHEMA_INVALID" }))));
      const spec = checked.spec;

      const business = trustedContext(toolContext, invocation, context);
      const datasets: Record<string, ChartDataset> = {};
      const sources: Record<string, DashboardDataSource> = {};
      const receipts: Record<string, PublicationReceipt> = {};
      const refs = new Map<string, DatasetRef>(spec.views.map((view) => [datasetKey(dashboardViewData(view)), dashboardViewData(view)]));
      for (const [key, ref] of refs) {
        if (ref.kind !== "publication") throw new Error("CHART_DATA_UNSUPPORTED: dashboards only read published results; set each view's data to { \"kind\": \"publication\", \"receiptId\": \"<receiptId from publish_query_result or export_query>\" }");
        const published = await options.artifacts.resolveRows(ref.receiptId, business);
        if (published.rows.length > MAX_DASHBOARD_DATASET_ROWS) {
          throw new Error(`DASHBOARD_TOO_MANY_ROWS: ${ref.receiptId} has ${published.rows.length} rows and a dashboard view holds at most ${MAX_DASHBOARD_DATASET_ROWS}; aggregate in the query, or use export_query for the detail`);
        }
        datasets[key] = { columns: [...published.columns], rows: jsonSafeRows(published.rows) };
        receipts[key] = published.receipt;
        const disclosure = published.receipt.disclosure?.summary;
        sources[key] = { receiptId: ref.receiptId, contentHash: published.receipt.contentHash, ...(disclosure ? { disclosure } : {}) };
      }

      // Validated on the same JSON-safe rows the page reads.
      const validated = validateDashboard(spec, datasets);
      if (!validated.ok) throw new Error(formatDashboardErrors(validated.errors));
      const declared = declaredFields(spec);
      const checks: Record<string, SemanticsCheck[]> = {};
      for (const view of spec.views) {
        const found = semanticChecks(view.type === "chart" ? view.chart.fields : view.fields, receipts[datasetKey(dashboardViewData(view))]!);
        if (found.length > 0) checks[view.id] = found;
      }
      const summary = [
        ...validated.notices.map(({ viewId, notice }) => `[NOTICE] ${viewId}: ${notice.message}`),
        ...Object.entries(checks).flatMap(([viewId, found]) => found.map((check) => `[CHECK] ${viewId}: ${check.message}`)),
        ...Object.values(sources).flatMap((source) => (source.disclosure ? [`[DISCLOSURE] ${source.receiptId}: ${source.disclosure}`] : [])),
        ...(declared.length > 0 ? [`[SEMANTICS] 以下字段的语义来自模型声明，未经业务定义核实：${declared.join("、")}`] : []),
      ];
      if (value.operation === "validate") return { content: [{ type: "text", text: ["dashboard spec valid", ...summary].join("\n") }], details: null };

      const specHash = createHash("sha256").update(JSON.stringify(spec)).digest("hex").slice(0, 8);
      const relativePath = value.editPath ?? `dashboards/${spec.filename ?? `dashboard-${specHash}`}.html`;
      const echartsSource = await (options.echartsSource ?? defaultEchartsSource)();
      const html = renderDashboardHtml(
        { spec, datasets, sources, checks, renderer: CHART_RENDERER_VERSIONS, declaredFields: declared },
        { chartsSource: CHARTS_BROWSER_SOURCE, ...(echartsSource ? { echartsSource } : {}) },
      );
      await options.workspace.write(relativePath, html);
      const text = [
        `[DASHBOARD_CREATED] ${relativePath}`,
        ...summary,
        ...(echartsSource ? [] : ["[WARNING] ECharts 未找到，看板中的图表无法渲染。"]),
        ...(Object.keys(checks).length > 0 ? ["[CHECK] 是对字段声明的核对提示：声明有误就改正 spec 后用 edit 重建看板。"] : []),
        "看板页面已显示 [NOTICE]、[CHECK] 与 [DISCLOSURE]；答复用户时如实转述。",
      ].join("\n");
      return {
        content: [{ type: "text", text }],
        details: { relativePath, fileType: "html", receiptIds: Object.values(sources).map((source) => source.receiptId), renderer: CHART_RENDERER_VERSIONS },
      };
    },
  };
}

export function createDashboardToolDefinitions(options: DashboardToolOptions): readonly DataAgentToolDefinition<DataAgentToolContext>[] {
  return [defineDataAgentTool(generateDashboardTool(options), {
    promptSnippet: "用已发布的查询结果生成独立 HTML 快照看板。",
    promptGuidelines: [
      "仅在看板需求和 dashboard Skill 已授权时使用。spec 为 DashboardSpec v1：views 由 chart（ChartSpec）、table、kpi 组成，每个视图的数据引用 { kind: \"publication\", receiptId }。",
      "先 operation=\"validate\"，通过后 \"create\"；edit 需要完整 spec 和 editPath。工具不聚合、不补零，KPI 只显示一个单元格；出错时按返回的错误修改查询或 spec。",
    ],
  })];
}
