export { compileChart, validateChart } from "./compile.js";
export { MARKS, chartFields, exampleDataset } from "./marks/index.js";
export type { MarkDefinition } from "./marks/types.js";
export { checkDeclaredSemantics, type ColumnFacts, type SemanticsCheck, type SemanticsCheckCode } from "./consistency.js";
export { datasetKey, formatDashboardCell, readerNotices, resolveKpiCards, resolveTable, validateDashboard, type DashboardDatasets, type DashboardError, type DashboardErrorCode, type DashboardTableDisplay, type DashboardValidation, type DashboardViewNotice, type KpiCardDisplay } from "./dashboard.js";
export { PALETTE, formatFieldValue, numericCell } from "./semantics.js";
export { CHART_COMPILER_VERSION, CHART_RENDERER_VERSIONS, CHART_THEME_VERSION, type ChartRendererVersions } from "./version.js";
export type { ChartCompileOptions, ChartCompileResult, ChartDataset, ChartError, ChartErrorCode, ChartOption, PresentationNotice } from "./types.js";
