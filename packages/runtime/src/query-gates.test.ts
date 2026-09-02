import { describe, expect, it } from "vitest";
import { createAnswerSpec } from "./answer-spec.js";
import { createQueryDigestCompiler } from "./query-digest.js";
import { evaluateG1, evaluateG2, evaluateG3, evaluateG4, evaluateGates, candidateSemanticFingerprint } from "./query-gates.js";

const compiler = createQueryDigestCompiler();

describe("bounded deterministic query gates", () => {
  it("allows a short Top-N result without inventing an exact row count", () => {
    const spec = createAnswerSpec({
      taskId: "task-top-n",
      question: "Show the top 3 customers",
      answerContract: {
        output: { value: { columns: ["customer_id", "score"], rowMode: "top_n", rowCount: 3 }, authority: "request_wording", source: "question", quote: "top 3 customers" },
        ranking: { value: { n: 3, partitionBy: [], orderBy: "score DESC", tiePolicy: "strict" }, authority: "request_wording", source: "question", quote: "top 3" },
      },
    });
    const digest = compiler.compile({ sql: "SELECT customer_id, score FROM scores ORDER BY score DESC LIMIT 3", dialect: "sqlite" });
    const result = evaluateG1({ spec, digest, metadata: { columns: ["customer_id", "score"], columnTypes: ["INTEGER", "REAL"], rowCount: 3 } });
    expect(result).toMatchObject({ gate: "g1_shape", applicability: "checked", passed: true, blocking: false });
    expect(evaluateG1({ spec, digest, metadata: { columns: ["customer_id", "score"], rowCount: 2 } })).toMatchObject({ applicability: "checked", passed: false, blocking: true, violations: [expect.objectContaining({ code: "G1_TOP_N_ROW_COUNT_MISMATCH" })] });
  });

  it("accepts a per-partition window Top-N qualified without a top-level LIMIT", () => {
    const spec = createAnswerSpec({
      taskId: "task-window-top-n",
      question: "Show the top 3 scores per region",
      answerContract: {
        output: { value: { columns: ["region", "score", "rank", "global_rank"], rowMode: "top_n" }, authority: "request_wording", source: "question", quote: "top 3 scores per region" },
        ranking: { value: { n: 3, partitionBy: ["region"], orderBy: "score DESC", tiePolicy: "strict" }, authority: "request_wording", source: "question", quote: "top 3" },
      },
    });
    const digest = compiler.compile({ sql: "SELECT region, score, ROW_NUMBER() OVER (PARTITION BY region ORDER BY score DESC) AS rank, ROW_NUMBER() OVER (ORDER BY score DESC) AS global_rank FROM scores QUALIFY rank <= 3", dialect: "snowflake" });
    expect(evaluateG1({ spec, digest, metadata: { columns: ["region", "score", "rank", "global_rank"], rowCount: 7 } })).toMatchObject({ applicability: "checked", passed: true, blocking: false });
    const differentWindow = compiler.compile({ sql: "SELECT region, score, ROW_NUMBER() OVER (PARTITION BY region ORDER BY score DESC) AS rank, ROW_NUMBER() OVER (ORDER BY score DESC) AS global_rank FROM scores WHERE score <= 3 QUALIFY global_rank <= 3", dialect: "snowflake" });
    expect(evaluateG1({ spec, digest: differentWindow, metadata: { columns: ["region", "score", "rank", "global_rank"], rowCount: 7 } })).toMatchObject({ applicability: "checked", passed: false, blocking: true, violations: expect.arrayContaining([expect.objectContaining({ code: "G1_RANKING_LIMIT_MISMATCH" })]) });
  });

  it("requires scalar output to contain exactly one column", () => {
    const spec = createAnswerSpec({ taskId: "task-scalar-columns", question: "How many answers?", rowMode: "scalar", rowCount: 1 });
    const digest = compiler.compile({ sql: "SELECT answer, diagnostic FROM answers", dialect: "sqlite" });
    expect(evaluateG1({ spec, digest, metadata: { columns: ["answer", "diagnostic"], rowCount: 1 } })).toMatchObject({ applicability: "checked", passed: false, blocking: true, violations: [expect.objectContaining({ code: "G1_SCALAR_COLUMN_COUNT_MISMATCH" })] });
  });

  it("requires a Runtime-owned physical mapping for an authorized filter", () => {
    const spec = createAnswerSpec({
      taskId: "task-population-mapping",
      question: "Show paid orders",
      constraints: [{ statement: "Filter status = 'paid'", authority: "request_wording", scope: "filter", source: "question" }],
      physicalMappings: [{ mappingId: "map-1", hardConstraintId: "HC-1", physicalField: "status", physicalValue: "paid", authority: "observed_data", source: "controlled-observation", evidenceId: "obs-1" }],
    });
    const digest = createQueryDigestCompiler().compile({ sql: "SELECT id FROM orders WHERE status = 'paid'", dialect: "sqlite" });
    const result = evaluateG2({ spec, digest: { ...digest, parserEngine: "sqlglot" } });
    expect(result).toMatchObject({ applicability: "checked", passed: true, populationEffects: [expect.objectContaining({ status: "authorized" })] });
  });

  it("distinguishes supported G2 coverage, parser failure, and gate-external complex SQL", () => {
    const spec = createAnswerSpec({
      taskId: "task-g2-applicability",
      question: "Show paid orders",
      constraints: [{ statement: "Filter status = 'paid'", authority: "request_wording", scope: "filter", source: "question" }],
      physicalMappings: [{ mappingId: "map-paid", hardConstraintId: "HC-1", physicalField: "status", physicalValue: "paid", authority: "observed_data", source: "controlled-observation" }],
    });
    const supported = compiler.compile({ sql: "SELECT id FROM orders WHERE status = 'paid'", dialect: "sqlite" });
    const supportedG2 = evaluateGates({ spec, digest: { ...supported, parserEngine: "sqlglot" } }).find((gate) => gate.gate === "g2_population");
    expect(supportedG2).toMatchObject({ applicability: "checked", passed: true });

    const parserFailure = {
      ...supported,
      coverage: { ...supported.coverage, filters: "unsupported" as const },
      unsupportedNodes: ["strict_parser_error"],
      lineageCompleteness: "unsupported" as const,
    };
    const failedG2 = evaluateGates({ spec, digest: parserFailure }).find((gate) => gate.gate === "g2_population");
    expect(failedG2).toMatchObject({ applicability: "unsupported", passed: false });

    for (const sql of [
      "WITH paid AS (SELECT id FROM orders WHERE status = 'paid') SELECT id FROM paid",
      "SELECT id FROM (SELECT id FROM orders WHERE status = 'paid') paid",
      "SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rank FROM orders WHERE status = 'paid'",
      "SELECT id FROM orders WHERE status = 'paid' UNION SELECT id FROM archived_orders",
    ]) {
      const complex = compiler.compile({ sql, dialect: "sqlite" });
      const result = evaluateGates({ spec, digest: { ...complex, parserEngine: "sqlglot" } }).find((gate) => gate.gate === "g2_population");
      expect(result).toMatchObject({ applicability: "not_applicable", passed: true });
      expect(result).not.toMatchObject({ applicability: "checked" });
    }
  });

  it("lets trusted Physical Mapping bind business wording to a physical filter", () => {
    const spec = createAnswerSpec({
      taskId: "task-business-filter-mapping",
      question: "Consider only delivered orders",
      constraints: [{ statement: "Consider only delivered orders", authority: "request_wording", scope: "filter", source: "question" }],
      physicalMappings: [{ mappingId: "map-delivered", hardConstraintId: "HC-1", physicalField: "order_status", physicalValue: "delivered", authority: "observed_data", source: "controlled-observation" }],
    });
    const digest = compiler.compile({ sql: "SELECT order_id FROM orders WHERE order_status = 'delivered'", dialect: "sqlite" });
    expect(evaluateG2({ spec, digest: { ...digest, parserEngine: "sqlglot" } })).toMatchObject({
      applicability: "checked",
      passed: true,
      populationEffects: [expect.objectContaining({ status: "authorized" })],
    });
    const negative = compiler.compile({ sql: "SELECT order_id FROM orders WHERE order_status != 'delivered'", dialect: "sqlite" });
    expect(evaluateG2({ spec, digest: { ...negative, parserEngine: "sqlglot" } })).toMatchObject({ applicability: "checked", passed: false, blocking: true });
  });

  it("authorizes mapped conjunctions but abstains on unsupported OR semantics", () => {
    const spec = createAnswerSpec({
      taskId: "task-population-compound",
      question: "Show paid US orders",
      constraints: [
        { statement: "Filter status = 'paid'", authority: "request_wording", scope: "filter", source: "question" },
        { statement: "Filter region = 'US'", authority: "request_wording", scope: "filter", source: "question" },
      ],
      physicalMappings: [
        { mappingId: "map-status", hardConstraintId: "HC-1", physicalField: "status", physicalValue: "paid", authority: "observed_data", source: "controlled-observation" },
        { mappingId: "map-region", hardConstraintId: "HC-2", physicalField: "region", physicalValue: "US", authority: "observed_data", source: "controlled-observation" },
      ],
    });
    const andDigest = compiler.compile({ sql: "SELECT id FROM orders WHERE status = 'paid' AND region = 'US'", dialect: "sqlite" });
    expect(evaluateG2({ spec, digest: andDigest })).toMatchObject({ applicability: "checked", passed: true });
    const orDigest = compiler.compile({ sql: "SELECT id FROM orders WHERE status = 'paid' OR region = 'US'", dialect: "sqlite" });
    expect(evaluateG2({ spec, digest: orDigest })).toMatchObject({ applicability: "inconclusive", passed: false, requiresClarification: true });
  });

  it("does not let an output alias replace a required semantic lineage role", () => {
    const spec = createAnswerSpec({ taskId: "task-role", question: "Return the customer", answerContract: { output: { value: { columns: ["label"], schema: [{ semanticRole: "customer" }], rowMode: "scalar" }, authority: "request_wording", source: "question" } } });
    const digest = createQueryDigestCompiler().compile({ sql: "SELECT order_id AS label FROM orders", dialect: "sqlite" });
    const result = evaluateG1({ spec, digest: { ...digest, parserEngine: "sqlglot" }, metadata: { columns: ["label"], rowCount: 1 } });
    expect(result.violations).toEqual(expect.arrayContaining([expect.objectContaining({ code: "G1_OUTPUT_ROLE_LINEAGE_MISMATCH" })]));
  });

  it("reports an unresolved population effect without claiming it is authorized", () => {
    const spec = createAnswerSpec({ taskId: "task-population", question: "Show orders", constraints: [{ statement: "Filter status = 'paid'", authority: "request_wording", scope: "filter", source: "question" }] });
    const digest = compiler.compile({ sql: "SELECT id FROM orders WHERE promo_id <> 999", dialect: "sqlite" });
    const result = evaluateG2({ spec, digest, metadata: { columns: ["id"], rowCount: 1 } });
    expect(result.populationEffects).toEqual([expect.objectContaining({ status: "disputed", path: "filters[0]" })]);
    expect(result.violations).toEqual([expect.objectContaining({ code: "G2_UNAUTHORIZED_POPULATION_EFFECT" })]);
  });

  it("treats an INNER JOIN without a population contract as inconclusive", () => {
    const spec = createAnswerSpec({ taskId: "task-population-join", question: "Show orders" });
    const digest = compiler.compile({ sql: "SELECT o.id FROM orders o JOIN order_items i ON i.order_id = o.id", dialect: "sqlite" });
    expect(evaluateG2({ spec, digest, metadata: { columns: ["id"], rowCount: 1 } })).toMatchObject({ applicability: "inconclusive", passed: false, blocking: false, warnings: [expect.stringContaining("authoritative")] });
  });

  it("does not authorize a negative predicate from a positive contract", () => {
    const spec = createAnswerSpec({ taskId: "task-population-operator", question: "Return paid orders", constraints: [{ statement: "Filter status = 'paid'", authority: "request_wording", scope: "filter", source: "question" }] });
    const digest = compiler.compile({ sql: "SELECT id FROM orders WHERE status != 'paid'", dialect: "sqlite" });
    expect(evaluateG2({ spec, digest, metadata: { columns: ["id"], rowCount: 1 } })).toMatchObject({ applicability: "checked", blocking: true, violations: [expect.objectContaining({ code: "G2_UNAUTHORIZED_POPULATION_EFFECT" })] });
  });

  it("accepts composite ratio and difference measures when their aggregate terms are present", () => {
    const spec = createAnswerSpec({
      taskId: "task-composite-measure",
      question: "Return the ratio",
      answerContract: { measures: [{ value: { kind: "ratio" }, authority: "request_wording", source: "question", quote: "ratio" }] },
    });
    const digest = compiler.compile({ sql: "SELECT SUM(paid) * 1.0 / NULLIF(SUM(total), 0) AS ratio FROM orders", dialect: "sqlite" });
    expect(evaluateG1({ spec, digest, metadata: { columns: ["ratio"], rowCount: 1 } })).toMatchObject({ applicability: "checked", passed: true });
  });

  it("requires clarification instead of inventing Top-N tie semantics", () => {
    const spec = createAnswerSpec({
      taskId: "task-ties",
      question: "Show the top 3 customers including ties",
      answerContract: {
        output: { value: { columns: ["customer_id", "score"], rowMode: "top_n" }, authority: "request_wording", source: "question", quote: "top 3 customers including ties" },
        ranking: { value: { n: 3, partitionBy: [], orderBy: "score DESC", tiePolicy: "include_ties" }, authority: "request_wording", source: "question", quote: "including ties" },
      },
    });
    const digest = compiler.compile({ sql: "SELECT customer_id, score FROM scores ORDER BY score DESC LIMIT 3", dialect: "sqlite" });
    expect(evaluateG1({ spec, digest, metadata: { columns: ["customer_id", "score"], rowCount: 3 } })).toMatchObject({ applicability: "inconclusive", passed: false, requiresClarification: true });
  });

  it("does not grant authoritative gate coverage to tokenizer diagnostics", () => {
    const spec = createAnswerSpec({ taskId: "task-strict-digest", question: "Return one answer", rowMode: "scalar" });
    const digest = compiler.compile({ sql: "SELECT 1 AS answer", dialect: "sqlite" });
    expect(evaluateGates({ spec, digest, metadata: { columns: ["answer"], rowCount: 1 } })).toEqual(expect.arrayContaining([expect.objectContaining({ gate: "g1_shape", applicability: "unsupported", passed: false })]));
  });

  it("uses formal unique keys as cardinality evidence and reserves blocking for observed fanout", () => {
    const spec = createAnswerSpec({
      taskId: "task-cardinality",
      question: "Return order item totals",
      answerContract: {
        measures: [{ value: { kind: "sum", sourceRelation: "order_items" }, authority: "request_wording", source: "question", quote: "order item totals" }],
        joins: [{ value: { left: "orders", right: "order_items", keys: ["order_id"], leftKeys: ["id"], rightKeys: ["order_id"], expectedCardinality: "1:N" }, authority: "schema_structure", source: "schema", structural: true }],
      },
    });
    const digest = compiler.compile({ sql: "SELECT o.id, SUM(i.amount) AS total FROM orders o JOIN order_items i ON i.order_id = o.id GROUP BY o.id", dialect: "sqlite" });
    const schema = { connectionId: "connection", dialect: "sqlite" as const, tables: [
      { name: "orders", columns: ["id"], primaryKey: ["id"] },
      { name: "order_items", columns: ["order_id", "amount"] },
    ] };
    expect(evaluateG3({ spec, digest, schema, metadata: { columns: ["id", "total"], rowCount: 1 } })).toMatchObject({ applicability: "checked", passed: true, blocking: false });
    const preservedMeasureSpec = createAnswerSpec({
      taskId: "task-cardinality-preserved-measure",
      question: "Return order totals",
      answerContract: {
        measures: [{ value: { kind: "sum", sourceRelation: "orders" }, authority: "request_wording", source: "question", quote: "order totals" }],
        joins: [{ value: { left: "orders", right: "order_items", keys: ["order_id"], leftKeys: ["id"], rightKeys: ["order_id"], expectedCardinality: "1:N", preservedSide: "left" }, authority: "schema_structure", source: "schema", structural: true }],
      },
    });
    expect(evaluateG3({ spec: preservedMeasureSpec, digest, schema, metadata: { columns: ["id", "total"], rowCount: 1 } })).toMatchObject({ applicability: "checked", passed: false, blocking: true });
    const fanoutDigest = { ...digest, cardinalityEvidence: [{ left: "orders", right: "order_items", status: "fanout" as const, duplicatedSide: "right" as const, source: "observed_snapshot" as const, snapshotId: "snapshot-1" }] };
    expect(evaluateG3({ spec, digest: fanoutDigest, dataSnapshot: "snapshot-1", metadata: { columns: ["id", "total"], rowCount: 1 } })).toMatchObject({ applicability: "checked", passed: false, blocking: true });
    const reversedFanoutDigest = { ...digest, cardinalityEvidence: [{ left: "order_items", right: "orders", status: "fanout" as const, duplicatedSide: "left" as const, source: "observed_snapshot" as const, snapshotId: "snapshot-1" }] };
    expect(evaluateG3({ spec, digest: reversedFanoutDigest, dataSnapshot: "snapshot-1", metadata: { columns: ["id", "total"], rowCount: 1 } })).toMatchObject({ applicability: "checked", passed: false, blocking: true });
    const childMeasureDigest = { ...digest, cardinalityEvidence: [{ left: "orders", right: "order_items", status: "fanout" as const, source: "observed_snapshot" as const, snapshotId: "snapshot-1" }] };
    expect(evaluateG3({ spec, digest: childMeasureDigest, dataSnapshot: "snapshot-1", metadata: { columns: ["id", "total"], rowCount: 1 } })).toMatchObject({ applicability: "checked", passed: true, blocking: false });
    const unrelatedJoinDigest = {
      ...fanoutDigest,
      joins: [{ type: "LEFT", left: { name: "orders" }, source: { name: "customers" }, condition: "customers.id = orders.customer_id" }],
    };
    expect(evaluateG3({ spec, digest: unrelatedJoinDigest, dataSnapshot: "snapshot-1", metadata: { columns: ["id", "total"], rowCount: 1 } })).toMatchObject({ applicability: "unsupported", passed: false, blocking: false });
    const wrongKeyDigest = {
      ...fanoutDigest,
      joins: [{ type: "LEFT", left: { name: "orders", alias: "o" }, source: { name: "order_items", alias: "i" }, condition: "i.order_id = o.customer_id" }],
    };
    expect(evaluateG3({ spec, digest: wrongKeyDigest, dataSnapshot: "snapshot-1", metadata: { columns: ["id", "total"], rowCount: 1 } })).toMatchObject({ applicability: "unsupported", passed: false, blocking: false });
    expect(evaluateG3({ spec, digest: fanoutDigest, metadata: { columns: ["id", "total"], rowCount: 1 } })).toMatchObject({ applicability: "inconclusive", passed: false });
    const missingSource = createAnswerSpec({
      taskId: "task-cardinality-missing-source",
      question: "Return totals",
      answerContract: {
        measures: [{ value: { kind: "sum" }, authority: "request_wording", source: "question", quote: "totals" }],
        joins: [{ value: { left: "orders", right: "order_items", keys: ["order_id"], expectedCardinality: "1:N" }, authority: "schema_structure", source: "schema", structural: true }],
      },
    });
    expect(evaluateG3({ spec: missingSource, digest, schema, metadata: { columns: ["id", "total"], rowCount: 1 } })).toMatchObject({ applicability: "inconclusive", passed: false, blocking: false });
  });

  it("requires a material candidate change after a failed semantic fingerprint", () => {
    const digest = compiler.compile({ sql: "SELECT id FROM customers", dialect: "sqlite" });
    expect(evaluateG4({ spec: createAnswerSpec({ taskId: "task-g4", question: "Show customers" }), digest, candidateFingerprint: "fingerprint", candidatePreviouslyFailed: true })).toMatchObject({ gate: "g4_candidate", applicability: "checked", passed: false, blocking: true, violations: [expect.objectContaining({ code: "G4_CANDIDATE_REPAIR_REQUIRED" })] });
    expect(evaluateG4({ spec: createAnswerSpec({ taskId: "task-g4", question: "Show customers" }), digest, candidateFingerprint: "new", candidatePreviouslyFailed: false })).toMatchObject({ gate: "g4_candidate", passed: true });
  });

  it("does not treat a presentation alias as a semantic repair", () => {
    const first = compiler.compile({ sql: "SELECT id AS customer_id FROM customers WHERE active = 1", dialect: "sqlite" });
    const renamed = compiler.compile({ sql: "SELECT id AS renamed FROM customers WHERE active = 1", dialect: "sqlite" });
    expect(candidateSemanticFingerprint(first)).toBe(candidateSemanticFingerprint(renamed));
    const qualifiedAlias = compiler.compile({ sql: "SELECT o.id FROM orders o JOIN order_items i ON i.order_id = o.id", dialect: "sqlite" });
    const qualifiedName = compiler.compile({ sql: "SELECT orders.id FROM orders JOIN order_items ON order_items.order_id = orders.id", dialect: "sqlite" });
    expect(candidateSemanticFingerprint(qualifiedAlias)).toBe(candidateSemanticFingerprint(qualifiedName));
  });
});
