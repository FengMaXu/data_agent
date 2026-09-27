import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertContinueBudget,
  createAttemptDescriptor,
  createAttemptLayout,
  createContinueAttempt,
  createRetryAttempt,
  runAttempt,
} from "./episode.mjs";

test("retry creates a new attempt identity and continue preserves the old identity", async () => {
  const base = createAttemptDescriptor({ runId: "run", caseId: "case", attemptId: "attempt-001", experimentId: "experiment", budgetSnapshot: { maxTurns: 3 } });
  const retry = createRetryAttempt(base);
  assert.equal(retry.mode, "retry");
  assert.equal(retry.retryOf, "attempt-001");
  assert.notEqual(retry.attemptId, base.attemptId);
  const continued = createContinueAttempt(base, { experimentId: "experiment", budgetSnapshot: { maxTurns: 3 } });
  assert.equal(continued.attemptId, base.attemptId);
  assert.equal(continued.mode, "continue");
  assert.deepEqual(assertContinueBudget(base, continued).changed, []);
  assert.throws(() => createContinueAttempt(base, { experimentId: "other" }), /CONTINUE_EXPERIMENT_MISMATCH/);
  assert.throws(() => assertContinueBudget(base, { budgetSnapshot: { maxTurns: 4 } }), /CONTINUE_BUDGET_RESET/);
});

test("attempt layout is write-once and runAttempt reports cleanup failure separately", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "spider-episode-"));
  try {
    const descriptor = createAttemptDescriptor({ runId: "run", caseId: "case", attemptId: "attempt-001", experimentId: "experiment" });
    const layout = await createAttemptLayout(root, descriptor);
    assert.match(await readFile(layout.attemptPath, "utf8"), /attempt-001/);
    await assert.rejects(createAttemptLayout(root, { ...descriptor, traceId: "different" }), /ATTEMPT_IDENTITY_MISMATCH/);
    const result = await runAttempt({ experimentId: "experiment" }, { instance_id: "case" }, descriptor, {
      layout,
      execute: async () => ({ status: "completed", value: 1 }),
      cleanup: async () => { throw new Error("CLEANUP_FAILED"); },
    });
    assert.equal(result.status, "completed");
    assert.equal(result.cleanupError.message, "CLEANUP_FAILED");
    assert.equal(result.recordComplete, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
