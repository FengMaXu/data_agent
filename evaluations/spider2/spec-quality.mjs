#!/usr/bin/env node
import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadCases, parseCsvRows, selectCases } from "./lib.mjs";

const GOLD_CSV_NAME = /^(local\d+)(?:_([a-z]))?\.csv$/i;
const IDENTIFIER = String.raw`[A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*)?`;
const SQL_VALUE = String.raw`(?:\([^)]*\)|'[^']*'|"[^"]*"|[-+]?[0-9]+(?:\.[0-9]+)?|[A-Za-z_][A-Za-z0-9_$.-]*)`;

// This is intentionally stricter than the production extractor. It is only an
// offline diagnostic for the known false-positive class where the English
// preposition "in" was mistaken for SQL IN. It is not semantic precision.
const EXPLICIT_SQL_PREDICATE = new RegExp(String.raw`^\s*${IDENTIFIER}\s*(?:NOT\s+IN\s*\([^)]*\)|NOT\s+LIKE\s+(?:'[^']*'|"[^"]*"|%[^\s]+)|(?:<>|!=|>=|<=|=|>|<)\s*${SQL_VALUE}|IN\s*\([^)]*\)|LIKE\s+(?:'[^']*'|"[^"]*"|%[^\s]+)|IS(?:\s+NOT)?\s+NULL)\s*$`, "i");

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function sha256Tree(rootPath) {
  const files = [];
  async function visit(currentPath, relativePath) {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const childPath = path.join(currentPath, entry.name);
      const childRelativePath = path.join(relativePath, entry.name).replaceAll("\\", "/");
      if (entry.isDirectory()) await visit(childPath, childRelativePath);
      else if (entry.isFile()) files.push({ path: childRelativePath, content: await readFile(childPath) });
    }
  }
  await visit(rootPath, "");
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.path, "utf8");
    hash.update("\0", "utf8");
    hash.update(file.content);
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

function percentage(numerator, denominator) {
  const value = ratio(numerator, denominator);
  return value === null ? null : Number((value * 100).toFixed(2));
}

function countMetric(nonEmpty, total) {
  return { nonEmpty, total, rate: ratio(nonEmpty, total) };
}

function shapeFromGoldCsv(file, text) {
  const rows = parseCsvRows(text);
  const columns = rows[0] ?? [];
  return {
    file,
    rowCount: Math.max(0, rows.length - (rows.length > 0 ? 1 : 0)),
    columnCount: columns.length,
    columns,
  };
}

/**
 * Build the accepted Gold output-shape index. A case may have multiple Gold
 * CSVs; a prediction is compatible with any accepted variant.
 */
export async function loadGoldShapeIndex(goldDir, caseIds = undefined) {
  const wanted = caseIds ? new Set(caseIds.map((id) => String(id).toLowerCase())) : undefined;
  const entries = await readdir(goldDir, { withFileTypes: true });
  const index = new Map();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = GOLD_CSV_NAME.exec(entry.name);
    if (!match) continue;
    const instanceId = match[1].toLowerCase();
    if (wanted && !wanted.has(instanceId)) continue;
    const filePath = path.join(goldDir, entry.name);
    const shape = shapeFromGoldCsv(entry.name, await readFile(filePath, "utf8"));
    const shapes = index.get(instanceId) ?? [];
    shapes.push(shape);
    index.set(instanceId, shapes);
  }
  for (const shapes of index.values()) shapes.sort((a, b) => a.file.localeCompare(b.file));
  return index;
}

const LABEL_FACETS = ["output", "grain", "measure", "denominator", "ranking", "time", "unit", "rounding", "joins", "filters", "ambiguity"];
const SEVEN_FACETS = ["entity", "metric", "filters", "groupBy", "time", "ranking", "output"];
const LABEL_STATUSES = new Set(["pending_manual", "prefilled_structural", "draft", "reviewed", "adjudicated"]);
const FINAL_LABEL_STATUSES = new Set(["reviewed", "adjudicated"]);

/**
 * Create an annotation draft. Only structural facts read from Gold CSV are
 * prefilled; all semantic facets remain explicitly pending human review.
 */
export function createLabelDraft(cases, goldShapes) {
  if (!Array.isArray(cases)) throw new Error("SPEC_LABEL_CASES_REQUIRED");
  if (!(goldShapes instanceof Map)) throw new Error("SPEC_LABEL_GOLD_SHAPES_REQUIRED");
  return cases.map((item) => {
    const instanceId = String(item.instance_id);
    const shapes = goldShapes.get(instanceId.toLowerCase()) ?? [];
    const evidenceRefs = shapes.map((_shape, index) => `GOLD-${index + 1}`);
    return {
      schemaVersion: 1,
      labelVersion: 1,
      instanceId,
      database: item.db,
      question: String(item.question ?? ""),
      questionSha256: sha256Text(String(item.question ?? "")),
      annotationStatus: "pending_manual",
      evidence: shapes.map((shape, index) => ({
        id: evidenceRefs[index],
        source: "gold_shape",
        path: shape.file,
        note: "offline shape check only",
      })),
      facets: {
        output: {
          status: shapes.length ? "prefilled_structural" : "pending_manual",
          alternatives: shapes.map((shape, index) => ({
            rowMode: "unknown",
            rowCount: shape.rowCount,
            columnCount: shape.columnCount,
            columnNames: [...shape.columns],
            evidenceRefs: [evidenceRefs[index]],
          })),
          evidenceRefs,
          note: "rowMode、列语义和最终输出意图必须由人工根据题面复核；Gold CSV 只预填结构事实。",
        },
        ...Object.fromEntries(LABEL_FACETS.filter((facet) => facet !== "output").map((facet) => [facet, {
          status: "pending_manual",
          alternatives: [],
          evidenceRefs: [],
          ...(facet === "filters" ? { required: [], forbidden: [] } : {}),
        }])),
      },
      review: {
        annotators: [],
        adjudicator: null,
        notes: [],
      },
    };
  });
}

