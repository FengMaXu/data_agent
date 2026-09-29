import { createHash } from "node:crypto";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type { AgentHarnessTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ChartSpec, DatasetRef, FieldMeta } from "@data-agent/contracts";
import { checkDeclaredSemantics, type ChartError, type ChartRendererVersions, type PresentationNotice, type SemanticsCheck } from "@data-agent/charts";
import type { PhysicalProfile } from "../answering/public.js";
import { renderChartSvg } from "../chart-render.js";
import type { ArtifactDirectory } from "../facets/artifact-directory.js";
import { ChartDataResolver, describeSource, type ChartDataSource } from "../facets/chart-data.js";
import type { DerivedDatasets } from "../facets/derived-datasets.js";
import type { WorkspaceStore } from "../workspace.js";
import { trustedContext, type DataAgentToolContext } from "./answering.js";
import { defineDataAgentTool, type DataAgentToolDefinition } from "./tool-definition.js";

export const RENDER_CHART_PARAMETERS = Type.Object({
  /** A ChartSpec v1; validated by the chart compiler, which returns structured errors. */
  spec: Type.Unknown(),
  fileName: Type.Optional(Type.String({ pattern: "^[A-Za-z0-9_\\-\\u4e00-\\u9fa5]{1,80}$" })),
  width: Type.Optional(Type.Integer({ minimum: 320, maximum: 2400 })),
  height: Type.Optional(Type.Integer({ minimum: 200, maximum: 1600 })),
}, { additionalProperties: false });
type RenderChartInput = Static<typeof RENDER_CHART_PARAMETERS>;

export interface ChartToolOptions {
  readonly workspace: WorkspaceStore;
  readonly artifacts: Pick<ArtifactDirectory, "resolveRows" | "resolveReceipt">;
  /** Derived datasets registered by run_python; without it charts read published results only. */
  readonly derived?: Pick<DerivedDatasets, "resolve">;
}

export const CHART_RENDER_RECORD_VERSION = 1;

/**
 * Written next to each static chart as `<name>.chart.json` so the delivered SVG
 * can be traced and re-rendered (ADR-0008 decision 9). Rows stay behind the Receipt or derived dataset.
 */
export interface ChartRenderRecord {
  readonly version: typeof CHART_RENDER_RECORD_VERSION;
  /** The SVG this record describes, relative to the record. */
  readonly svg: string;
  readonly chartSpec: ChartSpec;
  readonly data: ChartDataSource;
  readonly renderer: ChartRendererVersions;
  readonly target: "static";
  readonly width: number;
  readonly height: number;
  readonly notices: readonly PresentationNotice[];
  /** Declared semantics the result's Physical Profile makes doubtful. */
  readonly checks: readonly SemanticsCheck[];
}

/** Declared field semantics checked against the data's Physical Profile; informs, never blocks. */
export function semanticChecks(fields: Readonly<Record<string, FieldMeta>> | undefined, profile: PhysicalProfile | undefined): SemanticsCheck[] {
  return checkDeclaredSemantics(fields, profile?.columns);
}

/** Chat widgets persist their rows in the session, so they are bounded; larger results belong in render_chart or export_query. */
export const MAX_WIDGET_ROWS = 5000;

/** JSON-safe copy of published rows: bigint as decimal text and Date as ISO text, both of which the compiler reads back. */
export function jsonSafeRows(rows: readonly (readonly unknown[])[]): unknown[][] {
  return rows.map((row) => row.map((cell) => (typeof cell === "bigint" ? cell.toString() : cell instanceof Date ? cell.toISOString() : cell === undefined ? null : cell)));
}

export function formatChartErrors(errors: readonly ChartError[]): string {
  const lines = errors.map((error) => `[${error.code}] ${error.message}${error.path ? ` (${error.path})` : ""}${error.hint ? `；建议：${error.hint}` : ""}`);
  return `CHART_SPEC_INVALID\n${lines.join("\n")}`;
}

/** The Dataset Reference a chart reads: a published result or a derived dataset. Model-written rows are never accepted. */
export function chartDataRef(spec: unknown): DatasetRef {
  const data = spec && typeof spec === "object" ? (spec as { data?: unknown }).data : undefined;
  const ref = data && typeof data === "object" ? data as { kind?: unknown; receiptId?: unknown; derivedId?: unknown } : undefined;
  if (ref?.kind === "publication" && typeof ref.receiptId === "string" && ref.receiptId) return { kind: "publication", receiptId: ref.receiptId };
  if (ref?.kind === "derived" && typeof ref.derivedId === "string" && ref.derivedId) return { kind: "derived", derivedId: ref.derivedId };
  // A live reference reads its current Receipt like any publication; only an app-hosted dashboard refreshes it.
  if (ref?.kind === "live" && typeof ref.receiptId === "string" && ref.receiptId) return { kind: "live", receiptId: ref.receiptId };
  throw new Error("CHART_DATA_UNSUPPORTED: charts read published results or derived datasets; set spec.data to { \"kind\": \"publication\", \"receiptId\": \"<receiptId from publish_query_result or export_query>\" } or { \"kind\": \"derived\", \"derivedId\": \"<derivedId from run_python>\" }");
}

