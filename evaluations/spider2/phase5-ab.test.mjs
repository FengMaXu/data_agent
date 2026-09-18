import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildPhase5Report } from "./phase5-ab.mjs";

function manifest(arm, enabled, interpretations) {
  return {
    runId: `phase5-${arm}`,
    agentCommit: "agent",
    spider2Commit: "spider2",
    datasetSha256: "dataset",
    evaluatorSha256: "evaluator",
    systemPromptSha256: "prompt",
    model: { provider: "openai", model: "test", apiFormat: "chat" },
    limits: { maxTurns: 20, maxToolCalls: 50, maxExploratoryQueries: 6 },
    concurrency: 1,
    assurance: {
      mode: "shadow",
      reviewerModel: "test",
      planner: true,
      shadowDelivery: "publish_with_disagreement",
      hooks: { informOnQuery: true, interpretationsOnAnomaly: interpretations, integrityBlocks: true, terminateAfterExport: true },
      detectors: { enabled, tierA: ["join_fanout"], tierB: ["shape_mismatch"], disabled: [] },
      interpretations: { triggerTiers: ["A"], maxCyclesPerTask: 1 },
      delivery: "deliver_with_disclosure",
    },
    instanceIds: ["local001"],
  };
}

const summary = (csvCoverage) => ({
  total: 1,
  statuses: { completed: 1 },
  publicationStatuses: { published_with_disagreement: 1 },
  sqlCoverage: csvCoverage,
  csvCoverage,
  averageDurationMs: 10,
  averageToolCalls: 2,
  anomalyCount: 0,
  interpretationHookCount: 0,
  interpretationBudgetSkipCount: 0,
});

const official = (score) => ({ execResult: { fixedDenominator: { score, correct: score ? 1 : 0, total: 1, missingSubmissions: score ? 0 : 1 }, caseScores: { local001: score ? 1 : 0 } } });

test("Phase 5 A/B verifier checks the intended switches and fixed-denominator outcome", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "phase5-ab-test-"));
  const control = path.join(root, "control");
  const treatment = path.join(root, "treatment");
  const spec = path.join(root, "spec.json");
  try {
    for (const run of [control, treatment]) await mkdir(path.join(run, "cases", "local001"), { recursive: true });
    await mkdir(path.join(control, "official_score"), { recursive: true });
    await mkdir(path.join(treatment, "official_score"), { recursive: true });
    await writeFile(path.join(control, "manifest.json"), JSON.stringify(manifest("control", false, false)));
    await writeFile(path.join(treatment, "manifest.json"), JSON.stringify(manifest("hooks", true, true)));
    await writeFile(path.join(control, "summary.json"), JSON.stringify(summary(0.5)));
    await writeFile(path.join(treatment, "summary.json"), JSON.stringify(summary(1)));
    await writeFile(path.join(control, "official_score", "summary.json"), JSON.stringify(official(0.5)));
    await writeFile(path.join(treatment, "official_score", "summary.json"), JSON.stringify(official(0)));
    const trace = { toolCalls: [{ toolName: "query_database", args: { mode: "exploration" }, result: { details: { artifactKind: "exploration" } } }, { toolName: "query_database", args: { mode: "result" }, result: { details: { artifactKind: "result_candidate" } } }] };
    await writeFile(path.join(control, "cases", "local001", "trace.json"), JSON.stringify(trace));
    await writeFile(path.join(treatment, "cases", "local001", "trace.json"), JSON.stringify(trace));
    const slotMetric = { coverage: 1, precision: 1, recall: 1, mismatchRate: 0, overConstraintRate: null };
    await writeFile(spec, JSON.stringify({ aggregate: {
      sevenFacetSlots: { facets: Object.fromEntries(["entity", "metric", "filters", "groupBy", "time", "ranking", "output"].map((facet) => [facet, slotMetric])) },
      slots: { outputColumns: { coverage: 0, precision: null, recall: 0, mismatchRate: null, overConstraintRate: null } },
    } }));

    const result = await buildPhase5Report(control, treatment, spec);
    assert.equal(result.json.comparison.sameExperimentalInputs, true);
    assert.equal(result.json.comparison.onlyExpectedDifferences, true);
    assert.equal(result.json.comparison.csvCoverageNonDecreasing, true);
    assert.equal(result.json.comparison.accuracyNonDecreasing, false);
    assert.equal(result.json.arms.control.metrics.trace.explorationQueries, 1);
    assert.equal(result.json.arms.treatment.metrics.trace.resultQueries, 1);
    assert.match(result.markdown, /135 题七槽位离线指标/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
