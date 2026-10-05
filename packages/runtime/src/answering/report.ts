import type { DecisionPointName, DecisionPoints } from "./decision-points.js";
import type {
  AnswerRevisionRecord,
  AnswerSpec,
  ChoiceProbeRecord,
  Deviation,
  DeviationProposal,
  Facet,
  MetricSpec,
  ParentBinding,
  QueryTaskRecord,
} from "./model.js";
import { AnsweringError } from "./errors.js";
import { unresolvedChoices, unresolvedHypotheses } from "./qualification.js";
import { equivalentChoiceIds } from "./choice-probe.js";
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
  /** The Report Task's named metric definitions, as a chart query referencing one receives it. */
  readonly metrics: Readonly<Record<string, Facet<MetricSpec>>>;
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
    metrics: Object.fromEntries(Object.entries(parent.spec.metrics ?? {}).map(([name, facet]) => [name, inherit(facet, binding)])),
  };
}

/**
 * A chart query's metric taken from a Report Task definition (ADR-0009,
 * pending item 1). A definition that states its denominator or count grain
 * also settles those decision points.
 */
export function applyMetricRef(body: RevisionBody, inherited: InheritedFields, name: string): RevisionBody {
  const definition = inherited.metrics[name];
  if (!definition) {
    const names = Object.keys(inherited.metrics);
    throw new AnsweringError("INVALID_REQUEST", `The Report Task defines no metric ${JSON.stringify(name)}; ${names.length > 0 ? `defined metrics: ${names.join(", ")}` : "it defines no metrics"}`);
  }
  const value = definition.state === "specified" ? definition.value : undefined;
  const points: Record<string, unknown> = { ...(body.decisionPoints ?? {}) };
  if (value?.denominator) points.denominator = { status: "inherited" };
  if (value?.countGrain) points.count_grain = { status: "inherited" };
  return { ...body, spec: { ...body.spec, metric: definition }, decisionPoints: points as DecisionPoints };
}

/** Splits a `{ ref }` metric off a spec patch: the reference is resolved by the Runtime, not by the transition. */
export function splitMetricRef<T extends { readonly metric?: unknown }>(spec: T | undefined): { readonly spec: T | undefined; readonly ref?: string } {
  const metric = spec?.metric;
  if (!metric || typeof metric !== "object" || Array.isArray(metric) || !("ref" in metric)) return { spec };
  const ref = typeof (metric as { ref?: unknown }).ref === "string" ? (metric as { ref: string }).ref.trim() : "";
  if (!ref) throw new AnsweringError("INVALID_REQUEST", "metric.ref must name a Report Task metric definition");
  const { metric: _metric, ...rest } = spec as T & Record<string, unknown>;
  return { spec: rest as unknown as T, ref };
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
export function guardInheritance(before: RevisionBody, after: RevisionBody, proposals: readonly DeviationProposal[] | undefined, recorded: readonly Deviation[], metricShared = false): readonly Deviation[] {
  const shared = metricShared ? new Set([...SHARED_PATHS, "metric"]) : SHARED_PATHS;
  const reasons = new Map<string, string>();
  for (const proposal of proposals ?? []) {
    const path = typeof proposal.path === "string" ? proposal.path.trim() : "";
    const reason = typeof proposal.reason === "string" ? proposal.reason.trim() : "";
    if (!shared.has(path)) throw new AnsweringError("INVALID_REQUEST", `Deviation path ${path} is not a shared field; shared fields are ${[...shared].join(", ")}`);
    if (!reason) throw new AnsweringError("INVALID_REQUEST", `Deviation from ${path} needs a reason`);
    reasons.set(path, reason);
  }
  const next = new Map(recorded.map((item) => [item.path, item]));
  const changed = [...changedShared(before, after), ...(metricShared && !same(before.spec.metric, after.spec.metric) ? ["metric"] : [])];
  for (const path of changed) {
    const reason = reasons.get(path);
    if (!reason && !next.has(path)) {
      throw new AnsweringError("INVALID_REQUEST", path === "metric"
        ? "The Report Task defines metrics; reference one with metric: { ref }, or give a deviation reason for a metric of this chart query's own"
        : `${path} is inherited from the Report Task; changing it in a chart query needs a deviation with a reason, or change it on the Report Task`);
    }
    if (reason) next.set(path, { path, reason });
  }
  return [...next.values()];
}

/** Shared items the Report Task has not handled: they block every chart query's result (ADR-0009 decision 6). */
export function reportUnresolved(revision: AnswerRevisionRecord, probes: readonly ChoiceProbeRecord[] = []): readonly string[] {
  const facets = REPORT_FACETS.filter((facet) => {
    const value = revision.spec[facet];
    return Array.isArray(value) ? value.some((item) => item.state === "unknown") : (value as Facet<unknown>).state === "unknown";
  });
  const points = revision.decisionPoints ? REPORT_POINTS.filter((point) => !revision.decisionPoints![point]) : [];
  return [
    ...facets,
    ...points,
    ...unresolvedHypotheses(revision.hypotheses, revision.resolutions),
    // Choices whose probes all match are handled, as at the seal (ADR-0005).
    ...unresolvedChoices(revision.choices, revision.choiceResolutions, equivalentChoiceIds(revision, probes)),
  ];
}

/**
 * A Report Task never delivers; a chart query delivers only while its bound
 * parent Revision is current and handled. Exploration is never gated here.
 */
export function assertDeliverable(tx: Pick<AnsweringTransaction, "getTask" | "getRevision">, task: QueryTaskRecord): void {
  assertParentDeliverable(tx, task);
  // A referenced metric definition the Report Task has not specified blocks only the chart queries that use it.
  const ref = task.parent ? tx.getRevision(task.currentRevisionId)?.metricRef : undefined;
  if (ref && tx.getRevision(tx.getTask(task.parent!.taskId)!.currentRevisionId)?.spec.metrics?.[ref]?.state !== "specified") {
    throw new AnsweringError("PARENT_UNRESOLVED", `The Report Task has not specified metric ${ref}; specify it on the Report Task first`, { unresolved: [`metrics.${ref}`] });
  }
}

function assertParentDeliverable(tx: Pick<AnsweringTransaction, "getTask" | "getRevision">, task: QueryTaskRecord): void {
  if (task.role === "report") throw new AnsweringError("REPORT_TASK_NOT_PUBLISHABLE", "A Report Task holds shared fields only; run result queries and publish in its chart queries");
  if (!task.parent) return;
  const parent = tx.getTask(task.parent.taskId);
  if (!parent) throw new AnsweringError("TASK_NOT_FOUND", `Report Task ${task.parent.taskId} was not found`);
  if (parent.currentRevisionId !== task.parent.revisionId) {
    throw new AnsweringError("PARENT_REVISION_STALE", `The Report Task changed since this chart query copied its shared fields; rebind the chart query to Revision ${parent.currentRevisionId}`, { currentRevisionId: parent.currentRevisionId });
  }
  const revision = tx.getRevision(parent.currentRevisionId);
  if (!revision) throw new AnsweringError("REVISION_NOT_FOUND", `Report Task Revision ${parent.currentRevisionId} was not found`);
  const unresolved = reportUnresolved(revision, parent.choiceProbes ?? []);
  if (unresolved.length > 0) {
    throw new AnsweringError("PARENT_UNRESOLVED", `The Report Task still has unhandled shared items: ${unresolved.join(", ")}; handle them on the Report Task first`, { unresolved });
  }
}
