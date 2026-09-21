import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { checkFanout, planFanoutTargets, type FanoutSchema } from "./fanout-check.js";

const schema: FanoutSchema = {
  dialect: "sqlite",
  connectionId: "test",
  tables: [
    { name: "customers", columns: ["customer_id"], primaryKey: ["customer_id"] },
    { name: "payment", columns: ["payment_id", "customer_id", "amount"], primaryKey: ["payment_id"] },
    { name: "rental", columns: ["rental_id", "customer_id"], primaryKey: ["rental_id"] },
    { name: "orders", columns: ["order_id"], primaryKey: ["order_id"] },
    { name: "order_items", columns: ["item_id", "order_id", "amount"], primaryKey: ["item_id"] },
  ],
};

const databases: Database.Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function sqliteRunner(database: Database.Database) {
  return async ({ sql }: { sql: string }) => {
    const statement = database.prepare(sql);
    const columns = statement.columns().map((column) => column.name);
    const rows = statement.all() as Record<string, unknown>[];
    return { columns, rows: rows.map((row) => columns.map((column) => row[column])), truncated: false };
  };
}

function database(): Database.Database {
  const db = new Database(":memory:");
  databases.push(db);
  db.exec(`
    CREATE TABLE customers (customer_id INTEGER PRIMARY KEY);
    CREATE TABLE payment (payment_id INTEGER PRIMARY KEY, customer_id INTEGER, amount REAL);
    CREATE TABLE rental (rental_id INTEGER PRIMARY KEY, customer_id INTEGER);
    CREATE TABLE orders (order_id INTEGER PRIMARY KEY);
    CREATE TABLE order_items (item_id INTEGER PRIMARY KEY, order_id INTEGER, amount REAL);
    INSERT INTO customers VALUES (1);
    INSERT INTO payment VALUES (10, 1, 10.0), (11, 1, 20.0);
    INSERT INTO rental VALUES (100, 1), (101, 1);
    INSERT INTO orders VALUES (20);
    INSERT INTO order_items VALUES (200, 20, 4.0), (201, 20, 5.0);
  `);
  return db;
}