/** Validate the stable annotation-file seam before labels enter a scorer. */
export function validateSpecQualityLabel(label) {
  if (!label || typeof label !== "object" || Array.isArray(label)) throw new Error("SPEC_LABEL_OBJECT_REQUIRED");
  if (label.schemaVersion !== 1) throw new Error("SPEC_LABEL_SCHEMA_VERSION_INVALID");
  if (!Number.isInteger(label.labelVersion) || label.labelVersion < 1) throw new Error("SPEC_LABEL_VERSION_INVALID");
  if (typeof label.instanceId !== "string" || !label.instanceId.trim()) throw new Error("SPEC_LABEL_INSTANCE_ID_REQUIRED");
  if (typeof label.question !== "string" || !label.question.trim()) throw new Error("SPEC_LABEL_QUESTION_REQUIRED");
  if (typeof label.questionSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(label.questionSha256)) throw new Error("SPEC_LABEL_QUESTION_HASH_REQUIRED");
  if (sha256Text(label.question).toLowerCase() !== label.questionSha256.toLowerCase()) throw new Error("SPEC_LABEL_QUESTION_HASH_MISMATCH");
  if (!LABEL_STATUSES.has(label.annotationStatus)) throw new Error("SPEC_LABEL_STATUS_INVALID");
  if (!Array.isArray(label.evidence)) throw new Error("SPEC_LABEL_EVIDENCE_REQUIRED");
  const evidenceIds = new Set();
  for (const evidence of label.evidence) {
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence) || typeof evidence.id !== "string" || !evidence.id.trim()) throw new Error("SPEC_LABEL_EVIDENCE_INVALID");
    if (!new Set(["question", "task_document", "schema", "gold_shape", "gold_sql", "annotator_inference"]).has(evidence.source)) throw new Error("SPEC_LABEL_EVIDENCE_SOURCE_INVALID");
    if (evidenceIds.has(evidence.id)) throw new Error(`SPEC_LABEL_EVIDENCE_DUPLICATE:${evidence.id}`);
    evidenceIds.add(evidence.id);
  }
  if (!label.facets || typeof label.facets !== "object" || Array.isArray(label.facets)) throw new Error("SPEC_LABEL_FACETS_REQUIRED");
  for (const facet of LABEL_FACETS) {
    const value = label.facets[facet];
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`SPEC_LABEL_FACET_REQUIRED:${facet}`);
    if (!LABEL_STATUSES.has(value.status)) throw new Error(`SPEC_LABEL_FACET_STATUS_INVALID:${facet}`);
    if (!Array.isArray(value.alternatives)) throw new Error(`SPEC_LABEL_FACET_ALTERNATIVES_REQUIRED:${facet}`);
    if (value.evidenceRefs !== undefined && (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.some((item) => typeof item !== "string" || !item.trim()))) {
      throw new Error(`SPEC_LABEL_FACET_EVIDENCE_INVALID:${facet}`);
    }
    if (facet === "filters" && (!Array.isArray(value.required) || !Array.isArray(value.forbidden))) {
      throw new Error("SPEC_LABEL_FILTER_BINDINGS_REQUIRED");
    }
  }
  if (!label.review || typeof label.review !== "object" || Array.isArray(label.review)) throw new Error("SPEC_LABEL_REVIEW_REQUIRED");
  if (!Array.isArray(label.review.annotators) || label.review.annotators.some((item) => typeof item !== "string")) throw new Error("SPEC_LABEL_REVIEW_ANNOTATORS_INVALID");
  if (label.review.adjudicator !== null && typeof label.review.adjudicator !== "string") throw new Error("SPEC_LABEL_REVIEW_ADJUDICATOR_INVALID");
  if (!Array.isArray(label.review.notes) || label.review.notes.some((item) => typeof item !== "string")) throw new Error("SPEC_LABEL_REVIEW_NOTES_INVALID");
  if (label.annotationStatus === "reviewed" && label.review.annotators.length < 1) throw new Error("SPEC_LABEL_REVIEW_ANNOTATOR_REQUIRED");
  if (label.annotationStatus === "adjudicated" && (!label.review.adjudicator || label.review.annotators.length < 2)) throw new Error("SPEC_LABEL_ADJUDICATION_REVIEW_REQUIRED");
  for (const facet of LABEL_FACETS) {
    const refs = label.facets[facet].evidenceRefs ?? [];
    if (refs.some((ref) => !evidenceIds.has(ref))) throw new Error(`SPEC_LABEL_EVIDENCE_REF_UNKNOWN:${facet}`);
  }
  const outputAlternatives = label.facets.output.alternatives;
  for (const alternative of outputAlternatives) {
    if (!alternative || typeof alternative !== "object" || Array.isArray(alternative)) throw new Error("SPEC_LABEL_OUTPUT_ALTERNATIVE_INVALID");
    if (alternative.rowMode !== "unknown" && !["scalar", "top_n", "grouped", "full", "detail"].includes(alternative.rowMode)) throw new Error("SPEC_LABEL_OUTPUT_ROW_MODE_INVALID");
    for (const key of ["rowCount", "columnCount"]) if (!Number.isInteger(alternative[key]) || alternative[key] < 0) throw new Error(`SPEC_LABEL_OUTPUT_${key.toUpperCase()}_INVALID`);
    if (!Array.isArray(alternative.columnNames) || alternative.columnNames.some((item) => typeof item !== "string")) throw new Error("SPEC_LABEL_OUTPUT_COLUMNS_INVALID");
  }
  return label;
}

/** Load and validate one JSONL annotation file, rejecting duplicate cases. */
export async function loadSpecQualityLabels(filePath, options = {}) {
  const lines = (await readFile(filePath, "utf8")).split(/\r?\n/).filter((line) => line.trim());
  const labels = lines.map((line, index) => {
    let value;
    try { value = JSON.parse(line); } catch (error) { throw new Error(`SPEC_LABEL_JSON_INVALID:${index + 1}:${error instanceof Error ? error.message : String(error)}`); }
    try { return validateSpecQualityLabel(value); } catch (error) { throw new Error(`SPEC_LABEL_INVALID:${index + 1}:${error instanceof Error ? error.message : String(error)}`); }
  });
  const ids = new Set();
  for (const label of labels) {
    const id = label.instanceId.toLowerCase();
    if (ids.has(id)) throw new Error(`SPEC_LABEL_DUPLICATE:${label.instanceId}`);
    ids.add(id);
  }
  if (options.expectedIds) {
    const expected = new Set(options.expectedIds.map((id) => String(id).toLowerCase()));
    const missing = [...expected].filter((id) => !ids.has(id));
    const extra = [...ids].filter((id) => !expected.has(id));
    if (missing.length || extra.length) throw new Error(`SPEC_LABEL_COVERAGE_MISMATCH:missing=${missing.join(",")}:extra=${extra.join(",")}`);
  }
  if (options.expectedQuestions instanceof Map) {
    for (const label of labels) {
      const expectedQuestion = options.expectedQuestions.get(label.instanceId.toLowerCase());
      if (expectedQuestion !== undefined && sha256Text(String(expectedQuestion)) !== label.questionSha256) {
        throw new Error(`SPEC_LABEL_AUTHORITATIVE_QUESTION_MISMATCH:${label.instanceId}`);
      }
    }
  }
  return labels;
}

/** Offline diagnostic predicate; do not use this as runtime authorization. */
export function looksLikeExplicitSqlPredicate(statement) {
  return typeof statement === "string" && EXPLICIT_SQL_PREDICATE.test(statement);
}

const NON_SEMANTIC_LABEL_KEYS = new Set([
  "status", "evidenceRefs", "evidence", "questionSpan", "physicalMappingRequired",
  "note", "reason", "confidence", "source", "path", "quote",
]);

