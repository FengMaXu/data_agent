import { describe, expect, it } from "vitest";
import type { FieldMeta } from "@data-agent/contracts";
import { checkDeclaredSemantics, type ColumnFacts } from "./index.js";

const ratio: FieldMeta = { type: "quantitative", storage: "ratio", additivity: "non_additive" };
const percent: FieldMeta = { type: "quantitative", storage: "percent", additivity: "non_additive" };
const additive: FieldMeta = { type: "quantitative", storage: "raw", additivity: "additive" };
const numeric = (name: string, min: string, max: string): ColumnFacts => ({ name, kind: "decimal", nullCount: 0, min, max });
const codes = (fields: Record<string, FieldMeta>, columns: ColumnFacts[]) => checkDeclaredSemantics(fields, columns).map((check) => `${check.code}:${check.field}`);

describe("Declared semantics against the Physical Profile", () => {
  it("accepts declarations the observed data agrees with", () => {
    expect(codes({ growth: ratio, share_pct: percent, sales: additive }, [numeric("growth", "-0.25", "0.16"), numeric("share_pct", "3.5", "62"), numeric("sales", "0", "5234.00")])).toEqual([]);
  });

  it("questions a ratio outside [-1, 1] and a percent inside it", () => {
    expect(codes({ growth: ratio, share: percent }, [numeric("growth", "-25.12", "16.46"), numeric("share", "0.05", "0.62")])).toEqual(["RATIO_OUT_OF_RANGE:growth", "PERCENT_LOOKS_LIKE_RATIO:share"]);
    // An all-zero column says nothing about the scale.
    expect(codes({ share: percent }, [numeric("share", "0", "0")])).toEqual([]);
  });

  it("questions additive measures named like rates or averages, by column or label", () => {
    expect(codes({ avg_price: additive, amount: { ...additive, label: "毛利率" }, sales: additive }, [numeric("avg_price", "1", "9"), numeric("amount", "0", "1"), numeric("sales", "1", "2")])).toEqual(["ADDITIVE_NAME_SUGGESTS_RATE:avg_price", "ADDITIVE_NAME_SUGGESTS_RATE:amount"]);
    // English terms count only as whole tokens.
    expect(codes({ corporate_sales: additive, operator_amount: additive, meaningful_total: additive, growthRate: additive }, [numeric("corporate_sales", "1", "2"), numeric("operator_amount", "1", "2"), numeric("meaningful_total", "1", "2"), numeric("growthRate", "1", "2")])).toEqual([]);
  });

  it("questions a numeric declaration over a text column", () => {
    expect(codes({ sales: additive }, [{ name: "sales", kind: "text", nullCount: 0 }])).toEqual(["DECLARED_NUMERIC_NOT_NUMERIC:sales"]);
  });

  it("says nothing without a profile, for undeclared columns or non-quantitative fields", () => {
    expect(codes({ growth: ratio }, [])).toEqual([]);
    expect(checkDeclaredSemantics({ growth: ratio }, undefined)).toEqual([]);
    expect(codes({ month: { type: "temporal", grain: "month", zone: "floating" } }, [{ name: "month", kind: "text", nullCount: 0 }])).toEqual([]);
    expect(codes({ growth: ratio }, [{ name: "growth", kind: "null", nullCount: 3 }])).toEqual([]);
  });
});
