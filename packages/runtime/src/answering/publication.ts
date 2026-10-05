import type {
  AnswerRevisionRecord,
  BusinessContext,
  PublicationDisclosure,
  PublicationPermit,
  PublicationReceipt,
  PublishCandidate,
  ResultCandidateRecord,
} from "./model.js";
import { assertTaskAccess } from "./answering-store.js";
import { AnsweringError } from "./errors.js";
import { makeInternalId } from "./internal-ids.js";
import { inferredFacets } from "./qualification.js";
import { assertDeliverable } from "./report.js";
import { fanoutDisclosureSummary } from "./fanout-execution.js";
import { SPEC_FEEDBACK_CHECK_ID, specFeedbackDisclosureSummary } from "./spec-feedback.js";
import { markCandidateCorrupt } from "./result-execution.js";
import { buildPhysicalProfile } from "./physical-profile.js";
import type { PrivateResultObject } from "./result-store.js";
import { now } from "./support.js";
import type { AnsweringDeps } from "./deps.js";

const INLINE_ROW_LIMIT = 10;

/**
 * Everything a Receipt must disclose about the exact published Candidate:
 * provisional choices and hypotheses, inferred facets, fanout observations and SpecFeedback.
 * Disclosure is a record, never an approval.
 */
export function composeDisclosure(revision: AnswerRevisionRecord, candidate: ResultCandidateRecord): PublicationDisclosure | undefined {
  const provisionalChoiceIds = revision.choiceResolutions
    .filter((resolution) => resolution.outcome === "provisional")
    .map((resolution) => resolution.choiceId);
  const provisionalHypothesisIds = revision.resolutions
    .filter((resolution) => resolution.outcome === "provisional")
    .map((resolution) => resolution.hypothesisId);
  const provisionalFacets = [...new Set(revision.hypotheses
    .filter((hypothesis) => provisionalHypothesisIds.includes(hypothesis.id))
    .flatMap((hypothesis) => hypothesis.affects))];
  const fanoutDisclosure = candidate.fanout && (candidate.fanout.status === "finding" || candidate.fanout.status === "unknown")
    ? fanoutDisclosureSummary(candidate.fanout)
    : "";
  const feedbackDisclosure = specFeedbackDisclosureSummary(candidate.coverage?.find((coverage) => coverage.checkId === SPEC_FEEDBACK_CHECK_ID));
  const inferred = inferredFacets(revision.spec);
  const deviations = revision.deviations ?? [];
  if (provisionalChoiceIds.length === 0 && provisionalHypothesisIds.length === 0 && inferred.length === 0 && deviations.length === 0 && !fanoutDisclosure && !feedbackDisclosure) return undefined;
  return {
    required: true,
    provisionalChoiceIds,
    ...(provisionalHypothesisIds.length > 0 ? { provisionalHypothesisIds } : {}),
    ...(inferred.length > 0 ? { inferredFacets: inferred } : {}),
    summary: [
      ...(provisionalChoiceIds.length > 0 ? ["结果包含按字面解释选择的口径；该选择未被权威证据唯一确定。"] : []),
      ...(provisionalHypothesisIds.length > 0 ? [`以下槽位依赖未被合格证据证实的假设：${provisionalFacets.join(", ")}。`] : []),
      ...(inferred.length > 0 ? [`以下槽位为模型推断、未绑定合格证据：${inferred.join(", ")}。`] : []),
      ...(deviations.length > 0 ? [`以下字段偏离报告任务的共享口径：${deviations.map((item) => `${item.path}（${item.reason}）`).join("；")}。`] : []),
      ...(fanoutDisclosure ? [fanoutDisclosure] : []),
      ...(feedbackDisclosure ? [feedbackDisclosure] : []),
    ].join(" "),
    ...(fanoutDisclosure && candidate.fanout ? { fanoutStatus: candidate.fanout.status } : {}),
    ...(deviations.length > 0 ? { deviations } : {}),
  };
}

