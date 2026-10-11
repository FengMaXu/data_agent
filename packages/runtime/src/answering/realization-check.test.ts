import { describe, expect, it } from "vitest";
import type { FieldRecord, SpecFields } from "./model.js";
import type { FieldValue } from "./fields.js";
import { evaluateSpecRealization, realizationDisclosure } from "./realization-check.js";

function specified(value: unknown): FieldRecord {
  return { state: "specified", value: value as FieldValue, basis: { kind: "assumed" } };
}

function fields(values: Record<string, unknown>): SpecFields {
  return Object.fromEntries(Object.entries(values).map(([path, value]) => [path, value === "n/a" ? { state: "not_applicable" } : specified(value)])) as SpecFields;
}

function conflicts(values: Record<string, unknown>, sql: string) {
  return evaluateSpecRealization(fields(values), sql).findings.map((item) => ({ blocking: item.blocking, message: item.message }));
}

describe("Spec realization", () => {
  describe("population.source", () => {
    const source = { "population.source": { tables: ["pizza_customer_orders", "pizza_recipes"] } };

    it("flags SQL that never reads a declared table as likely: a lookup table may be filtered by key instead", () => {
      expect(conflicts(source, "SELECT COUNT(*) FROM pizza_customer_orders")).toEqual([
        { blocking: false, message: expect.stringContaining('"pizza_recipes"') },
      ]);
    });

    it("accepts quoted, schema-qualified and aliased reads", () => {
      expect(conflicts(source, 'SELECT 1 FROM main."pizza_customer_orders" o JOIN `pizza_recipes` r ON r.pizza_id = o.pizza_id')).toEqual([]);
    });

    it("does not count a table named only in a comment or string literal", () => {
      expect(conflicts(source, "SELECT 'pizza_recipes' FROM pizza_customer_orders -- pizza_recipes")).toHaveLength(1);
    });

    it("leaves a non-identifier declaration undetermined", () => {
      const report = evaluateSpecRealization(fields({ "population.source": { tables: ["ga_sessions_2017*"] } }), "SELECT 1 FROM `ga_sessions_*`");
      expect(report.verdicts).toEqual([{ path: "population.source", outcome: "not_determinable", reason: expect.any(String) }]);
      expect(report.coverage.outcome).toBe("unknown");
    });
  });

  describe("selection", () => {
    const top3 = (ties: string) => ({ selection: { n: 3, orderBy: "revenue desc" }, "selection.ties": ties });

    it("blocks a strict top-n whose outermost cap differs from n", () => {
      expect(conflicts(top3("strict"), "SELECT name FROM t ORDER BY revenue DESC LIMIT 5")).toEqual([{ blocking: true, message: expect.stringContaining("keeps 5 rows") }]);
    });

    it("reads the count of MySQL LIMIT offset, count", () => {
      expect(conflicts(top3("strict"), "SELECT name FROM t ORDER BY revenue DESC LIMIT 0, 3")).toEqual([]);
    });

    it("ignores caps inside CTEs and subqueries", () => {
      expect(conflicts(top3("strict"), "WITH r AS (SELECT * FROM t LIMIT 100) SELECT name FROM r ORDER BY revenue DESC LIMIT 3")).toEqual([]);
    });

    it("blocks a row cap that drops ties the Spec keeps", () => {
      expect(conflicts(top3("include_ties"), "SELECT name FROM t ORDER BY revenue DESC LIMIT 3")).toEqual([{ blocking: true, message: expect.stringContaining("RANK() <= 3") }]);
      expect(conflicts(top3("include_ties"), "SELECT name FROM t ORDER BY revenue DESC FETCH FIRST 3 ROWS WITH TIES")).toEqual([]);
      expect(conflicts(top3("include_ties"), "SELECT name FROM (SELECT name, RANK() OVER (ORDER BY revenue DESC) rk FROM t) x WHERE rk <= 3")).toEqual([]);
    });

    it("flags ROW_NUMBER without a rank function as a likely tie conflict", () => {
      expect(conflicts(top3("include_ties"), "SELECT name FROM (SELECT name, ROW_NUMBER() OVER (ORDER BY revenue DESC) rn FROM t) x WHERE rn <= 3")).toEqual([{ blocking: false, message: expect.stringContaining("ROW_NUMBER") }]);
    });
  });

  describe("measure.formula", () => {
    it("blocks a percentage the SQL never multiplies by 100", () => {
      const formula = { "measure.formula": { op: "percentage", numerator: { op: "count", of: "late orders" }, denominator: { op: "count", of: "orders" } } };
      expect(conflicts(formula, "SELECT SUM(late) * 1.0 / COUNT(*) FROM orders")).toEqual([{ blocking: true, message: expect.stringContaining("percentage") }]);
      expect(conflicts(formula, "SELECT ROUND(100.0 * SUM(late) / COUNT(*), 2) FROM orders")).toEqual([]);
    });

    it("flags count_distinct without DISTINCT as likely", () => {
      expect(conflicts({ "measure.formula": { op: "count_distinct", of: "customer_id" } }, "SELECT COUNT(customer_id) FROM orders")).toEqual([{ blocking: false, message: expect.stringContaining("DISTINCT") }]);
    });

    it("flags fewer aggregation layers than the formula nests", () => {
      const formula = { "measure.formula": { op: "avg", per: "country", of: { op: "avg", per: "player", of: { op: "sum", per: "match", of: "runs" } } } };
      expect(conflicts(formula, "SELECT country, AVG(runs) FROM batting GROUP BY country")).toEqual([{ blocking: false, message: expect.stringContaining("3 aggregation layers") }]);
      const nested = `
        WITH per_match AS (SELECT country, player, match_id, SUM(runs) AS runs FROM batting GROUP BY 1, 2, 3),
             per_player AS (SELECT country, player, AVG(runs) AS runs FROM per_match GROUP BY 1, 2)
        SELECT country, AVG(runs) FROM per_player GROUP BY country`;
      expect(conflicts(formula, nested)).toEqual([]);
    });

    it("counts windowed aggregates and ignores aggregates nested in scalar calls of the same block", () => {
      const formula = { "measure.formula": { op: "avg", of: { op: "sum", per: "customer", of: "amount" } } };
      expect(conflicts(formula, "SELECT AVG(total) FROM (SELECT ROUND(SUM(amount), 2) AS total FROM payments GROUP BY customer_id) x")).toEqual([]);
      expect(conflicts(formula, "SELECT DISTINCT AVG(SUM(amount)) OVER () FROM payments GROUP BY customer_id")).toEqual([]);
      expect(conflicts(formula, "SELECT ROUND(SUM(amount), 2) FROM payments")).toHaveLength(1);
    });
  });

  describe("grouping grain", () => {
    it("flags a declared calendar grain the SQL never derives", () => {
      expect(conflicts({ grouping: [{ key: "order date", grain: "month" }] }, "SELECT order_date, COUNT(*) FROM orders GROUP BY order_date")).toEqual([{ blocking: false, message: expect.stringContaining("month grain") }]);
    });

    it("recognizes common month derivations, including those in literals", () => {
      const grouping = { grouping: [{ key: "下单时间", grain: "按月" }] };
      for (const sql of [
        "SELECT strftime('%Y-%m', order_date) m, COUNT(*) FROM orders GROUP BY m",
        "SELECT DATE_TRUNC('month', order_date) m, COUNT(*) FROM orders GROUP BY 1",
        "SELECT substr(order_date, 1, 7) m, COUNT(*) FROM orders GROUP BY 1",
      ]) expect(conflicts(grouping, sql)).toEqual([]);
    });
  });

  it("is not applicable when no sealed field has a rule, and never reads open fields", () => {
    const open: SpecFields = { "population.source": { state: "open", alternatives: [{ id: "a" as never, value: { tables: ["x"] } as FieldValue }] } };
    expect(evaluateSpecRealization(open, "SELECT 1").coverage.outcome).toBe("not_applicable");
    expect(evaluateSpecRealization(fields({ "population.entity": { name: "orders" } }), "SELECT 1").coverage.outcome).toBe("not_applicable");
  });

  it("discloses only the likely conflicts a result was delivered with", () => {
    const report = evaluateSpecRealization(fields({ "measure.formula": { op: "count_distinct", of: "customer_id" } }), "SELECT COUNT(customer_id) FROM orders");
    expect(report.coverage.outcome).toBe("finding");
    expect(realizationDisclosure(report.findings)).toContain("DISTINCT");
    expect(realizationDisclosure([])).toBe("");
  });
});