function canonicalConstraint(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[“”‘’]/g, "'")
    .replace(/[\"']/g, "")
    .replace(/\s+/g, "")
    .replace(/\b(isnot)\b/g, "isnot")
    .replace(/\b(?:is|equals|equal\s+to)\b/g, "=")
    .replace(/\b(and|or)\b/g, "$1")
    .replace(/[?。，、；;]+$/g, "");
}

function constraintForms(value) {
  if (!value || typeof value !== "object") return [];
  return [value.statement, value.questionSpan, value.semanticPredicate, ...(Array.isArray(value.surfaceForms) ? value.surfaceForms : [])]
    .filter((item) => typeof item === "string" && item.trim())
    .map(canonicalConstraint);
}

function constraintsMatch(prediction, expected) {
  const predictedForms = constraintForms(prediction);
  const expectedForms = constraintForms(expected);
  if (!predictedForms.length || !expectedForms.length) return false;
  if (predictedForms.some((form) => expectedForms.includes(form))) return true;
  const expectedFieldValue = expectedForms.find((form) => /(?:=|!=|<>|>=|<=|>|<|in\(|like)/.test(form));
  const predictedFieldValue = predictedForms.find((form) => /(?:=|!=|<>|>=|<=|>|<|in\(|like)/.test(form));
  return Boolean(expectedFieldValue && predictedFieldValue && expectedFieldValue === predictedFieldValue);
}

function stripLabelMetadata(value) {
  if (Array.isArray(value)) return value.map(stripLabelMetadata);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !NON_SEMANTIC_LABEL_KEYS.has(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, stripLabelMetadata(item)]));
}

function genericAlternativeMatch(prediction, expected) {
  const actual = stripLabelMetadata(prediction);
  const target = stripLabelMetadata(expected);
  if (!actual || !target || typeof actual !== "object" || typeof target !== "object") return actual === target;
  const keys = Object.keys(target).filter((key) => key !== "alternatives");
  if (!keys.length) return false;
  return keys.every((key) => JSON.stringify(actual[key]) === JSON.stringify(target[key]));
}

function outputAlternativeMatch(prediction, expected) {
  if (!prediction || !expected) return false;
  if (expected.rowMode !== "unknown" && prediction.rowMode !== expected.rowMode) return false;
  if (prediction.rowCount !== expected.rowCount) return false;
  return true;
}

function labelFacetApplicable(labelFacet, facet) {
  if (!labelFacet || !FINAL_LABEL_STATUSES.has(labelFacet.status)) return false;
  if (facet === "filters") return Array.isArray(labelFacet.required) && Array.isArray(labelFacet.forbidden);
  if (facet === "ambiguity") return true;
  return Array.isArray(labelFacet.alternatives);
}

function expectedAlternatives(labelFacet, facet) {
  if (facet === "filters") return [
    ...(labelFacet.required ?? []).map((item) => ({ ...item, __binding: "required" })),
    ...(labelFacet.forbidden ?? []).map((item) => ({ ...item, __binding: "forbidden" })),
  ];
  if (facet === "ambiguity") return labelFacet.alternatives ?? [];
  const alternatives = labelFacet.alternatives ?? [];
  if (facet === "output") {
    const semanticAlternatives = alternatives.filter((item) => item.binding !== "structural");
    return semanticAlternatives.length ? semanticAlternatives : alternatives;
  }
  return alternatives;
}

function predictedFacet(caseResult, facet) {
  if (facet === "output") {
    const prediction = caseResult.answerShape.prediction;
    return prediction && (prediction.rowMode !== undefined || prediction.rowCount !== undefined)
      ? [prediction]
      : [];
  }
  if (facet === "filters") return caseResult.filters.constraints.map((item) => ({
    statement: typeof item?.statement === "string" ? item.statement : String(item?.statement ?? ""),
    binding: item?.binding ?? item?.authority ?? "candidate",
  }));
  const answerSpec = caseResult.answerSpecPrediction;
  const rawFacets = answerSpec?.facets;
  const seven = rawFacets && ["entity", "metric", "filters", "groupBy", "time", "ranking", "output"].some((key) => key in rawFacets)
    ? rawFacets
    : answerSpec && ["entity", "metric", "filters", "groupBy", "time", "ranking", "output"].some((key) => key in answerSpec) ? answerSpec : undefined;
  if (seven) {
    if (facet === "grain" && (seven.entity || seven.groupBy?.length)) return [{ ...(seven.entity ? { entity: seven.entity } : {}), keys: [...(seven.groupBy ?? [])] }];
    if (facet === "measure" && seven.metric) return [{ kind: seven.metric }];
    if (facet === "ranking" && seven.ranking) return [{ selection: seven.ranking }];
    if (facet === "time" && seven.time) return [{ window: seven.time }];
    if (facet === "filters" && seven.filters?.length) return seven.filters.map((statement) => ({ statement }));
    return [];
  }
  const value = answerSpec?.answerContract?.[facet] ?? rawFacets?.[facet] ?? answerSpec?.[facet];
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.alternatives)) return value.alternatives;
  return [value];
}

function facetAlternativeMatches(facet, prediction, expected) {
  if (facet === "filters") return constraintsMatch(prediction, expected);
  if (facet === "output") return outputAlternativeMatch(prediction, expected);
  return genericAlternativeMatch(prediction, expected);
}

function sevenFacetAlternatives(label, facet) {
  const facets = label.facets;
  if (facet === "output") return expectedAlternatives(facets.output, "output");
  if (facet === "filters") return expectedAlternatives(facets.filters, "filters").filter((item) => item.__binding !== "forbidden");
  if (facet === "entity") return (facets.grain.alternatives ?? [])
    .map((item) => item.entity ?? item.finalGrain ?? item.entityPopulation)
    .filter((item) => typeof item === "string" && item.trim())
    .map((entity) => ({ entity }));
  if (facet === "metric") return (facets.measure.alternatives ?? []).map((item) => ({ ...item }));
  if (facet === "groupBy") return (facets.grain.alternatives ?? [])
    .filter((item) => Array.isArray(item.keys))
    .map((item) => ({ keys: [...item.keys] }));
  if (facet === "time") return facets.time.alternatives ?? [];
  if (facet === "ranking") return facets.ranking.alternatives ?? [];
  return [];
}

function sevenFacetPrediction(caseResult, facet) {
  const answerSpec = caseResult.answerSpecPrediction ?? {};
  const seven = answerSpec.facets ?? answerSpec;
  if (facet === "output") {
    const prediction = caseResult.answerShape.prediction;
    return prediction && (prediction.rowMode !== undefined || prediction.rowCount !== undefined) ? [prediction] : [];
  }
  if (facet === "filters") return caseResult.filters.constraints.map((item) => ({ statement: typeof item?.statement === "string" ? item.statement : String(item?.statement ?? "") }));
  if (facet === "entity") return typeof seven.entity === "string" && seven.entity.trim() ? [seven.entity.trim()] : [];
  if (facet === "metric") return typeof seven.metric === "string" && seven.metric.trim() ? [{ kind: seven.metric.trim() }] : [];
  if (facet === "groupBy") return Array.isArray(seven.groupBy) && seven.groupBy.length ? [{ keys: seven.groupBy }] : [];
  if (facet === "time") return typeof seven.time === "string" && seven.time.trim() ? [{ window: seven.time.trim() }] : [];
  if (facet === "ranking") return typeof seven.ranking === "string" && seven.ranking.trim() ? [{ selection: seven.ranking.trim() }] : [];
  return [];
}