/** Publish the exact immutable Candidate of the current sealed Revision; SQL is never re-run. */
export async function publishCandidate(deps: AnsweringDeps, input: PublishCandidate, context: BusinessContext): Promise<PublicationReceipt> {
  const candidateId = input.candidateId as unknown as ResultCandidateRecord["candidateId"];
  const taskAndCandidate = await deps.store.transact((tx) => {
    const candidate = tx.getCandidate(candidateId);
    if (!candidate) throw new AnsweringError("CANDIDATE_NOT_FOUND", `Candidate ${input.candidateId} was not found`);
    const task = tx.getTask(candidate.taskId);
    assertTaskAccess(task, context);
    if (task.currentRevisionId !== candidate.revisionId) throw new AnsweringError("PUBLICATION_STALE", "Candidate belongs to an old revision");
    if (candidate.status !== "ready" || !candidate.publishable) throw new AnsweringError("RESULT_INTEGRITY_MISMATCH", "Corrupt Result Candidate cannot be published");
    const revision = tx.getRevision(candidate.revisionId);
    if (!revision || revision.state.state !== "ready") throw new AnsweringError("PUBLICATION_STALE", "Candidate revision is not sealed for publication");
    const existingForTask = task.publicationId ? tx.getReceipt(task.publicationId) : undefined;
    if (existingForTask && existingForTask.candidateId !== candidate.candidateId) {
      throw new AnsweringError("PUBLICATION_ALREADY_EXISTS", "A Query Task already has a publication receipt for this revision", { receiptId: existingForTask.receiptId, candidateId: existingForTask.candidateId });
    }
    const existing = tx.findReceiptByRequest(candidate.taskId, input.requestId) ?? tx.findReceiptByCandidate(candidate.taskId, candidate.candidateId) ?? existingForTask;
    // A replay returns the Receipt already made; only a new publication needs a deliverable Report Task (ADR-0009).
    if (!existing) assertDeliverable(tx, task);
    return { candidate, task, revision, existing, disclosure: composeDisclosure(revision, candidate) };
  }, context);
  if (taskAndCandidate.existing) {
    const requestedFormat = input.format === "auto" ? taskAndCandidate.existing.format : input.format;
    if (requestedFormat !== taskAndCandidate.existing.format) throw new AnsweringError("PUBLICATION_ALREADY_EXISTS", "A different format was already published for this request");
    try {
      await deps.resultStore.openAuthorized(taskAndCandidate.candidate.resultRef, taskAndCandidate.existing, context);
    } catch {
      await markCandidateCorrupt(deps, taskAndCandidate.candidate, context);
      throw new AnsweringError("RESULT_INTEGRITY_MISMATCH", "Published Receipt references a missing or changed private result");
    }
    return taskAndCandidate.existing;
  }
  const permit: PublicationPermit = {
    candidateId: taskAndCandidate.candidate.candidateId,
    taskId: taskAndCandidate.candidate.taskId,
    revisionId: taskAndCandidate.candidate.revisionId,
    resultRef: taskAndCandidate.candidate.resultRef,
    contentHash: taskAndCandidate.candidate.contentHash,
    policyVersion: "answering-publication-v1",
  };
  let result: PrivateResultObject;
  try {
    const opened = await deps.resultStore.openPrivate(permit.resultRef, context);
    if (!opened || opened.contentHash !== permit.contentHash || opened.resultRef !== permit.resultRef) throw new Error("RESULT_INTEGRITY_MISMATCH");
    result = opened;
  } catch {
    await markCandidateCorrupt(deps, taskAndCandidate.candidate, context);
    throw new AnsweringError("RESULT_INTEGRITY_MISMATCH", "Result Candidate content hash does not match ResultStore");
  }
  const format = input.format === "auto" ? (result.rowCount <= INLINE_ROW_LIMIT ? "inline" : "csv") : input.format;
  if (format === "inline" && result.rowCount > INLINE_ROW_LIMIT) throw new AnsweringError("INLINE_RESULT_TOO_LARGE", "Inline publication is limited to ten rows");
  // The published artifact is always CSV; format only decides whether the rows are also echoed inline.
  const encoded = await deps.resultStore.encodeCsv(result.resultRef, context);
  const receiptId = makeInternalId("publication") as unknown as PublicationReceipt["receiptId"];
  const receipt: PublicationReceipt = {
    receiptId,
    taskId: permit.taskId,
    principalId: context.principal.id,
    sessionId: context.sessionId,
    candidateId: permit.candidateId,
    revisionId: permit.revisionId,
    resultRef: permit.resultRef,
    format,
    publicRef: `/api/runtime/publications/${receiptId}?session_id=${encodeURIComponent(context.sessionId)}`,
    contentHash: permit.contentHash,
    presentationContentHash: encoded.contentHash,
    ...(taskAndCandidate.candidate.coverage ? { coverage: taskAndCandidate.candidate.coverage } : {}),
    ...(taskAndCandidate.candidate.fanout ? { fanout: taskAndCandidate.candidate.fanout } : {}),
    ...(taskAndCandidate.disclosure ? { disclosure: taskAndCandidate.disclosure } : {}),
    // Profiled from the integrity-checked object; it is not part of either content hash.
    physicalProfile: buildPhysicalProfile(result),
    policyVersion: permit.policyVersion,
    createdByInvocationId: context.invocationId,
    requestId: input.requestId,
    createdAt: now(),
  };
  return deps.store.transact((tx) => {
    const currentTask = tx.getTask(receipt.taskId);
    assertTaskAccess(currentTask, context);
    if (currentTask.currentRevisionId !== receipt.revisionId) throw new AnsweringError("PUBLICATION_STALE", "Revision changed during publication");
    const existing = tx.findReceiptByRequest(receipt.taskId, receipt.requestId) ?? tx.findReceiptByCandidate(receipt.taskId, receipt.candidateId);
    if (existing) return existing;
    // The Report Task may have changed while the bytes were encoded.
    assertDeliverable(tx, currentTask);
    tx.putReceipt(receipt);
    tx.putTask({ ...currentTask, publicationId: receipt.receiptId, lifecycle: "published", updatedAt: receipt.createdAt });
    return receipt;
  }, context);
}