describe("bounded Answering fanout probe", () => {
  it("detects a payment SUM copied by a one-to-many join using a real SQLite statement", async () => {
    const db = database();
    const sql = `SELECT SUM(p.amount) AS total_amount
      FROM customers c
      JOIN payment p ON p.customer_id = c.customer_id
      JOIN rental r ON r.customer_id = c.customer_id`;
    const report = await checkFanout({ sql, schema, dialect: "sqlite", runProbe: sqliteRunner(db) });
    expect(report.status).toBe("finding");
    expect(report.snapshotScope).toBe("probe_statement");
    expect(report.targets).toHaveLength(1);
    expect(report.targets[0]).toMatchObject({ status: "finding", sourceRelation: "payment", sourceKey: "payment_id", reason: "source_key_repeated_after_join" });
    expect(report.targets[0]?.observation).toMatchObject({ sourceRows: 2, sourceDistinctKeys: 2, joinedRows: 4, joinedDistinctKeys: 2, complete: true });
  });

  it("detects COUNT of the parent key copied by detail rows", async () => {
    const db = database();
    const sql = `SELECT COUNT(o.order_id) AS orders_seen
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.order_id`;
    const report = await checkFanout({ sql, schema, dialect: "sqlite", runProbe: sqliteRunner(db) });
    expect(report.status).toBe("finding");
    expect(report.targets[0]).toMatchObject({ status: "finding", sourceRelation: "orders", sourceKey: "order_id" });
    expect(report.targets[0]?.observation).toMatchObject({ sourceRows: 1, joinedRows: 2, joinedDistinctKeys: 1 });
  });

  it("does not flag a detail SUM merely because the parent is repeated", async () => {
    const db = database();
    const sql = `SELECT SUM(oi.amount) AS item_amount
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.order_id`;
    const report = await checkFanout({ sql, schema, dialect: "sqlite", runProbe: sqliteRunner(db) });
    expect(report.status).toBe("clear");
    expect(report.targets[0]).toMatchObject({ status: "clear", sourceRelation: "order_items", sourceKey: "item_id" });
  });

  it("finds a supported aggregate hidden inside a CTE", async () => {
    const db = database();
    const sql = `WITH totals AS (
      SELECT SUM(p.amount) AS total_amount
      FROM customers c
      JOIN payment p ON p.customer_id = c.customer_id
      JOIN rental r ON r.customer_id = c.customer_id
    ) SELECT AVG(total_amount) FROM totals`;
    const plan = planFanoutTargets(sql, schema);
    expect(plan.targets).toHaveLength(1);
    const report = await checkFanout({ sql, schema, dialect: "sqlite", runProbe: sqliteRunner(db) });
    expect(report.status).toBe("finding");
  });

  it("does not inspect exploration-shaped SQL and reports no applicable target", async () => {
    const calls: string[] = [];
    const report = await checkFanout({
      sql: "SELECT COUNT(*) FROM customers",
      schema,
      dialect: "sqlite",
      runProbe: async ({ sql }) => { calls.push(sql); return { columns: [], rows: [], truncated: false }; },
    });
    expect(report.status).toBe("not_applicable");
    expect(calls).toEqual([]);
  });

  it("keeps source-key ambiguity as unknown instead of calling it join fanout", async () => {
    const db = database();
    const ambiguousSchema: FanoutSchema = {
      dialect: "sqlite",
      tables: [{ name: "payment", columns: ["payment_id", "customer_id", "amount"] }, ...schema.tables.filter((table) => table.name !== "payment")],
    };
    const sql = `SELECT SUM(p.amount) FROM customers c JOIN payment p ON p.customer_id = c.customer_id JOIN rental r ON r.customer_id = c.customer_id`;
    const report = await checkFanout({ sql, schema: ambiguousSchema, dialect: "sqlite", runProbe: sqliteRunner(db) });
    expect(report.status).toBe("unknown");
    expect(report.targets[0]?.reason).toBe("source_unique_key_unavailable");
  });

  it("keeps duplicate or NULL source keys as unknown instead of blaming the JOIN", async () => {
    const db = database();
    db.exec("CREATE TABLE loose (record_key INTEGER, customer_id INTEGER); INSERT INTO loose VALUES (1, 1), (1, 1), (NULL, 1);");
    const looseSchema: FanoutSchema = {
      dialect: "sqlite",
      tables: [...schema.tables, { name: "loose", columns: ["record_key", "customer_id"] }],
    };
    const sql = "SELECT COUNT(l.record_key) FROM customers c JOIN loose l ON l.customer_id = c.customer_id JOIN rental r ON r.customer_id = c.customer_id";
    const report = await checkFanout({ sql, schema: looseSchema, dialect: "sqlite", runProbe: sqliteRunner(db) });
    expect(report.status).toBe("unknown");
    expect(report.targets[0]).toMatchObject({ status: "unknown", reason: "source_key_unproven" });
  });

  it("does not skip a non-distinct SUM when a DISTINCT count is also present", async () => {
    const db = database();
    const sql = "SELECT COUNT(DISTINCT c.customer_id) AS customers, SUM(p.amount) AS amount FROM customers c JOIN payment p ON p.customer_id = c.customer_id JOIN rental r ON r.customer_id = c.customer_id";
    const report = await checkFanout({ sql, schema, dialect: "sqlite", runProbe: sqliteRunner(db) });
    expect(report.status).toBe("finding");
    expect(report.targets).toEqual(expect.arrayContaining([expect.objectContaining({ sourceRelation: "payment", status: "finding" })]));
  });

  it("allows a derived pre-aggregation to remain unknown instead of forcing a false clear", async () => {
    const db = database();
    const sql = "WITH totals AS (SELECT customer_id, SUM(amount) AS amount FROM payment GROUP BY customer_id) SELECT SUM(t.amount) FROM totals t JOIN customers c ON c.customer_id = t.customer_id";
    const report = await checkFanout({ sql, schema, dialect: "sqlite", runProbe: sqliteRunner(db) });
    expect(report.status).toBe("unknown");
  });

  it("reports unsupported dialect without executing a probe", async () => {
    let calls = 0;
    const report = await checkFanout({
      sql: "SELECT COUNT(c.customer_id) FROM customers c JOIN rental r ON r.customer_id = c.customer_id",
      schema: { ...schema, dialect: "mysql" },
      dialect: "mysql",
      runProbe: async () => { calls += 1; return { columns: [], rows: [], truncated: false }; },
    });
    expect(report.status).toBe("unknown");
    expect(report.unsupportedReasons).toContain("unsupported_dialect");
    expect(calls).toBe(0);
  });

  it("does not claim completeness when the bounded input sentinel is reached", async () => {
    const db = database();
    const sql = `SELECT SUM(p.amount) FROM customers c JOIN payment p ON p.customer_id = c.customer_id JOIN rental r ON r.customer_id = c.customer_id`;
    const report = await checkFanout({ sql, schema, dialect: "sqlite", maxInputRows: 1, runProbe: sqliteRunner(db) });
    expect(report.status).toBe("unknown");
    expect(report.targets[0]).toMatchObject({ status: "unknown", reason: "input_limit_exceeded" });
  });
});