const METRIC_ALIASES = { average: "avg", mean: "avg", total: "sum", minimum: "min", maximum: "max", distinct_count: "count_distinct", countdistinct: "count_distinct" };
function normalizedMetric(value) {
  const token = String(value ?? "").toLowerCase().replace(/[\s_-]+/g, "_");
  return METRIC_ALIASES[token] ?? token;
}
function normalizedText(value) { return String(value ?? "").toLowerCase().replace(/[\s_-]+/g, ""); }

function sevenFacetAlternativeMatch(facet, prediction, expected) {
  if (facet === "output") return outputAlternativeMatch(prediction, expected);
  if (facet === "filters") return constraintsMatch(prediction, expected);
  if (facet === "entity") return normalizedText(prediction) === normalizedText(expected.entity);
  if (facet === "metric") {
    const predictedKind = normalizedMetric(prediction?.kind ?? prediction);
    const expectedKind = normalizedMetric(expected?.kind);
    return predictedKind === expectedKind || Boolean(expected?.expression && normalizedText(expected.expression).includes(predictedKind));
  }
  if (facet === "groupBy") return Array.isArray(prediction?.keys) && Array.isArray(expected?.keys)
    && prediction.keys.length === expected.keys.length
    && prediction.keys.every((item, index) => normalizedText(item) === normalizedText(expected.keys[index]));
  if (facet === "time") {
    const predicted = normalizedText(prediction?.window ?? prediction);
    return predicted.length > 0 && Object.values(expected ?? {}).some((value) => normalizedText(value).includes(predicted) || predicted.includes(normalizedText(value)));
  }
  if (facet === "ranking") {
    const predicted = normalizedText(prediction?.selection ?? prediction);
    return predicted.length > 0 && Object.values(expected ?? {}).some((value) => normalizedText(value).includes(predicted) || predicted.includes(normalizedText(value)));
  }
  return false;
}

function sevenFacetQualityAggregate(caseResults, labels, statuses = FINAL_LABEL_STATUSES) {
  const scored = scoredLabelStatuses(labels, statuses);
  const result = {};
  for (const facet of SEVEN_FACETS) {
    const cases = facet === "filters" ? scored : scored.filter((label) => sevenFacetAlternatives(label, facet).length > 0);
    let predictedCount = 0;
    let matchedCount = 0;
    let expectedCount = 0;
    let falsePositiveCount = 0;
    let forbiddenExpectedCount = 0;
    let hardBindingErrors = 0;
    const details = [];
    for (const label of cases) {
      const caseResult = caseResults.find((item) => item.instanceId.toLowerCase() === label.instanceId.toLowerCase());
      if (!caseResult) continue;
      const expected = sevenFacetAlternatives(label, facet);
      const predicted = sevenFacetPrediction(caseResult, facet);
      const positiveExpected = expected;
      const forbiddenExpected = facet === "filters" ? (label.facets.filters.forbidden ?? []) : [];
      forbiddenExpectedCount += forbiddenExpected.length;
      const matchedExpected = positiveExpected.filter((target) => predicted.some((item) => sevenFacetAlternativeMatch(facet, item, target)));
      const unmatchedPredicted = predicted.filter((item) => !positiveExpected.some((target) => sevenFacetAlternativeMatch(facet, item, target)));
      const forbiddenMatches = predicted.filter((item) => forbiddenExpected.some((target) => sevenFacetAlternativeMatch(facet, item, target)));
      const isConstraintFacet = facet === "filters";
      const expectedUnits = isConstraintFacet ? positiveExpected.length : (positiveExpected.length ? 1 : 0);
      const predictedUnits = isConstraintFacet ? predicted.length : (predicted.length ? 1 : 0);
      const matchedUnits = isConstraintFacet ? matchedExpected.length : (matchedExpected.length ? 1 : 0);
      const falsePositiveUnits = isConstraintFacet ? unmatchedPredicted.length : (predicted.length > 0 && matchedUnits === 0 ? 1 : 0);
      predictedCount += predictedUnits;
      expectedCount += expectedUnits;
      matchedCount += matchedUnits;
      falsePositiveCount += falsePositiveUnits;
      hardBindingErrors += forbiddenMatches.length;
      details.push({ instanceId: label.instanceId, expected: expectedUnits, predicted: predictedUnits, matched: matchedUnits, falsePositives: falsePositiveUnits, hardBindingErrors: forbiddenMatches.length });
    }
    result[facet] = {
      labelCases: cases.length,
      expected: expectedCount,
      predicted: predictedCount,
      matched: matchedCount,
      coverage: ratio(predictedCount, cases.length),
      precision: ratio(matchedCount, predictedCount),
      recall: ratio(matchedCount, expectedCount),
      mismatchRate: ratio(falsePositiveCount, predictedCount),
      overConstraintRate: facet === "filters" ? ratio(falsePositiveCount, predictedCount) : null,
      hardBindingError: facet === "filters" && forbiddenExpectedCount > 0 ? ratio(hardBindingErrors, predictedCount) : null,
      details,
    };
  }
  return {
    status: "computed",
    labelStatuses: [...normalizeLabelStatuses(statuses)],
    scoredCases: scored.length,
    facets: result,
    note: "七槽位是对 reviewed/adjudicated 11 槽位标签的可追溯投影：entity/groupBy 来源于 grain，metric 来源于 measure；不是 Gold 反向注入，也不把投影缺失当作正确。",
  };
}

function normalizeLabelStatuses(statuses) {
  if (statuses instanceof Set) return statuses;
  if (Array.isArray(statuses)) return new Set(statuses);
  return FINAL_LABEL_STATUSES;
}

function scoredLabelStatuses(labels, statuses) {
  const allowed = normalizeLabelStatuses(statuses);
  return labels.filter((label) => allowed.has(label.annotationStatus));
}

