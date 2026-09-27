import {
  clone,
  type AnswerRevisionRecord,
  type AnswerRevisionView,
  type ChoiceProbeRecord,
  type ChoiceView,
  type QueryTaskRecord,
  type HypothesisView,
  type TaskId,
} from "./model.js";
import { inferredFacets, unresolvedChoices, unresolvedFacets, unresolvedHypotheses } from "./qualification.js";
import { summarizeChoiceProbes } from "./choice-probe.js";
import { undeclaredDecisionPoints } from "./decision-points.js";
import type { ChoiceAdvisory } from "./advisory-ledger.js";
import type { AnsweringDeps } from "./deps.js";

/** What the Runtime knows about Choices beyond the Revision: probes and advice. */
export interface ChoiceContext {
  readonly probes: readonly ChoiceProbeRecord[];
  readonly advice?: (choiceId: string) => ChoiceAdvisory | undefined;
}

/** Model-facing Revision projection: stable ids and handling status, never writable state. */
function hypothesisViews(revision: AnswerRevisionRecord): readonly HypothesisView[] {
  const outcomes = new Map(revision.resolutions.map((item) => [item.hypothesisId as string, item.outcome]));
  return revision.hypotheses.map((hypothesis) => {
    const outcome = outcomes.get(hypothesis.id);
    return {
      id: hypothesis.id,
      kind: hypothesis.kind,
      statement: hypothesis.statement,
      affects: hypothesis.affects,
      status: outcome ?? "unresolved",
    };
  });
}

function choiceViews(revision: AnswerRevisionRecord, choiceContext: ChoiceContext | undefined): readonly ChoiceView[] {
  const resolutions = new Map(revision.choiceResolutions.map((item) => [item.choiceId as string, item]));
  return revision.choices.map((choice) => {
    const resolution = resolutions.get(choice.id);
    const summary = choiceContext ? summarizeChoiceProbes(choice, choiceContext.probes, revision.probeWaivers ?? []) : undefined;
    const advice = choiceContext?.advice?.(choice.id);
    return {
      id: choice.id,
      affects: choice.affects,
      alternatives: choice.alternatives,
      status: resolution?.outcome ?? "unresolved",
      ...(resolution && resolution.outcome !== "equivalent" ? { alternativeId: resolution.alternativeId } : {}),
      ...(resolution && resolution.outcome !== "equivalent" && resolution.rationale ? { rationale: resolution.rationale } : {}),
      ...(resolution && resolution.outcome !== "equivalent" && resolution.adviceOverride ? { adviceOverride: resolution.adviceOverride } : {}),
      ...(summary ? { probes: summary.probes, outputs: summary.outputs } : {}),
      ...(advice ? { advice: { recommendation: advice.recommendation, probabilities: advice.probabilities, ...(advice.lean ? { lean: advice.lean } : {}) } } : {}),
    };
  });
}

/** Probes and advice the Runtime holds for a task; undefined when Choice governance is off. */
export function choiceContextFor(deps: AnsweringDeps, task: Pick<QueryTaskRecord, "taskId" | "choiceProbes">): ChoiceContext | undefined {
  if (!deps.choiceProbes) return undefined;
  const ledger = deps.advisoryLedger;
  return { probes: task.choiceProbes ?? [], ...(ledger ? { advice: (choiceId: string) => ledger.latest(task.taskId, choiceId) } : {}) };
}

/** `choiceContext` is passed only when the Runtime tracks Choice probes; the view then shows outputs and advice. */
export function viewFromRevision(taskId: TaskId, revision: AnswerRevisionRecord, choiceContext?: ChoiceContext): AnswerRevisionView {
  return {
    taskId,
    revisionId: revision.revisionId,
    ...(revision.parentRevisionId ? { parentRevisionId: revision.parentRevisionId } : {}),
    spec: clone(revision.spec),
    hypotheses: clone(hypothesisViews(revision)),
    choices: clone(choiceViews(revision, choiceContext)),
    unresolvedFacets: unresolvedFacets(revision.spec),
    unresolvedHypotheses: unresolvedHypotheses(revision.hypotheses, revision.resolutions),
    unresolvedChoices: unresolvedChoices(revision.choices, revision.choiceResolutions),
    inferredFacets: inferredFacets(revision.spec),
    ...(revision.decisionPoints ? { decisionPoints: clone(revision.decisionPoints), undeclaredDecisionPoints: undeclaredDecisionPoints(revision) } : {}),
    ...(revision.specFeedback ? { specFeedback: clone(revision.specFeedback) } : {}),
  };
}
