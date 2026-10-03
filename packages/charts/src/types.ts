import type { ChartSpec, FieldMeta } from "@data-agent/contracts";

/** Rows in the shape ResultStore keeps them: one array per row, aligned with `columns`. */
export interface ChartDataset {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
}

export interface ChartCompileOptions {
  /** Interactive targets may use viewports; static targets must fit every value on the canvas. */
  readonly target: "interactive" | "static";
  /** Canvas size in pixels; defaults to 800 x 480. */
  readonly width?: number;
  readonly height?: number;
  /** "compact" restyles for small dashboard tiles; layout decisions still follow width and height. */
  readonly density?: "standard" | "compact";
  /**
   * Keep the focus colour for highlights: categorical series, slices and nodes skip it. Dashboards set
   * it so that orange means "look here" on every chart of a page, never just "the second category".
   */
  readonly reserveFocus?: boolean;
  /** Resolved field semantics (Dataset Annotations). Defaults to the spec's own declarations. */
  readonly fields?: Readonly<Record<string, FieldMeta>>;
}

export type ChartErrorCode =
  | "SCHEMA_INVALID"
  | "FIELD_NOT_FOUND"
  | "SEMANTICS_MISSING"
  | "VALUE_NOT_NUMERIC"
  | "INVALID_ENCODING"
  | "DUPLICATE_KEY"
  | "NON_ADDITIVE_PART_OF_WHOLE"
  | "NEGATIVE_IN_PART_OF_WHOLE"
  | "INCOMPLETE_PART_OF_WHOLE"
  | "INVALID_SELECTION"
  | "CAPACITY_EXCEEDED"
  | "BIN_OVERLAP"
  | "STAT_ORDER_VIOLATION"
  | "RANGE_INCONSISTENT"
  | "FLOW_CYCLE"
  | "VALUE_OUT_OF_DOMAIN";

export interface ChartError {
  readonly code: ChartErrorCode;
  readonly message: string;
  readonly path?: string;
  readonly field?: string;
  /** A way to fix the spec or the query; the compiler never repairs anything itself. */
  readonly hint?: string;
}

/** How the chart presents its data (ADR-0008 decision 6); distinct from a result's Disclosure. */
export interface PresentationNotice {
  readonly kind: "layout" | "viewport" | "selection";
  readonly code: string;
  readonly message: string;
  readonly field?: string;
}

/** An ECharts option held in memory; it may contain formatter functions and is never persisted. */
export type ChartOption = Record<string, unknown>;

export type ChartCompileResult =
  | { readonly ok: true; readonly spec: ChartSpec; readonly option: ChartOption; readonly notices: readonly PresentationNotice[] }
  | { readonly ok: false; readonly errors: readonly ChartError[] };