function outputColumnsQualityAggregate(caseResults, labels, statuses = FINAL_LABEL_STATUSES) {
  const scored = scoredLabelStatuses(labels, statuses);
  let predicted = 0;
  let matched = 0;
  const details = [];
  for (const label of scored) {
    const caseResult = caseResults.find((item) => item.instanceId.toLowerCase() === label.instanceId.toLowerCase());
    if (!caseResult) continue;
    const prediction = caseResult.answerShape.prediction;
    const predictedColumns = Array.isArray(prediction?.columns)
      ? prediction.columns
      : Array.isArray(prediction?.columnNames) ? prediction.columnNames : undefined;
    const hasPrediction = Boolean(predictedColumns);
    const matchedAlternative = hasPrediction && expectedAlternatives(label.facets.output, "output").some((alternative) => {
      if (alternative.columnCount !== predictedColumns.length) return false;
      return !Array.isArray(alternative.columnNames)
        || alternative.columnNames.length !== predictedColumns.length
        || alternative.columnNames.every((name, index) => String(name).toLowerCase() === String(predictedColumns[index]).toLowerCase());
    });
    if (hasPrediction) predicted += 1;
    if (matchedAlternative) matched += 1;
    details.push({ instanceId: label.instanceId, predicted: hasPrediction ? 1 : 0, matched: matchedAlternative ? 1 : 0 });
  }
  return {
    labelCases: scored.length,
    predicted,
    matched,
    coverage: ratio(predicted, scored.length),
    precision: ratio(matched, predicted),
    recall: ratio(matched, scored.length),
    mismatchRate: ratio(Math.max(0, predicted - matched), predicted),
    overConstraintRate: null,
    hardBindingError: null,
    details,
  };
}

function slotQualityAggregate(caseResults, labels, statuses = FINAL_LABEL_STATUSES) {
  if (!Array.isArray(labels)) return null;
  const scored = scoredLabelStatuses(labels, statuses);
  const result = {};
  for (const facet of LABEL_FACETS) {
    const cases = scored.filter((label) => labelFacetApplicable(label.facets?.[facet], facet));
    let predictedCount = 0;
    let matchedCount = 0;
    let expectedCount = 0;
    let falsePositiveCount = 0;
    let hardBindingErrors = 0;
    let forbiddenExpectedCount = 0;
    const details = [];
    for (const label of cases) {
      const caseResult = caseResults.find((item) => item.instanceId.toLowerCase() === label.instanceId.toLowerCase());
      if (!caseResult) continue;
      const expected = expectedAlternatives(label.facets[facet], facet);
      const predicted = predictedFacet(caseResult, facet);
      const positiveExpected = expected.filter((item) => item.__binding !== "forbidden");
      const forbiddenExpected = expected.filter((item) => item.__binding === "forbidden");
      forbiddenExpectedCount += forbiddenExpected.length;
      const matchedExpected = positiveExpected.filter((target) => predicted.some((item) => facetAlternativeMatches(facet, item, target)));
      const unmatchedPredicted = predicted.filter((item) => !positiveExpected.some((target) => facetAlternativeMatches(facet, item, target)));
      const forbiddenMatches = predicted.filter((item) => forbiddenExpected.some((target) => facetAlternativeMatches(facet, item, target)));
      const isConstraintFacet = facet === "filters";
      const expectedUnits = isConstraintFacet ? positiveExpected.length : (positiveExpected.length ? 1 : 0);
      const predictedUnits = isConstraintFacet ? predicted.length : (predicted.length ? 1 : 0);
      const matchedUnits = isConstraintFacet ? matchedExpected.length : (matchedExpected.length ? 1 : 0);
      const falsePositiveUnits = isConstraintFacet ? unmatchedPredicted.length : (predicted.length > 0 && matchedUnits === 0 ? 1 : 0);
      predictedCount += predictedUnits;
      expectedCount += expectedUnits;
      matchedCount += matchedUnits;
      falsePositiveCount += falsePositiveUnits;
      hardBindingErrors += isConstraintFacet ? forbiddenMatches.length : 0;
      details.push({
        instanceId: label.instanceId,
        expected: expectedUnits,
        predicted: predictedUnits,
        matched: matchedUnits,
        falsePositives: falsePositiveUnits,
        hardBindingErrors: isConstraintFacet ? forbiddenMatches.length : 0,
      });
    }
    const ambiguousCases = cases.filter((label) => facet === "ambiguity" && label.facets[facet].alternatives.length > 0);
    const abstentionCorrect = facet === "ambiguity"
      ? ambiguousCases.filter((label) => predictedFacet(caseResults.find((item) => item.instanceId.toLowerCase() === label.instanceId.toLowerCase()), facet).length === 0).length
      : 0;
    result[facet] = {
      labelCases: cases.length,
      expected: expectedCount,
      predicted: predictedCount,
      matched: matchedCount,
      coverage: ratio(predictedCount, cases.length),
      precision: ratio(matchedCount, predictedCount),
      recall: ratio(matchedCount, expectedCount),
      mismatchRate: ratio(falsePositiveCount, predictedCount),
      overConstraintRate: facet === "filters" ? ratio(falsePositiveCount, predictedCount) : null,
      hardBindingError: facet === "filters" && forbiddenExpectedCount > 0 ? ratio(hardBindingErrors, predictedCount) : null,
      ...(facet === "ambiguity" ? {
        ambiguousCases: ambiguousCases.length,
        abstentionCorrect,
        abstentionAccuracy: ratio(abstentionCorrect, ambiguousCases.length),
      } : {}),
      details,
    };
  }
  return {
    status: "computed",
    labelStatuses: [...normalizeLabelStatuses(statuses)],
    scoredCases: scored.length,
    facets: result,
    outputColumns: outputColumnsQualityAggregate(caseResults, labels, statuses),
    note: "仅使用 reviewed/adjudicated 标签；draft 和 pending_manual 不进入正式指标。output 的 columns 单独计分，因为当前提取器不输出列合同。",
  };
}

function rowCardinalityResult(prediction, goldShapes) {
  const expectedRowCounts = [...new Set(goldShapes.map((shape) => shape.rowCount))].sort((a, b) => a - b);
  if (prediction?.rowCount === undefined) {
    return {
      status: "missing_prediction",
      predictedRows: null,
      expectedRowCounts,
    };
  }
  if (expectedRowCounts.includes(prediction.rowCount)) {
    return {
      status: "match",
      predictedRows: prediction.rowCount,
      expectedRowCounts,
    };
  }
  return {
    status: "mismatch",
    predictedRows: prediction.rowCount,
    expectedRowCounts,
  };
}

function answerShapeAggregate(caseResults) {
  const total = caseResults.length;
  const predictions = caseResults.filter((item) => item.answerShape.prediction.rowMode !== undefined || item.answerShape.prediction.rowCount !== undefined);
  const rowModeNonEmpty = caseResults.filter((item) => item.answerShape.prediction.rowMode !== undefined).length;
  const rowCountNonEmpty = caseResults.filter((item) => item.answerShape.prediction.rowCount !== undefined).length;
  const compatible = caseResults.filter((item) => item.answerShape.rowCardinality.status === "match").length;
  const missing = caseResults.filter((item) => item.answerShape.rowCardinality.status === "missing_prediction").length;
  const mismatched = caseResults.filter((item) => item.answerShape.rowCardinality.status === "mismatch").length;
  const modeCounts = {};
  for (const item of predictions) {
    const mode = item.answerShape.prediction.rowMode ?? "unknown";
    modeCounts[mode] = (modeCounts[mode] ?? 0) + 1;
  }
  return {
    rowMode: countMetric(rowModeNonEmpty, total),
    rowCount: countMetric(rowCountNonEmpty, total),
    // The current extractor has no column contract. Calling this a zero
    // precision result would conflate "not implemented" with "wrong".
    columns: {
      nonEmpty: 0,
      total,
      rate: 0,
      comparable: false,
      reason: "deriveRequestAnswerShape does not emit columns",
    },
    rowCardinality: {
      predicted: predictions.length,
      compatible,
      missing,
      mismatched,
      fixedDenominatorRate: ratio(compatible, total),
      conditionalAgreementRate: ratio(compatible, predictions.length),
      agreementDefinition: "prediction.rowCount matches the rowCount of any accepted Gold CSV variant",
    },
    predictedModeCounts: modeCounts,
    mismatchCaseIds: caseResults.filter((item) => item.answerShape.rowCardinality.status === "mismatch").map((item) => item.instanceId),
    missingCaseIds: caseResults.filter((item) => item.answerShape.rowCardinality.status === "missing_prediction").map((item) => item.instanceId),
  };
}

