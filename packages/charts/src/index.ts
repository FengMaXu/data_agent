export { compileChart, validateChart } from "./compile.js";
export { MARKS, chartFields, exampleDataset } from "./marks/index.js";
export type { MarkDefinition } from "./marks/types.js";
export { checkDeclaredSemantics, type ColumnFacts, type SemanticsCheck, type SemanticsCheckCode } from "./consistency.js";
export { ROW_CHART_HEIGHTS, dashboardRows, datasetKey, formatDashboardCell, readerNotices, resolveInsights, resolveKpiCards, resolveTable, sparklinePath, tileChartSize, validateDashboard, type DashboardCellMark, type DashboardDatasets, type DashboardError, type DashboardErrorCode, type DashboardLayoutAdvice, type DashboardRow, type DashboardTableDisplay, type DashboardValidation, type DashboardViewNotice, type InsightDisplay, type KpiCardDisplay } from "./dashboard.js";
export { PALETTE, formatFieldValue, numericCell } from "./semantics.js";
export { THEME } from "./theme.js";
export { CHART_COMPILER_VERSION, CHART_RENDERER_VERSIONS, CHART_THEME_VERSION, type ChartRendererVersions } from "./version.js";
export type { ChartCompileOptions, ChartCompileResult, ChartDataset, ChartError, ChartErrorCode, ChartOption, PresentationNotice } from "./types.js";
