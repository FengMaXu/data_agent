import type { FieldMeta } from "@data-agent/contracts";
import { fieldTitle } from "./semantics.js";

/**
 * The observed facts of one column, as a Physical Profile records them.
 * Structural, so the checker needs nothing from the Runtime.
 */
export interface ColumnFacts {
  readonly name: string;
  readonly kind: string;
  readonly nullCount: number;
  /** Numeric columns only, as plain decimal text. */
  readonly min?: string;
  readonly max?: string;
}

export type SemanticsCheckCode = "DECLARED_NUMERIC_NOT_NUMERIC" | "RATIO_OUT_OF_RANGE" | "PERCENT_LOOKS_LIKE_RATIO" | "ADDITIVE_NAME_SUGGESTS_RATE";

/** A declared field semantics that the observed data makes doubtful. It informs and never blocks (ADR-0003). */
export interface SemanticsCheck {
  readonly code: SemanticsCheckCode;
  readonly field: string;
  readonly message: string;
}

const NON_NUMERIC_KINDS = new Set(["text", "boolean", "json", "mixed"]);
// Names that usually denote rates, shares or averages; only ever used to raise a question.
const RATE_NAME = /率|均|占比|比例|比重|单价|rate|ratio|avg|average|mean|pct|percent|share/i;

/**
 * Compare model-declared field semantics with a result's Physical Profile.
 * Only doubtful combinations are reported; nothing is inferred or rewritten.
 */
export function checkDeclaredSemantics(fields: Readonly<Record<string, FieldMeta>> | undefined, columns: readonly ColumnFacts[] | undefined): SemanticsCheck[] {
  if (!fields || !columns) return [];
  const checks: SemanticsCheck[] = [];
  for (const [field, meta] of Object.entries(fields)) {
    if (meta.type !== "quantitative") continue;
    const column = columns.find((item) => item.name === field);
    if (!column) continue;
    const title = fieldTitle(field, meta);
    if (NON_NUMERIC_KINDS.has(column.kind)) {
      checks.push({ code: "DECLARED_NUMERIC_NOT_NUMERIC", field, message: `${title} 声明为数值，但结果中该列含非数值内容，请核对查询` });
      continue;
    }
    const min = column.min === undefined ? undefined : Number(column.min);
    const max = column.max === undefined ? undefined : Number(column.max);
    if (min !== undefined && max !== undefined) {
      const range = `[${column.min}, ${column.max}]`;
      if (meta.storage === "ratio" && (max > 1 || min < -1)) {
        checks.push({ code: "RATIO_OUT_OF_RANGE", field, message: `${title} 声明为比率（0.12 表示 12%），但数值范围为 ${range}，可能是百分数或原值；若确为比率（如超过 100% 的增长）可忽略` });
      } else if (meta.storage === "percent" && Math.max(Math.abs(min), Math.abs(max)) <= 1 && (min !== 0 || max !== 0)) {
        checks.push({ code: "PERCENT_LOOKS_LIKE_RATIO", field, message: `${title} 声明为百分数（12 表示 12%），但全部数值在 ${range} 内，可能是比率；若确为不足 1% 的百分数可忽略` });
      }
    }
    if (meta.additivity === "additive" && (RATE_NAME.test(field) || (meta.label !== undefined && RATE_NAME.test(meta.label)))) {
      checks.push({ code: "ADDITIVE_NAME_SUGGESTS_RATE", field, message: `${title} 声明为可加，但名称像比率、占比或均值；这类指标不能相加，请核对 additivity` });
    }
  }
  return checks;
}