function filterAggregate(caseResults) {
  const extracted = caseResults.flatMap((item) => item.filters.constraints.map((constraint) => ({
    instanceId: item.instanceId,
    statement: typeof constraint?.statement === "string" ? constraint.statement : String(constraint?.statement ?? ""),
  })));
  const strict = extracted.filter((item) => looksLikeExplicitSqlPredicate(item.statement));
  const casesWithNonEmpty = caseResults.filter((item) => item.filters.constraints.length > 0).length;
  const casesWithStrict = new Set(strict.map((item) => item.instanceId)).size;
  const casesWithObviousFalsePositive = new Set(extracted.filter((item) => !looksLikeExplicitSqlPredicate(item.statement)).map((item) => item.instanceId)).size;
  return {
    casesWithNonEmpty,
    caseNonEmptyRate: ratio(casesWithNonEmpty, caseResults.length),
    totalConstraints: extracted.length,
    strictSyntaxPass: strict.length,
    obviousFalsePositive: extracted.length - strict.length,
    strictSyntaxPassRate: ratio(strict.length, extracted.length),
    casesWithStrictSyntaxPass: casesWithStrict,
    casesWithObviousFalsePositive,
    semanticPrecision: null,
    semanticRecall: null,
    semanticMetricsNote: "尚未建立人工语义标签；这里仅统计明显 SQL 语法形状，不能替代语义 Precision/Recall。",
    obviousFalsePositiveExamples: extracted.filter((item) => !looksLikeExplicitSqlPredicate(item.statement)).slice(0, 30),
    strictSyntaxExamples: strict.slice(0, 30),
  };
}

/**
 * Measure the public extraction seams without invoking a model, database, or
 * Hook. Gold shapes are structural evidence only; semantic facet matching uses
 * the reviewed annotation set when supplied and never feeds Gold back to runtime.
 */
export function measureSpecQuality({ cases, goldShapes, extractors, labels = undefined, labelStatuses = FINAL_LABEL_STATUSES }) {
  if (!Array.isArray(cases)) throw new Error("SPEC_QUALITY_CASES_REQUIRED");
  if (!(goldShapes instanceof Map)) throw new Error("SPEC_QUALITY_GOLD_SHAPES_REQUIRED");
  if (!extractors || typeof extractors.answerShape !== "function" || typeof extractors.filterConstraints !== "function") {
    throw new Error("SPEC_QUALITY_EXTRACTORS_REQUIRED");
  }

  const caseResults = cases.map((item) => {
    const instanceId = String(item.instance_id);
    const question = String(item.question ?? "");
    const prediction = extractors.answerShape(question) ?? {};
    const constraints = extractors.filterConstraints(question) ?? [];
    const answerSpecPrediction = typeof extractors.answerSpec === "function"
      ? (extractors.answerSpec(question) ?? {})
      : {};
    const shapes = goldShapes.get(instanceId.toLowerCase()) ?? [];
    return {
      instanceId,
      database: item.db,
      question,
      answerSpecPrediction,
      answerShape: {
        prediction,
        goldShapes: shapes,
        rowCardinality: rowCardinalityResult(prediction, shapes),
        fullShape: {
          status: "not_comparable",
          reason: "当前提取器不输出最终列数、列语义或列顺序",
        },
      },
      filters: {
        constraints,
        nonEmpty: constraints.length > 0,
        strictSyntaxPass: constraints.filter((constraint) => looksLikeExplicitSqlPredicate(constraint?.statement)).length,
      },
    };
  });

  const missingGoldCaseIds = caseResults.filter((item) => item.answerShape.goldShapes.length === 0).map((item) => item.instanceId);
  const normalizedLabels = Array.isArray(labels) ? labels : null;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    methodology: {
      scope: "题面 → 当前确定性提取器 → 离线结构比较",
      answerShapeExtractor: "deriveRequestAnswerShape",
      answerSpecExtractor: "deriveRequestSevenFacetSpec",
      filterExtractor: "deriveRequestFilterConstraints",
      goldShapeSource: "evaluation_suite/gold/exec_result/*.csv",
      acceptedGoldVariants: "同一 instance_id 的任一 Gold CSV 变体",
      shapeComparison: "当前仅能比较最终行数；列数、列语义、列顺序暂不可比较",
      filterComparison: normalizedLabels ? "使用 reviewed/adjudicated 标签比较约束匹配、过度约束和禁止约束" : "当前仅报告非空率与明显 SQL 语法误提取；语义 Precision/Recall 待人工标签", 
      slotComparison: normalizedLabels ? "按标签状态和 alternatives 对 output、grain、measure、denominator、ranking、time、unit、rounding、joins、filters、ambiguity 逐槽位比较；另提供 entity、metric、filters、groupBy、time、ranking、output 七槽位投影" : "尚未加载 reviewed/adjudicated 标签",
      runtimeIsolation: "不调用模型、数据库或 Query Assurance Hook",
    },
    aggregate: {
      totalCases: caseResults.length,
      missingGoldCaseIds,
      answerShape: answerShapeAggregate(caseResults),
      filters: filterAggregate(caseResults),
      ...(normalizedLabels ? {
        slots: slotQualityAggregate(caseResults, normalizedLabels, labelStatuses),
        sevenFacetSlots: sevenFacetQualityAggregate(caseResults, normalizedLabels, labelStatuses),
      } : {}),
    },
    ...(normalizedLabels ? { labels: { scoredStatuses: [...labelStatuses], total: normalizedLabels.length } } : {}),
    cases: caseResults,
  };
}

function percentText(value) {
  return value === null ? "—" : `${(value * 100).toFixed(2)}%`;
}

function countText(numerator, denominator) {
  return `${numerator}/${denominator}`;
}

