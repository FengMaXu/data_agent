import { describe, expect, it } from "vitest";
import { createQueryDigestCompiler, schemaEvidenceFromDdl, type SchemaEvidence } from "./query-digest.js";

const schema: SchemaEvidence = {
  connectionId: "conn-1",
  dialect: "sqlite",
  tables: [
    { name: "orders", columns: ["id", "customer_id", "amount", "created_at"], primaryKey: ["id"] },
    { name: "customers", columns: ["id", "name"], primaryKey: ["id"], uniqueKeys: [["id"]], foreignKeys: [{ columns: ["id"], references: { table: "orders", columns: ["customer_id"] } }] },
  ],
};

describe("Query Digest compiler", () => {
  it("describes sources, measures, filters, grouping, ordering and output lineage", () => {
    const digest = createQueryDigestCompiler().compile({
      sql: "SELECT c.name, SUM(o.amount) AS total FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.amount IS NOT NULL GROUP BY c.name ORDER BY total DESC LIMIT 3",
      dialect: "sqlite",
      schema,
    });

    expect(digest.sources.map((source) => source.name)).toEqual(["orders", "customers"]);
    expect(digest.joins).toHaveLength(1);
    expect(digest.joins[0].condition).toBe("c.id = o.customer_id");
    expect(digest.measures.map((measure) => measure.function)).toContain("SUM");
    expect(digest.groupBy).toEqual(["c.name"]);
    expect(digest.orderBy).toEqual(["total DESC"]);
    expect(digest.limit).toBe(3);
    expect(digest.filters).toContain("o.amount IS NOT NULL");
    expect(digest.outputLineage[0].columns).toContain("c.name");
    expect(digest.outputLineage[1].columns).toContain("o.amount");
    expect(digest.coverage.sources).toBe("checked");
    expect(digest.coverage.outputLineage).toBe("checked");
    expect(digest.schemaEvidenceFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps each JOIN condition separate", () => {
    const digest = createQueryDigestCompiler().compile({
      sql: "SELECT a.id FROM a JOIN b ON b.a_id = a.id LEFT JOIN c ON c.b_id = b.id",
      dialect: "mysql",
    });
    expect(digest.joins.map((join) => join.condition)).toEqual(["b.a_id = a.id", "c.b_id = b.id"]);
    const using = createQueryDigestCompiler().compile({ sql: "SELECT * FROM a JOIN b USING (id)", dialect: "mysql" });
    expect(using.joins[0].condition).toBe("USING(id)");
  });

  it("records windows, set operations and unsupported coverage without inventing facts", () => {
    const digest = createQueryDigestCompiler().compile({
      sql: "WITH ranked AS (SELECT customer_id, amount, ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY amount DESC) AS rn FROM orders) SELECT customer_id, amount FROM ranked WHERE rn = 1 UNION ALL SELECT customer_id, amount FROM orders",
      dialect: "snowflake",
      schema: { ...schema, dialect: "snowflake" },
    });

    expect(digest.windows[0]).toMatchObject({ function: "ROW_NUMBER", partitionBy: ["customer_id"], orderBy: ["amount DESC"] });
    expect(digest.setOperations).toEqual(["UNION ALL"]);
    expect(digest.coverage.windows).toBe("checked");
    expect(digest.lineageCompleteness).not.toBe("complete");
    expect(digest.unsupportedNodes).toContain("subquery");
  });

  it("extracts formal keys and columns from DDL for the Schema evidence slice", () => {
    const evidence = schemaEvidenceFromDdl("conn-1", "sqlite", "CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT UNIQUE); CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, FOREIGN KEY (customer_id) REFERENCES customers(id));");
    expect(evidence.tables[0]).toMatchObject({ name: "customers", columns: ["id", "name"], primaryKey: ["id"], uniqueKeys: [["name"]] });
    expect(evidence.tables[1].foreignKeys).toEqual([{ columns: ["customer_id"], references: { table: "customers", columns: ["id"] } }]);
  });

  it("fingerprints only the relevant Schema slice", () => {
    const compiler = createQueryDigestCompiler();
    const first = compiler.compile({ sql: "SELECT id FROM orders", dialect: "sqlite", schema });
    const unrelated = compiler.compile({
      sql: "SELECT id FROM orders",
      dialect: "sqlite",
      schema: { ...schema, tables: [...schema.tables, { name: "unrelated", columns: ["secret"] }] },
    });
    const changed = compiler.compile({
      sql: "SELECT id FROM orders",
      dialect: "sqlite",
      schema: { ...schema, tables: [{ ...schema.tables[0], columns: ["id", "different"] }, schema.tables[1]] },
    });

    expect(unrelated.schemaEvidenceFingerprint).toBe(first.schemaEvidenceFingerprint);
    expect(changed.schemaEvidenceFingerprint).not.toBe(first.schemaEvidenceFingerprint);
  });
});
