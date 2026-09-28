import assert from "node:assert/strict";
import test from "node:test";
import { createLabelDraft, measureSpecQuality, looksLikeExplicitSqlPredicate, validateSpecQualityLabel } from "./spec-quality.mjs";

test("按任一 Gold 形状变体比较最终行数，并区分缺失预测与不一致", () => {
  const result = measureSpecQuality({
    cases: [
      { instance_id: "local001", question: "List the top two customers" },
      { instance_id: "local002", question: "What is the total?" },
      { instance_id: "local003", question: "How many customers are in each group?" },
    ],
    goldShapes: new Map([
      ["local001", [{ file: "local001_a.csv", rowCount: 3, columnCount: 2, columns: ["id", "value"] }, { file: "local001_b.csv", rowCount: 2, columnCount: 3, columns: ["id", "value", "rank"] }]],
      ["local002", [{ file: "local002.csv", rowCount: 4, columnCount: 1, columns: ["total"] }]],
      ["local003", [{ file: "local003.csv", rowCount: 2, columnCount: 2, columns: ["group", "count"] }]],
    ]),
    extractors: {
      answerShape: (question) => question.includes("top") ? { rowMode: "top_n", rowCount: 2 } : question.includes("total") ? { rowMode: "scalar", rowCount: 1 } : {},
      filterConstraints: () => [],
    },
  });

  assert.deepEqual(result.aggregate.answerShape.rowMode, { nonEmpty: 2, total: 3, rate: 2 / 3 });
  assert.deepEqual(result.aggregate.answerShape.rowCount, { nonEmpty: 2, total: 3, rate: 2 / 3 });
  assert.deepEqual(result.aggregate.answerShape.rowCardinality, {
    predicted: 2,
    compatible: 1,
    missing: 1,
    mismatched: 1,
    fixedDenominatorRate: 1 / 3,
    conditionalAgreementRate: 1 / 2,
    agreementDefinition: "prediction.rowCount matches the rowCount of any accepted Gold CSV variant",
  });
  assert.equal(result.cases.find((item) => item.instanceId === "local001").answerShape.rowCardinality.status, "match");
  assert.equal(result.cases.find((item) => item.instanceId === "local002").answerShape.rowCardinality.status, "mismatch");
  assert.equal(result.cases.find((item) => item.instanceId === "local003").answerShape.rowCardinality.status, "missing_prediction");
});

test("把当前提取器的普通英文短语与显式 SQL 谓词分开", () => {
  assert.equal(looksLikeExplicitSqlPredicate("fatalities in collisions"), false);
  assert.equal(looksLikeExplicitSqlPredicate("promo_total_id = 1"), true);
  assert.equal(looksLikeExplicitSqlPredicate("id in (1, 2, 12, 13)"), true);
  assert.equal(looksLikeExplicitSqlPredicate("would like to"), false);
});

test("生成带 Gold 结构预填、但明确要求人工复核的标签草稿", () => {
  const draft = createLabelDraft([
    { instance_id: "local001", db: "demo", question: "List the result" },
  ], new Map([
    ["local001", [{ file: "local001.csv", rowCount: 2, columnCount: 3, columns: ["group", "count", "rate"] }]],
  ]))[0];

  assert.equal(draft.instanceId, "local001");
  assert.equal(draft.annotationStatus, "pending_manual");
  assert.equal(draft.facets.output.status, "prefilled_structural");
  assert.deepEqual(draft.facets.output.alternatives, [{
    rowMode: "unknown",
    rowCount: 2,
    columnCount: 3,
    columnNames: ["group", "count", "rate"],
    evidenceRefs: ["GOLD-1"],
  }]);
  assert.equal(draft.facets.measure.status, "pending_manual");
  assert.deepEqual(validateSpecQualityLabel(draft), draft);
});

test("拒绝缺少人工复核状态或结构化槽位的标签", () => {
  assert.throws(() => validateSpecQualityLabel({ instanceId: "local001" }), /SPEC_LABEL_/);
});