export function renderSpecQualityMarkdown(report) {
  const { aggregate: summary } = report;
  const shape = summary.answerShape;
  const filters = summary.filters;
  const mismatchRows = report.cases
    .filter((item) => item.answerShape.rowCardinality.status === "mismatch")
    .map((item) => `| ${item.instanceId} | ${item.answerShape.prediction.rowMode ?? "—"} / ${item.answerShape.prediction.rowCount ?? "—"} | ${item.answerShape.goldShapes.map((shape) => `${shape.rowCount}×${shape.columnCount}`).join("；") || "—"} |`)
    .join("\n");
  const falsePositiveRows = filters.obviousFalsePositiveExamples
    .slice(0, 20)
    .map((item) => `| ${item.instanceId} | ${item.statement.replaceAll("|", "\\|")} |`)
    .join("\n");
  const missingGold = summary.missingGoldCaseIds.length ? summary.missingGoldCaseIds.join(", ") : "无";
  const sevenSlotRows = summary.sevenFacetSlots
    ? [
      ...SEVEN_FACETS.map((facet) => {
        const metric = summary.sevenFacetSlots.facets[facet];
        return `| ${facet} | ${metric.labelCases} | ${metric.predicted} | ${metric.matched} | ${percentText(metric.coverage)} | ${percentText(metric.precision)} | ${percentText(metric.recall)} | ${percentText(metric.mismatchRate)} | ${percentText(metric.overConstraintRate)} |`;
      }),
    ].join("\n")
    : "| 未加载 reviewed/adjudicated 标签 | — | — | — | — | — | — | — | — |";
  const legacySlotRows = summary.slots
    ? [
      ...LABEL_FACETS.map((facet) => {
        const metric = summary.slots.facets[facet];
        return `| ${facet} | ${metric.labelCases} | ${metric.predicted} | ${metric.matched} | ${percentText(metric.coverage)} | ${percentText(metric.precision)} | ${percentText(metric.recall)} | ${percentText(metric.mismatchRate)} | ${percentText(metric.overConstraintRate)} | ${percentText(metric.hardBindingError)} |`;
      }),
      (() => {
        const metric = summary.slots.outputColumns;
        return `| output.columns | ${metric.labelCases} | ${metric.predicted} | ${metric.matched} | ${percentText(metric.coverage)} | ${percentText(metric.precision)} | ${percentText(metric.recall)} | ${percentText(metric.mismatchRate)} | ${percentText(metric.overConstraintRate)} | ${percentText(metric.hardBindingError)} |`;
      })(),
    ].join("\n")
    : "| 未加载 reviewed/adjudicated 标签 | — | — | — | — | — | — | — | — |";
  const slotSection = summary.sevenFacetSlots ? [
    "## 4. 七槽位语义指标",
    "",
    "> 七槽位为对 reviewed/adjudicated 标签的可追溯投影：entity/groupBy 来源于 grain，metric 来源于 measure，filters/output/time/ranking 使用对应原始标签。`错配率` 不等于过度约束；只有 filters 的额外约束计入 `过度约束率`。草稿标签不进入正式分母。",
    "",
    "| 槽位 | 标签题数 | 预测数 | 匹配数 | Coverage | Precision | Recall | 错配率 | 过度约束率 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    sevenSlotRows,
    "",
    `七槽位标签状态：${summary.sevenFacetSlots.labelStatuses.join("，")}；计分题数：${summary.sevenFacetSlots.scoredCases}。`,
    "",
    "### 原始 11 槽位诊断",
    "",
    "| 槽位 | 标签题数 | 预测数 | 匹配数 | Coverage | Precision | Recall | 错配率 | 过度约束率 | Hard-binding error |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    legacySlotRows,
    "",
  ] : [];
  return [
    "# 题面 → Answer Spec 提取质量基线（SQLite 135 题）",
    "",
    `生成时间：${report.generatedAt}`,
    "",
    "> 本报告是离线基线，不调用模型、数据库或 Query Assurance Hook。它测量当前确定性提取器能提取什么，以及输出行数是否与 Gold 结果形状一致；不把 Gold 反向注入运行时。", 
    "",
    "## 1. 总览",
    "",
    "| 槽位/指标 | 非空或通过 | 比率 | 说明 |",
    "|---|---:|---:|---|",
    `| answerShape.rowMode | ${countText(shape.rowMode.nonEmpty, shape.rowMode.total)} | ${percentText(shape.rowMode.rate)} | 当前提取器输出的 rowMode |`,
    `| answerShape.rowCount | ${countText(shape.rowCount.nonEmpty, shape.rowCount.total)} | ${percentText(shape.rowCount.rate)} | 当前提取器输出的 rowCount |`,
    `| answerShape.columns | ${countText(shape.columns.nonEmpty, shape.columns.total)} | ${percentText(shape.columns.rate)} | 当前提取器不输出列合同 |`,
    `| Gold 行数一致（固定分母） | ${countText(shape.rowCardinality.compatible, summary.totalCases)} | ${percentText(shape.rowCardinality.fixedDenominatorRate)} | 与任一 Gold 变体的行数一致 |`,
    `| Gold 行数一致（已预测子集） | ${countText(shape.rowCardinality.compatible, shape.rowCardinality.predicted)} | ${percentText(shape.rowCardinality.conditionalAgreementRate)} | 仅在提取器给出 rowCount 的题中计算 |`,
    `| filters 有输出 | ${countText(filters.casesWithNonEmpty, summary.totalCases)} | ${percentText(filters.caseNonEmptyRate)} | 至少提取一个过滤约束的题 |`,
    `| 过滤约束总数 | ${filters.totalConstraints} | — | 所有题合计 |`,
    `| 明显 SQL 语法形状通过 | ${countText(filters.strictSyntaxPass, filters.totalConstraints)} | ${percentText(filters.strictSyntaxPassRate)} | 诊断指标，不是语义 Precision |`,
    "",
    "## 2. Answer Shape 细分",
    "",
    `- 预测分布：${Object.entries(shape.predictedModeCounts).map(([key, value]) => `${key}=${value}`).join("，") || "无"}。`,
    `- 缺失预测：${shape.rowCardinality.missing} 题。`,
    `- 已预测但与 Gold 行数不一致：${shape.rowCardinality.mismatched} 题。`,
    `- 当前无法测量完整行列形状：提取器没有输出 columns；Gold 形状仍保留在逐题记录中。`,
    "",
    "### 行数预测错误",
    "",
    "| 题目 | 预测 rowMode / rowCount | Gold 变体行×列 |",
    "|---|---|---|",
    mismatchRows || "| 无 | — | — |",
    "",
    "## 3. Filter 提取诊断",
    "",
    `- 当前 \`deriveRequestFilterConstraints\` 在 ${filters.totalConstraints} 个输出中，只有 ${filters.strictSyntaxPass} 个符合严格 SQL 谓词形状；${filters.obviousFalsePositive} 个属于明显的普通英文短语误匹配。`,
    `- 修复前的典型问题是把英文介词 \`in\` 当作 SQL \`IN\`；当前报告只显示修复后的结果。`,
    summary.sevenFacetSlots
      ? `- 已加载 ${summary.sevenFacetSlots.scoredCases} 道 reviewed/adjudicated 标签；七槽位语义指标及原始标签诊断请见下方表格。`
      : "- 语义 Precision/Recall 暂不计算（报告中为 null），因为尚未有经过复核的题面过滤条件标签。",

    "",
    "| 题目 | 明显误提取语句 |",
    "|---|---|",
    falsePositiveRows || "| 无 | — |",
    "",
    ...slotSection,
    "## 5. 方法边界与下一步",
    "",
    "1. 本轮已经完成确定性基线：135 题的七槽位非空率、行数兼容率和明显过滤误提取率。" ,
    "2. Gold CSV 能直接提供行数、列数和列名，但当前确定性提取器仍不输出最终列合同，因此 output.columns 单独计分；七槽位语义指标在下方报告。", 
    summary.sevenFacetSlots
      ? "3. 已使用 adjudicated 标签完成七槽位投影及原始槽位诊断；仍需将失败槽位作为提取器修复输入，而不是把标签反向注入运行时。"
      : "3. 尚未加载 adjudicated 标签，不能宣称槽位级语义 Precision/Recall。",
    `4. Gold 文件缺失题目：${missingGold}。`,
    "",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) throw new Error(`UNEXPECTED_ARGUMENT:${item}`);
    const key = item.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) options[key] = true;
    else { options[key] = next; index += 1; }
  }
  return options;
}