/** Tool-text lines stating where a chart's rows came from and what their results disclose. */
export function sourceLines(source: ChartDataSource, disclosures: readonly string[]): string[] {
  return [
    ...(source.kind === "derived" ? [`[DERIVED] ${describeSource(source)}`] : []),
    ...disclosures.map((disclosure) => `[DISCLOSURE] ${disclosure}`),
  ];
}

export function declaredFields(spec: unknown): string[] {
  const fields = spec && typeof spec === "object" ? (spec as { fields?: unknown }).fields : undefined;
  return fields && typeof fields === "object" ? Object.keys(fields) : [];
}

function renderChartTool(options: ChartToolOptions): AgentHarnessTool<DataAgentToolContext> {
  return {
    name: "render_chart",
    label: "render_chart",
    description: "Render a ChartSpec over one published query result or derived dataset into a static SVG in the workspace.",
    replay: "safe",
    parameters: RENDER_CHART_PARAMETERS,
    async execute(_toolCallId, input, _onUpdate, toolContext, invocation, context): Promise<AgentToolResult<unknown>> {
      if (!Value.Check(RENDER_CHART_PARAMETERS, input)) throw new Error("RENDER_CHART_INPUT_INVALID");
      const value = input as RenderChartInput;
      const business = trustedContext(toolContext, invocation, context);
      const data = await new ChartDataResolver({ publications: options.artifacts, ...(options.derived ? { derived: options.derived } : {}) }).resolve(chartDataRef(value.spec), business);
      const rendered = renderChartSvg(value.spec, data, {
        ...(value.width ? { width: value.width } : {}),
        ...(value.height ? { height: value.height } : {}),
      });
      if (!rendered.ok) throw new Error(formatChartErrors(rendered.errors));
      const specHash = createHash("sha256").update(JSON.stringify(value.spec)).digest("hex").slice(0, 8);
      const baseName = value.fileName ?? `chart-${specHash}`;
      const relativePath = `charts/${baseName}.svg`;
      const recordPath = `charts/${baseName}.chart.json`;
      const checks = semanticChecks(rendered.spec.fields, data.physicalProfile);
      const record: ChartRenderRecord = {
        version: CHART_RENDER_RECORD_VERSION,
        svg: `${baseName}.svg`,
        chartSpec: rendered.spec,
        data: data.source,
        renderer: rendered.renderer,
        target: "static",
        width: rendered.width,
        height: rendered.height,
        notices: rendered.notices,
        checks,
      };
      await options.workspace.write(relativePath, rendered.svg);
      await options.workspace.write(recordPath, `${JSON.stringify(record, null, 2)}\n`);
      const declared = declaredFields(value.spec);
      const text = [
        `[CHART_RENDERED] ${relativePath} (${rendered.width}×${rendered.height})`,
        ...rendered.notices.map((notice) => `[NOTICE] ${notice.message}`),
        ...checks.map((check) => `[CHECK] ${check.message}`),
        ...sourceLines(data.source, data.disclosures),
        ...(declared.length > 0 ? [`[SEMANTICS] 以下字段的语义来自模型声明，未经业务定义核实：${declared.join("、")}`] : []),
        ...(checks.length > 0 ? ["[CHECK] 是对字段声明的核对提示：声明有误就改正 spec 重新渲染；确认无误再使用此图。"] : []),
        `在报告中用 ![标题](${relativePath}) 引用，并把 [NOTICE]、[DISCLOSURE]${data.source.kind === "derived" ? "、[DERIVED]" : ""} 写进图注。`,
      ].join("\n");
      return {
        content: [{ type: "text", text }],
        details: { relativePath, recordPath, fileType: "svg", ...(data.source.kind === "publication" ? { receiptId: data.source.receiptId } : {}), source: data.source, renderer: rendered.renderer, notices: rendered.notices, checks, disclosures: data.disclosures },
      };
    },
  };
}

export function createChartToolDefinitions(options: ChartToolOptions): readonly DataAgentToolDefinition<DataAgentToolContext>[] {
  return [defineDataAgentTool(renderChartTool(options), {
    promptSnippet: "把一个已发布的查询结果或派生数据集按 ChartSpec 渲染为静态 SVG 图表。",
    promptGuidelines: [
      "spec 必须是 ChartSpec v1，spec.data 为 { kind: \"publication\", receiptId }（先用 publish_query_result 或 export_query 发布结果），或 run_python 登记的 { kind: \"derived\", derivedId }。",
      "度量字段在 spec.fields 中声明 type: \"quantitative\" 以及 storage 与 additivity；工具不聚合、不补零，出错时按返回的错误与建议修改查询或 spec。",
      "把返回的 [NOTICE]、[DISCLOSURE]、[DERIVED]、[SEMANTICS] 写进报告的图注，不要省略。",
      "返回 [CHECK] 时先核对对应字段的 storage、additivity 声明；有误就改正后重新渲染，不要忽略。",
    ],
  })];
}
