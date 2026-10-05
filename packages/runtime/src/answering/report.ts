import type { DecisionPointName, DecisionPoints } from "./decision-points.js";
import type {
  AnswerRevisionRecord,
  AnswerSpec,
  Deviation,
  DeviationProposal,
  Facet,
  ParentBinding,
  QueryTaskRecord,
} from "./model.js";
import { AnsweringError } from "./errors.js";
import { unresolvedChoices, unresolvedHypotheses } from "./qualification.js";
import type { AnsweringTransaction } from "./answering-store.js";
import type { RevisionBody } from "./transition.js";

/**
 * Report Task (ADR-0009): a parent task owns the fields every chart query of a
 * report shares; each chart query copies them from one bound parent Revision
 * and declares only what differs.
 */
export const REPORT_FACETS = ["entity", "filters", "time"] as const;
export const REPORT_POINTS = ["population", "join_multiplicity", "time_field", "window"] as const satisfies readonly DecisionPointName[];

type ReportFacet = typeof REPORT_FACETS[number];
const SHARED_PATHS = new Set<string>([...REPORT_FACETS, ...REPORT_POINTS]);

export interface InheritedFields {
  readonly spec: Pick<AnswerSpec, ReportFacet>;
  readonly decisionPoints: DecisionPoints;
}

function inherit<T>(facet: Facet<T>, binding: ParentBinding): Facet<T> {
  return facet.state === "specified" ? { state: "specified", value: facet.value, basis: { kind: "inherited", taskId: binding.taskId, revisionId: binding.revisionId } } : facet;
}

/** The shared fields of one parent Revision, as a chart query bound to it receives them. */
export function inheritedFields(parent: Pick<AnswerRevisionRecord, "spec">, binding: ParentBinding): InheritedFields {
  return {
    spec: {
      entity: inherit(parent.spec.entity, binding),
      filters: parent.spec.filters.map((facet) => inherit(facet, binding)),
      time: inherit(parent.spec.time, binding),
    },
    decisionPoints: Object.fromEntries(REPORT_POINTS.map((point) => [point, { status: "inherited" as const }])),
  };
}

/** Puts the inherited fields over a body, except the paths the chart query deviates on. */
export function overlayInherited(body: RevisionBody, inherited: InheritedFields, deviations: readonly Deviation[]): RevisionBody {
  const kept = new Set(deviations.map((item) => item.path));
  const spec = { ...body.spec };
  for (const facet of REPORT_FACETS) if (!kept.has(facet)) (spec as Record<string, unknown>)[facet] = inherited.spec[facet];
  const decisionPoints: Record<string, unknown> = { ...(body.decisionPoints ?? {}) };
  for (const point of REPORT_POINTS) if (!kept.has(point)) decisionPoints[point] = inherited.decisionPoints[point];
  return { ...body, spec, decisionPoints: decisionPoints as DecisionPoints };
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

/** Shared paths a transition changed. */
function changedShared(before: RevisionBody, after: RevisionBody): readonly string[] {
  return [
    ...REPORT_FACETS.filter((facet) => !same(before.spec[facet], after.spec[facet])),
    ...REPORT_POINTS.filter((point) => !same(before.decisionPoints?.[point], after.decisionPoints?.[point])),
  ];
}

/**
 * A chart query may change an inherited field only with a reason, which is
 * recorded as a deviation and disclosed (ADR-0009 decision 3). Returns the
 * deviations after the change.
 */
export function guardInheritance(before: RevisionBody, after: RevisionBody, proposals: readonly DeviationProposal[] | undefined, recorded: readonly Deviation[]): readonly Deviation[] {
  const reasons = new Map<string, string>();
  for (const proposal of proposals ?? []) {
    const path = typeof proposal.path === "string" ? proposal.path.trim() : "";
    const reason = typeof proposal.reason === "string" ? proposal.reason.trim() : "";
    if (!SHARED_PATHS.has(path)) throw new AnsweringError("INVALID_REQUEST", `Deviation path ${path} is not a shared field; shared fields are ${[...SHARED_PATHS].join(", ")}`);
    if (!reason) throw new AnsweringError("INVALID_REQUEST", `Deviation from ${path} needs a reason`);
    reasons.set(path, reason);
  }
  const next = new Map(recorded.map((item) => [item.path, item]));
  for (const path of changedShared(before, after)) {
    const reason = reasons.get(path);
    if (!reason && !next.has(path)) {
      throw new AnsweringError("INVALID_REQUEST", `${path} is inherited from the Report Task; changing it in a chart query needs a deviation with a reason, or change it on the Report Task`);
    }
    if (reason) next.set(path, { path, reason });
  }
  return [...next.values()];
}

/** Shared items the Report Task has not handled: they block every chart query's result (ADR-0009 decision 6). */
export function reportUnresolved(revision: AnswerRevisionRecord): readonly string[] {
  const facets = REPORT_FACETS.filter((facet) => {
    const value = revision.spec[facet];
    return Array.isArray(value) ? value.some((item) => item.state === "unknown") : (value as Facet<unknown>).state === "unknown";
  });
  const points = revision.decisionPoints ? REPORT_POINTS.filter((point) => !revision.decisionPoints![point]) : [];
  return [
    ...facets,
    ...points,
    ...unresolvedHypotheses(revision.hypotheses, revision.resolutions),
    ...unresolvedChoices(revision.choices, revision.choiceResolutions),
  ];
}

/**
 * A Report Task never delivers; a chart query delivers only while its bound
 * parent Revision is current and handled. Exploration is never gated here.
 */
export function assertDeliverable(tx: Pick<AnsweringTransaction, "getTask" | "getRevision">, task: QueryTaskRecord): void {
  if (task.role === "report") throw new AnsweringError("REPORT_TASK_NOT_PUBLISHABLE", "A Report Task holds shared fields only; run result queries and publish in its chart queries");
  if (!task.parent) return;
  const parent = tx.getTask(task.parent.taskId);
  if (!parent) throw new AnsweringError("TASK_NOT_FOUND", `Report Task ${task.parent.taskId} was not found`);
  if (parent.currentRevisionId !== task.parent.revisionId) {
    throw new AnsweringError("PARENT_REVISION_STALE", `The Report Task changed since this chart query copied its shared fields; rebind the chart query to Revision ${parent.currentRevisionId}`, { currentRevisionId: parent.currentRevisionId });
  }
  const revision = tx.getRevision(parent.currentRevisionId);
  if (!revision) throw new AnsweringError("REVISION_NOT_FOUND", `Report Task Revision ${parent.currentRevisionId} was not found`);
  const unresolved = reportUnresolved(revision);
  if (unresolved.length > 0) {
    throw new AnsweringError("PARENT_UNRESOLVED", `The Report Task still has unhandled shared items: ${unresolved.join(", ")}; handle them on the Report Task first`, { unresolved });
  }
}