async function fileExists(filePath) {
  try { await access(filePath); return true; } catch { return false; }
}

async function readIdsFile(filePath) {
  return (await readFile(filePath, "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((id) => id.replace(/^sf_/, "").toLowerCase());
}

async function loadRuntimeExtractors() {
  try {
    const runtime = await import("../../packages/runtime/dist/index.js");
    return {
      answerShape: runtime.deriveRequestAnswerShape,
      answerSpec: runtime.deriveRequestSevenFacetSpec,
      filterConstraints: runtime.deriveRequestFilterConstraints,
    };
  } catch (error) {
    throw new Error(`RUNTIME_DIST_REQUIRED: run npm run build:runtime first (${error instanceof Error ? error.message : String(error)})`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.validateLabels) {
    if (typeof options.validateLabels !== "string") throw new Error("VALIDATE_LABELS_PATH_REQUIRED");
    if (!options.liteRoot && !options.dataset) {
      const labels = await loadSpecQualityLabels(path.resolve(options.validateLabels));
      console.log(JSON.stringify({ labels: path.resolve(options.validateLabels), totalLabels: labels.length, status: "valid" }, null, 2));
      return;
    }
  }
  const liteRoot = options.liteRoot ?? process.env.SPIDER2_LITE_ROOT;
  const rawDatasetPath = options.dataset ?? (liteRoot ? path.join(liteRoot, "spider2-lite.jsonl") : undefined);
  const rawGoldDir = options.goldDir ?? (liteRoot ? path.join(liteRoot, "evaluation_suite", "gold", "exec_result") : undefined);
  if (!rawDatasetPath) throw new Error("DATASET_REQUIRED: use --lite-root or --dataset");
  if (!rawGoldDir) throw new Error("GOLD_DIR_REQUIRED: use --lite-root or --gold-dir");
  const datasetPath = path.resolve(rawDatasetPath);
  const goldDir = path.resolve(rawGoldDir);
  if (!await fileExists(datasetPath)) throw new Error(`DATASET_NOT_FOUND:${datasetPath}`);
  if (!await fileExists(goldDir)) throw new Error(`GOLD_DIR_NOT_FOUND:${goldDir}`);

  const allCases = await loadCases(datasetPath);
  const ids = options.idsFile ? await readIdsFile(path.resolve(options.idsFile)) : undefined;
  const cases = selectCases(allCases, { backend: "sqlite", ...(ids ? { ids } : {}) });
  if (!cases.length) throw new Error("NO_SQLITE_CASES_SELECTED");
  const goldShapes = await loadGoldShapeIndex(goldDir, cases.map((item) => item.instance_id.toLowerCase()));
  const expectedIds = cases.map((item) => item.instance_id);
  const expectedQuestions = new Map(cases.map((item) => [item.instance_id.toLowerCase(), String(item.question ?? "")]));
  if (options.validateLabels) {
    await loadSpecQualityLabels(path.resolve(options.validateLabels), { expectedIds, expectedQuestions });
  }
  const labelsPath = typeof options.labels === "string" ? path.resolve(options.labels) : undefined;
  const labels = labelsPath
    ? await loadSpecQualityLabels(labelsPath, { expectedIds, expectedQuestions })
    : undefined;
  const labelStatuses = typeof options.labelStatuses === "string"
    ? new Set(options.labelStatuses.split(",").map((item) => item.trim()).filter(Boolean))
    : FINAL_LABEL_STATUSES;
  if ([...labelStatuses].some((status) => !FINAL_LABEL_STATUSES.has(status))) throw new Error("SPEC_LABEL_STATUS_NOT_FORMAL");
  const report = measureSpecQuality({ cases, goldShapes, extractors: await loadRuntimeExtractors(), labels, labelStatuses });
  const datasetSha256 = sha256Text(await readFile(datasetPath, "utf8"));
  const goldSha256 = await sha256Tree(goldDir);
  const provenance = {
    datasetPath,
    goldDir,
    datasetSha256,
    goldSha256,
    ...(labelsPath ? { labelsSha256: sha256Text(await readFile(labelsPath, "utf8")) } : {}),
    generator: "evaluations/spider2/spec-quality.mjs",
  };
  const outputPath = path.resolve(options.output ?? "docs/Spider2题面Spec提取质量基线-135题.json");
  const markdownPath = path.resolve(options.markdown ?? outputPath.replace(/\.json$/i, ".md"));
  await mkdir(path.dirname(outputPath), { recursive: true });
  await mkdir(path.dirname(markdownPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({ ...report, sources: { ...provenance, ...(labelsPath ? { labelsPath } : {}) } }, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, `${renderSpecQualityMarkdown(report)}\n`, "utf8");
  let labelsDraftPath;
  if (options.draftLabels) {
    labelsDraftPath = path.resolve(options.draftLabels);
    const drafts = createLabelDraft(cases, goldShapes).map((draft) => ({ ...draft, provenance }));
    for (const draft of drafts) validateSpecQualityLabel(draft);
    await mkdir(path.dirname(labelsDraftPath), { recursive: true });
    await writeFile(labelsDraftPath, `${drafts.map((draft) => JSON.stringify(draft)).join("\n")}\n`, "utf8");
  }
  console.log(JSON.stringify({
    output: outputPath,
    markdown: markdownPath,
    ...(labelsDraftPath ? { labelsDraft: labelsDraftPath } : {}),
    totalCases: report.aggregate.totalCases,
    answerShape: report.aggregate.answerShape,
    filters: report.aggregate.filters,
    ...(report.aggregate.slots ? { slots: report.aggregate.slots } : {}),
  }, null, 2));
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
