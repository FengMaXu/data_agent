import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stableStringify } from "./record.mjs";

export const ATTEMPT_SCHEMA_VERSION = 1;

function hash(value) {
  return createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

async function exists(filePath) {
  try { await access(filePath); return true; } catch { return false; }
}

function nextAttemptNumber(id) {
  const match = /(?:^|[-_])(?:attempt|retry)[-_]?(\d+)$/.exec(id ?? "");
  return match ? Number(match[1]) + 1 : 1;
}

export function attemptDirectory(runRoot, caseId, attemptId) {
  return path.join(runRoot, "cases", caseId, "attempts", attemptId);
}

export function createAttemptDescriptor(input = {}) {
  if (!input.runId || !input.caseId || !input.attemptId || !input.experimentId) throw new Error("ATTEMPT_IDENTITY_REQUIRED");
  const mode = input.mode ?? "run";
  if (!["run", "continue", "retry", "rescore"].includes(mode)) throw new Error(`UNSUPPORTED_ATTEMPT_MODE:${mode}`);
  return {
    schemaVersion: ATTEMPT_SCHEMA_VERSION,
    runId: input.runId,
    caseId: input.caseId,
    attemptId: input.attemptId,
    traceId: input.traceId ?? hash({ runId: input.runId, caseId: input.caseId, attemptId: input.attemptId }).slice(0, 32),
    experimentId: input.experimentId,
    mode,
    ...(input.retryOf ? { retryOf: input.retryOf } : {}),
    ...(input.continuesFrom ? { continuesFrom: input.continuesFrom } : {}),
    createdAt: input.createdAt ?? new Date().toISOString(),
    inputIdentity: input.inputIdentity ?? null,
    budgetSnapshot: input.budgetSnapshot ?? null,
    status: "created",
  };
}

export async function createAttemptLayout(runRoot, descriptor) {
  const root = attemptDirectory(runRoot, descriptor.caseId, descriptor.attemptId);
  const paths = {
    root,
    session: path.join(root, "session"),
    knowledge: path.join(root, "knowledge"),
    workspace: path.join(root, "workspace"),
    submissions: path.join(root, "submissions"),
    artifacts: path.join(root, "artifacts"),
  };
  await Promise.all(Object.values(paths).map((target) => mkdir(target, { recursive: true })));
  const attemptPath = path.join(root, "attempt.json");
  if (!(await exists(attemptPath))) await writeFile(attemptPath, `${stableStringify(descriptor)}\n`, { encoding: "utf8", flag: "wx" });
  else {
    const existing = JSON.parse(await readFile(attemptPath, "utf8"));
    if (existing.experimentId !== descriptor.experimentId || existing.traceId !== descriptor.traceId) throw new Error("ATTEMPT_IDENTITY_MISMATCH");
  }
  return { descriptor, ...paths, attemptPath };
}

export async function readAttemptDescriptor(runRoot, caseId, attemptId) {
  const filePath = path.join(attemptDirectory(runRoot, caseId, attemptId), "attempt.json");
  if (!(await exists(filePath))) return undefined;
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function listAttemptDescriptors(runRoot, caseId) {
  const root = path.join(runRoot, "cases", caseId, "attempts");
  const names = await readdir(root, { withFileTypes: true }).catch(() => []);
  const result = [];
  for (const entry of names.filter((item) => item.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
    const descriptor = await readAttemptDescriptor(runRoot, caseId, entry.name);
    if (descriptor) result.push(descriptor);
  }
  return result;
}

export function createRetryAttempt(previous, input = {}) {
  if (!previous?.runId || !previous.caseId || !previous.attemptId || !previous.experimentId) throw new Error("RETRY_SOURCE_REQUIRED");
  const attemptId = input.attemptId ?? `attempt-${String(nextAttemptNumber(previous.attemptId)).padStart(3, "0")}`;
  return createAttemptDescriptor({
    ...input,
    runId: input.runId ?? previous.runId,
    caseId: input.caseId ?? previous.caseId,
    attemptId,
    experimentId: input.experimentId ?? previous.experimentId,
    inputIdentity: input.inputIdentity ?? previous.inputIdentity,
    budgetSnapshot: input.budgetSnapshot ?? previous.budgetSnapshot,
    mode: "retry",
    retryOf: previous.attemptId,
  });
}

export function createContinueAttempt(previous, input = {}) {
  if (!previous?.runId || !previous.caseId || !previous.attemptId || !previous.experimentId) throw new Error("CONTINUE_SOURCE_REQUIRED");
  if (input.experimentId && input.experimentId !== previous.experimentId) throw new Error("CONTINUE_EXPERIMENT_MISMATCH");
  if (input.inputIdentity && stableStringify(input.inputIdentity) !== stableStringify(previous.inputIdentity)) throw new Error("CONTINUE_INPUT_IDENTITY_MISMATCH");
  return {
    ...previous,
    mode: "continue",
    continuesFrom: previous.attemptId,
    continuedAt: input.continuedAt ?? new Date().toISOString(),
    budgetSnapshot: input.budgetSnapshot ?? previous.budgetSnapshot,
    status: "created",
  };
}

export function assertContinueBudget(previous, current) {
  const before = previous?.budgetSnapshot;
  const after = current?.budgetSnapshot;
  if (!before || !after) return { comparable: false, reason: "budget_snapshot_missing" };
  const keys = ["maxTurns", "maxToolCalls", "timeoutMs", "maxRevisions", "maxExplorationAttempts", "maxResultAttempts", "maxObservedRows"];
  const changed = keys.filter((key) => before[key] !== undefined && after[key] !== undefined && before[key] !== after[key]);
  if (changed.length) throw new Error(`CONTINUE_BUDGET_RESET:${changed.join(",")}`);
  return { comparable: true, changed: [] };
}

export async function writeAttemptStatus(layout, status, extra = {}) {
  const current = JSON.parse(await readFile(layout.attemptPath, "utf8"));
  const next = { ...current, status, ...extra, updatedAt: new Date().toISOString() };
  await writeFile(path.join(layout.root, "attempt-status.json"), `${stableStringify(next)}\n`, "utf8");
  return next;
}

/**
 * Execute one attempt while keeping cleanup failures orthogonal to the
 * already-observed Agent outcome. The callback owns production composition;
 * this module never recreates Pi or Answering state.
 */
export async function runAttempt(experiment, task, attempt, options = {}) {
  const layout = options.layout ?? await createAttemptLayout(options.runRoot ?? ".", createAttemptDescriptor({
    runId: attempt.runId,
    caseId: attempt.caseId ?? task.instance_id ?? task.caseId,
    attemptId: attempt.attemptId,
    traceId: attempt.traceId,
    experimentId: experiment.experimentId,
    mode: attempt.mode ?? "run",
    retryOf: attempt.retryOf,
    continuesFrom: attempt.continuesFrom,
    inputIdentity: attempt.inputIdentity,
    budgetSnapshot: attempt.budgetSnapshot,
  }));
  const execute = options.execute ?? experiment.execute;
  if (typeof execute !== "function") throw new Error("ATTEMPT_EXECUTOR_REQUIRED");
  await writeAttemptStatus(layout, "running", { startedAt: new Date().toISOString() });
  let result;
  let executionError;
  let cleanupError;
  try {
    result = await execute({ experiment, task, attempt: layout.descriptor, layout });
  } catch (error) {
    executionError = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) };
  } finally {
    if (typeof options.cleanup === "function") {
      try { await options.cleanup({ experiment, task, attempt: layout.descriptor, layout, result, executionError }); }
      catch (error) { cleanupError = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) }; }
    }
  }
  const status = executionError ? "failed" : result?.status ?? "completed";
  const finished = await writeAttemptStatus(layout, status, {
    ...(result ? { result } : {}),
    ...(executionError ? { executionError } : {}),
    ...(cleanupError ? { cleanupError } : {}),
    finishedAt: new Date().toISOString(),
  });
  return {
    attempt: layout.descriptor,
    layout,
    result,
    executionError,
    cleanupError,
    status,
    recordComplete: !executionError && !result?.recordIncomplete,
    statusRecord: finished,
  };
}