test("使用 reviewed 标签计算槽位级指标，并区分列合同缺失", () => {
  const label = createLabelDraft([
    { instance_id: "local001", db: "demo", question: "Return paid orders" },
  ], new Map([
    ["local001", [{ file: "local001.csv", rowCount: 1, columnCount: 1, columns: ["answer"] }]],
  ]))[0];
  label.annotationStatus = "reviewed";
  label.review.annotators = ["annotator-1"];
  label.facets.output.status = "reviewed";
  label.facets.measure = {
    status: "reviewed",
    alternatives: [{ kind: "sum" }],
    evidenceRefs: ["GOLD-1"],
  };
  label.facets.filters = {
    status: "reviewed",
    alternatives: [{ statement: "status = 'paid'", evidenceRefs: ["GOLD-1"] }],
    required: [{ statement: "status = 'paid'", evidenceRefs: ["GOLD-1"] }],
    forbidden: [],
    evidenceRefs: ["GOLD-1"],
  };
  assert.deepEqual(validateSpecQualityLabel(label), label);
  const result = measureSpecQuality({
    cases: [{ instance_id: "local001", db: "demo", question: "Return paid orders" }],
    goldShapes: new Map([
      ["local001", [{ file: "local001.csv", rowCount: 1, columnCount: 1, columns: ["answer"] }]],
    ]),
    labels: [label],
    extractors: {
      answerShape: () => ({ rowMode: "scalar", rowCount: 1 }),
      filterConstraints: () => [{ statement: "status = 'paid'" }],
      answerSpec: () => ({ facets: { measure: { alternatives: [{ kind: "sum" }] } } }),
    },
  });
  assert.deepEqual(result.aggregate.slots.facets.output, {
    labelCases: 1, expected: 1, predicted: 1, matched: 1,
    coverage: 1, precision: 1, recall: 1, mismatchRate: 0, overConstraintRate: null, hardBindingError: null,
    details: [{ instanceId: "local001", expected: 1, predicted: 1, matched: 1, falsePositives: 0, hardBindingErrors: 0 }],
  });
  assert.equal(result.aggregate.slots.facets.measure.recall, 1);
  assert.equal(result.aggregate.slots.facets.filters.precision, 1);
  assert.equal(result.aggregate.slots.outputColumns.predicted, 0);
  assert.equal(result.aggregate.slots.outputColumns.recall, 0);
});

test("错配率与过度约束率、Hard-binding error 按方向分别计算", () => {
  const label = createLabelDraft([
    { instance_id: "local001", db: "demo", question: "Return paid orders" },
  ], new Map([
    ["local001", [{ file: "local001.csv", rowCount: 1, columnCount: 1, columns: ["answer"] }]],
  ]))[0];
  label.annotationStatus = "reviewed";
  label.review.annotators = ["annotator-1"];
  label.facets.output.status = "reviewed";
  label.facets.filters = {
    status: "reviewed",
    alternatives: [],
    required: [],
    forbidden: [{ statement: "status = 'canceled'", evidenceRefs: ["GOLD-1"] }],
    evidenceRefs: ["GOLD-1"],
  };
  const result = measureSpecQuality({
    cases: [{ instance_id: "local001", db: "demo", question: "Return paid orders" }],
    goldShapes: new Map([
      ["local001", [{ file: "local001.csv", rowCount: 1, columnCount: 1, columns: ["answer"] }]],
    ]),
    labels: [label],
    extractors: {
      answerShape: () => ({ rowMode: "grouped", rowCount: 2 }),
      filterConstraints: () => [{ statement: "status = 'canceled'" }],
    },
  });
  assert.equal(result.aggregate.slots.facets.output.mismatchRate, 1);
  assert.equal(result.aggregate.slots.facets.output.overConstraintRate, null);
  assert.equal(result.aggregate.slots.facets.filters.overConstraintRate, 1);
  assert.equal(result.aggregate.slots.facets.filters.hardBindingError, 1);
});

test("报告过滤槽位的非空率与机械语法误提取率，而不冒充语义精确率", () => {
  const result = measureSpecQuality({
    cases: [
      { instance_id: "local001", question: "Return promo_id=999" },
      { instance_id: "local002", question: "Return fatalities in collisions" },
    ],
    goldShapes: new Map([
      ["local001", [{ file: "local001.csv", rowCount: 1, columnCount: 1, columns: ["answer"] }]],
      ["local002", [{ file: "local002.csv", rowCount: 1, columnCount: 1, columns: ["answer"] }]],
    ]),
    extractors: {
      answerShape: () => ({}),
      filterConstraints: (question) => question.includes("promo")
        ? [{ statement: "promo_id=999" }]
        : [{ statement: "fatalities in collisions" }],
    },
  });

  assert.deepEqual(result.aggregate.filters, {
    casesWithNonEmpty: 2,
    caseNonEmptyRate: 1,
    totalConstraints: 2,
    strictSyntaxPass: 1,
    obviousFalsePositive: 1,
    strictSyntaxPassRate: 0.5,
    casesWithStrictSyntaxPass: 1,
    casesWithObviousFalsePositive: 1,
    semanticPrecision: null,
    semanticRecall: null,
    semanticMetricsNote: "尚未建立人工语义标签；这里仅统计明显 SQL 语法形状，不能替代语义 Precision/Recall。",
    obviousFalsePositiveExamples: [{ instanceId: "local002", statement: "fatalities in collisions" }],
    strictSyntaxExamples: [{ instanceId: "local001", statement: "promo_id=999" }],
  });
});
