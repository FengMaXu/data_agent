import {
  type AdviceOverride,
  type AdviceOverrideProposal,
  type AnswerRevisionRecord,
  type AnswerSpec,
  type AnswerSpecProposal,
  type Choice,
  type ChoiceId,
  type ChoiceProbeRecord,
  type ChoiceProposal,
  type ChoiceResolution,
  type DispositionProposal,
  type Evidence,
  type Facet,
  type FacetName,
  type FilterSpec,
  type GroupingSpec,
  type Hypothesis,
  type HypothesisId,
  type HypothesisProposal,
  type MetricSpec,
  type NonEmpty,
  type ProbeWaiver,
  type ProbeWaiverProposal,
  type QualifiedEvidenceId,
  type Resolution,
  type Supersession,
  isFacetName,
  isHypothesisKind,
} from "./model.js";
import { AnsweringError } from "./errors.js";
import { makeInternalId } from "./internal-ids.js";
import {
  QualificationError,
  assertChoiceAlternative,
  assertContinuity,
  isAdmissibleProof,
  qualifyEvidence,
} from "./qualification.js";
import { normalizeQuoteText } from "./evidence-admission.js";
import { summarizeChoiceProbes } from "./choice-probe.js";
import type { ChoiceAdvisory } from "./advisory-ledger.js";
import { applyDecisionPoints, type DecisionPointProposal, type DecisionPoints } from "./decision-points.js";

/**
 * Runtime-owned Answer Spec state transitions (ADR-0004). The model proposes a
 * draft (begin) or a delta (revise); these pure functions decide the next
 * Revision body. Nothing leaves a Revision by omission.
 */
export type RevisionBody = Pick<AnswerRevisionRecord, "spec" | "hypotheses" | "choices" | "resolutions" | "choiceResolutions" | "probeWaivers" | "decisionPoints">;

/**
 * Choice decisions the Runtime can check against executed probes (ADR-0005).
 * Absent: legacy behaviour, a Choice may be decided without probes.
 */
export interface ChoiceGovernance {
  readonly probes: readonly ChoiceProbeRecord[];
  /** Latest compare_hypotheses advice for a Choice, from the Advisory Ledger. */
  readonly advice?: (choiceId: string) => ChoiceAdvisory | undefined;
  /** An advisor is configured: decisive Choices on core facets need advice before a decision. */
  readonly adviceRequired?: boolean;
  /** Whether an unverified decision may settle the material population (ADR-0006). */
  readonly populationDecisions?: PopulationDecisions;
}

/** require_evidence: a clarification path exists; allow_disclosed: none does, so disclose instead. */
export type PopulationDecisions = "require_evidence" | "allow_disclosed";

const POPULATION_FACETS = new Set<FacetName>(["entity", "filters"]);

/**
 * The single decision (ADR-0006): the Runtime, not the model, decides whether
 * it is verified. Unknown evidence ids are rejected; evidence that exists but
 * cannot qualify the alternative only makes the decision unverified.
 */
function decideChoice(
  choice: Choice,
  alternativeId: string,
  proposal: { readonly rationale?: string | undefined; readonly evidenceIds?: readonly string[] | undefined; readonly adviceOverride?: AdviceOverrideProposal | undefined },
  populationDecisions: PopulationDecisions,
  resolveEvidence: EvidenceResolver,
  label: string,
): ChoiceResolution {
  const rationale = decisionRationale(proposal.rationale, label, "why this alternative fits the request best and what excludes the others");
  const refs = Array.isArray(proposal.evidenceIds) ? proposal.evidenceIds : [];
  const cited = resolveEvidenceRefs(refs, resolveEvidence, label);
  const synthetic: Hypothesis = {
    id: makeInternalId("choice-proof") as unknown as HypothesisId,
    kind: "business_semantics",
    statement: choice.alternatives.find((item) => item.id === alternativeId)?.statement ?? "choice",
    affects: choice.affects,
    basis: "choice decision",
    impact: "choice decision",
  };
  const proof = cited.flatMap((evidence) => {
    try {
      return [qualifyEvidence(synthetic, evidence)];
    } catch (error) {
      if (error instanceof QualificationError) return [];
      throw error;
    }
  });
  const alternative = alternativeId as Choice["alternatives"][number]["id"];
  if (proof.length > 0) {
    return { outcome: "selected", choiceId: choice.id, alternativeId: alternative, proof: proof as unknown as NonEmpty<QualifiedEvidenceId>, rationale };
  }
  if (populationDecisions === "require_evidence" && choice.affects.some((facet) => POPULATION_FACETS.has(facet))) {
    transitionInvalid(`${label} changes the material population and none of the cited evidence qualifies it; cite a verbatim request, business document or user confirmation, or ask the user`);
  }
  return {
    outcome: "provisional",
    choiceId: choice.id,
    alternativeId: alternative,
    disclosureRequired: true,
    rationale,
    ...(cited.length > 0 ? { citedEvidenceIds: cited.map((evidence) => evidence.id) } : {}),
  };
}

/** Facets whose Choices need advice before a decision when an advisor is configured. */
const ADVICE_FACETS = new Set<FacetName>(["metric", "entity", "filters", "groupBy", "time"]);

/** Advice applies only to the alternative set it compared. */
function currentAdvice(choice: Choice, governance: ChoiceGovernance): ChoiceAdvisory | undefined {
  const advice = governance.advice?.(choice.id);
  if (!advice) return undefined;
  const ids = choice.alternatives.map((alternative) => alternative.id as string);
  return advice.alternativeIds.length === ids.length && advice.alternativeIds.every((id, index) => id === ids[index]) ? advice : undefined;
}

/**
 * ADR-0005 rules for deciding a Choice: every alternative's output is known,
 * a provisional decision carries a rationale, decisive core Choices were
 * compared, and departing from a clear lean needs a reason plus evidence.
 */
function governDecision(
  choice: Choice,
  alternativeId: string,
  action: "select" | "provisional",
  proposal: { readonly rationale?: string | undefined; readonly adviceOverride?: AdviceOverrideProposal | undefined },
  governance: ChoiceGovernance | undefined,
  waivers: readonly ProbeWaiver[],
  resolveEvidence: EvidenceResolver,
  label: string,
): { readonly rationale?: string; readonly adviceOverride?: AdviceOverride } {
  if (!governance) return {};
  assertProbeCoverage(choice, governance, waivers, label);
  const rationale = action === "provisional"
    ? decisionRationale(proposal.rationale, `${label} (provisional)`, "why this alternative fits the request best and what excludes the others")
    : undefined;
  const summary = summarizeChoiceProbes(choice, governance.probes, waivers);
  const advice = currentAdvice(choice, governance);
  if (!advice && governance.adviceRequired && summary.outputs !== "identical" && choice.affects.some((facet) => ADVICE_FACETS.has(facet))) {
    transitionInvalid(`${label}: the alternatives produce different or unknown outputs; call compare_hypotheses with choiceId "${choice.id}" before deciding`);
  }
  const lean = advice?.lean;
  if (!lean || lean.alternativeId === alternativeId) return rationale ? { rationale } : {};
  const override = proposal.adviceOverride;
  const reason = typeof override?.reason === "string" ? override.reason.trim() : "";
  const refs = Array.isArray(override?.evidenceIds) ? override.evidenceIds : [];
  if (reason.length < MIN_RATIONALE_LENGTH || refs.length === 0) {
    transitionInvalid(`${label}: compare_hypotheses leaned to alternative ${lean.alternativeId} (p=${lean.probability}); choosing ${alternativeId} requires adviceOverride with a reason and at least one evidence id showing why the lean is wrong`);
  }
  const evidenceIds = refs.map((ref) => {
    const evidence = resolveEvidence(ref);
    if (!evidence) evidenceRejected(`${label}: adviceOverride references unknown evidence ${ref}`);
    return evidence.id;
  }) as unknown as AdviceOverride["evidenceIds"];
  return { ...(rationale ? { rationale } : {}), adviceOverride: { reason, evidenceIds } };
}

export interface RevisionTransition extends RevisionBody {
  readonly supersessions: readonly Supersession[];
}

/**
 * Resolves an evidence reference: same-call localId first, then a registered
 * Evidence id. `localIds` lists the evidence localIds this call supplied, so a
 * failed reference can say what the call actually carried.
 */
export type EvidenceResolver = ((ref: string) => Evidence | undefined) & { readonly localIds?: readonly string[] };

export interface BeginTransitionInput {
  readonly spec: AnswerSpecProposal;
  readonly hypotheses?: readonly HypothesisProposal[];
  readonly choices?: readonly ChoiceProposal[];
  readonly notProbeable?: readonly ProbeWaiverProposal[];
  readonly decisionPoints?: readonly DecisionPointProposal[];
}

export interface ReviseTransitionInput {
  readonly spec?: AnswerSpecProposal;
  readonly addHypotheses?: readonly HypothesisProposal[];
  readonly addChoices?: readonly ChoiceProposal[];
  readonly dispositions?: readonly DispositionProposal[];
  readonly notProbeable?: readonly ProbeWaiverProposal[];
  readonly decisionPoints?: readonly DecisionPointProposal[];
}

/** Decision points apply to governed revisions; legacy revisions stay exempt unless points are declared. */
function nextDecisionPoints(
  previous: DecisionPoints | undefined,
  proposals: readonly DecisionPointProposal[] | undefined,
  governance: ChoiceGovernance | undefined,
  body: Pick<RevisionBody, "choices" | "hypotheses" | "resolutions">,
  created: Pick<CreatedItems, "choicesByLocalId" | "hypothesesByLocalId">,
  resolveEvidence: EvidenceResolver,
): DecisionPoints | undefined {
  const base = previous ?? (governance || (proposals && proposals.length > 0) ? {} : undefined);
  if (!base) return undefined;
  const choices = new Map(body.choices.map((item) => [item.id as string, item]));
  const hypotheses = new Map(body.hypotheses.map((item) => [item.id as string, item]));
  return applyDecisionPoints(base, proposals ?? [], {
    choices: body.choices,
    hypotheses: body.hypotheses,
    resolutions: body.resolutions,
    choiceByRef: (ref) => created.choicesByLocalId.get(ref) ?? choices.get(ref),
    hypothesisByRef: (ref) => created.hypothesesByLocalId.get(ref) ?? hypotheses.get(ref),
    evidenceExists: (ref) => resolveEvidence(ref) !== undefined,
    invalid: transitionInvalid,
  });
}

const OUTPUT_ROW_MODES = ["scalar", "top_n", "grouped", "full", "detail"] as const;
type OutputMode = (typeof OUTPUT_ROW_MODES)[number];
type ItemId = HypothesisId | ChoiceId;

function invalid(message: string): never {
  throw new AnsweringError("INVALID_REQUEST", message);
}

function transitionInvalid(message: string): never {
  throw new AnsweringError("SPEC_TRANSITION_INVALID", message);
}

function evidenceRejected(message: string): never {
  throw new AnsweringError("EVIDENCE_REJECTED", message);
}

export function requiredLocalId(value: string, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) invalid(`${label} must not be empty`);
  return normalized;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function optionalTrimmedString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.trim();
}

/** Parse the output facet, naming the offending part so the model can fix it in one retry. */
function parseOutput(value: unknown): { rowMode?: OutputMode; rowCount?: number; columns?: readonly string[] } {
  const body = asRecord(value);
  if (!body) invalid("Invalid output facet value: write an object { rowMode?, rowCount?, columns? }");
  const rowMode = body.rowMode;
  const rowCount = body.rowCount;
  const columns = body.columns;
  if (rowMode !== undefined && !(OUTPUT_ROW_MODES as readonly unknown[]).includes(rowMode)) {
    invalid(`Invalid output.rowMode ${JSON.stringify(rowMode)}: use one of ${OUTPUT_ROW_MODES.join(", ")}`);
  }
  if (rowCount !== undefined && (!Number.isSafeInteger(rowCount) || Number(rowCount) < 0)) invalid(`Invalid output.rowCount ${JSON.stringify(rowCount)}: use a non-negative integer`);
  if (columns !== undefined && (!Array.isArray(columns) || columns.some((item) => typeof item !== "string"))) invalid("Invalid output.columns: use an array of column-name strings");
  if (rowMode === undefined && rowCount === undefined && columns === undefined) invalid("Invalid output facet value: set at least one of rowMode, rowCount, columns");
  return {
    ...(rowMode !== undefined ? { rowMode: rowMode as OutputMode } : {}),
    ...(rowCount !== undefined ? { rowCount: Number(rowCount) } : {}),
    ...(columns !== undefined ? { columns: [...columns as string[]] } : {}),
  };
}

function invalidFacet(facet: FacetName): never {
  return invalid(`Invalid ${facet} facet value`);
}

function normalizeFacetValue<T>(facet: FacetName, value: unknown): T {
  if (facet === "entity") {
    if (typeof value === "string" && value.trim()) return { name: value.trim() } as T;
    const record = asRecord(value);
    if (record && typeof record.name === "string" && record.name.trim()) {
      if (record.keyColumns !== undefined && (!Array.isArray(record.keyColumns) || record.keyColumns.some((item) => typeof item !== "string" || !item.trim()))) invalidFacet(facet);
      return { name: record.name.trim(), ...(Array.isArray(record.keyColumns) ? { keyColumns: record.keyColumns.map((item) => String(item).trim()) } : {}) } as T;
    }
  }
  if (facet === "metric") {
    if (typeof value === "string" && value.trim()) return { kind: value.trim() } as T;
    const record = asRecord(value);
    if (record && typeof record.kind === "string" && record.kind.trim()) {
      const optional = ["expression", "unit", "denominator", "countGrain"] as const;
      const values = Object.fromEntries(optional.flatMap((key) => {
        const value = optionalTrimmedString(record[key]);
        if (record[key] !== undefined && !value) invalidFacet(facet);
        return value ? [[key, value]] : [];
      }));
      return { kind: record.kind.trim(), ...values } as T;
    }
  }
  if (facet === "filters" || facet === "groupBy") {
    const record = asRecord(value);
    const expression = typeof value === "string" ? value.trim() : typeof record?.expression === "string" ? record.expression.trim() : "";
    if (expression) return { expression } as T;
  }
  if (facet === "time") {
    if (typeof value === "string" && value.trim()) return { expression: value.trim() } as T;
    const record = asRecord(value);
    const boundaries = new Set(["inclusive", "exclusive", "mixed", "unspecified"]);
    if (record && typeof record.expression === "string" && record.expression.trim()
      && (record.boundary === undefined || boundaries.has(String(record.boundary)))) {
      return { expression: record.expression.trim(), ...(record.boundary !== undefined ? { boundary: record.boundary as "inclusive" | "exclusive" | "mixed" | "unspecified" } : {}) } as T;
    }
  }
  if (facet === "ranking") {
    const record = asRecord(value);
    const tiePolicies = new Set(["strict", "include_ties", "unspecified"]);
    if (record && Number.isSafeInteger(record.n) && Number(record.n) > 0 && typeof record.orderBy === "string" && record.orderBy.trim()
      && (record.tiePolicy === undefined || tiePolicies.has(String(record.tiePolicy)))) {
      return { n: Number(record.n), orderBy: record.orderBy.trim(), ...(record.tiePolicy !== undefined ? { tiePolicy: record.tiePolicy as "strict" | "include_ties" | "unspecified" } : {}) } as T;
    }
  }
  if (facet === "output") return parseOutput(value) as T;
  return invalidFacet(facet);
}

function resolveEvidenceRefs(refs: readonly string[], resolve: EvidenceResolver, label: string): Evidence[] {
  return refs.map((ref) => {
    const evidence = resolve(ref);
    if (!evidence) {
      const locals = resolve.localIds ?? [];
      const carried = locals.length > 0
        ? `this call's evidence localIds are ${locals.join(", ")}`
        : "this call carries no evidence localIds (the top-level evidence array is missing or has none)";
      evidenceRejected(`${label} references unknown evidence ${ref}; ${carried}. Add ${ref} to the top-level evidence array in this same call, or use a returned Evidence id`);
    }
    return evidence;
  });
}

/** `known` describes what a reference could have named, for the error when it names nothing. */
type HypothesisResolver = ((ref: string) => Hypothesis | undefined) & { readonly known?: () => string };

interface ReferenceCatalog {
  readonly added: ReadonlyMap<string, { readonly statement?: string; readonly alternatives?: readonly { readonly statement: string }[] }>;
  readonly existing: readonly (Hypothesis | Choice)[];
}

function itemLabel(item: { readonly statement?: string; readonly alternatives?: readonly { readonly statement: string }[] }): string {
  const text = item.statement ?? item.alternatives?.map((alternative) => alternative.statement).join(" | ") ?? "";
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

/**
 * A reference that resolves to nothing is usually a localId from an earlier
 * call, which the Runtime has since replaced with an id. Listing both sides,
 * with each item's statement, lets the model map the one to the other.
 */
function describeReferences(catalog: ReferenceCatalog): string {
  const added = [...catalog.added].map(([local, item]) => `${local} (${itemLabel(item)})`);
  return [
    added.length > 0 ? `localIds added in this call: ${added.join("; ")}` : "this call adds no localIds",
    describeExisting(catalog.existing),
  ].join(". ");
}

function describeExisting(items: readonly (Hypothesis | Choice)[]): string {
  const existing = items.map((item) => `${item.id} (${itemLabel(item)})`);
  return `${existing.length > 0 ? `existing ids: ${existing.join("; ")}` : "no existing items"}. A localId from an earlier call is not valid now; use the id it was given`;
}

function hypothesisResolver(resolve: (ref: string) => Hypothesis | undefined, catalog: ReferenceCatalog): HypothesisResolver {
  return Object.assign(resolve, { known: () => describeReferences(catalog) });
}

function proposalFacet<T>(value: unknown, facet: FacetName, hypothesisRef: HypothesisResolver, resolveEvidence: EvidenceResolver): Facet<T> {
  if (value === undefined || value === null || value === "") return { state: "unknown" };
  const record = asRecord(value);
  if (record?.state === "unknown") return { state: "unknown" };
  if (record?.state === "not_applicable") return { state: "not_applicable" };
  const wrapped = record && "value" in record;
  const raw = wrapped ? record.value : value;
  if (raw === null || raw === undefined || raw === "") return { state: "unknown" };
  const hypothesisLocalId = wrapped && typeof record.hypothesisId === "string" ? record.hypothesisId : undefined;
  const evidenceIds = wrapped && Array.isArray(record.evidenceIds) ? record.evidenceIds : undefined;
  if (hypothesisLocalId && evidenceIds) invalid(`${facet} facet cannot bind both a hypothesis and evidence`);
  if (hypothesisLocalId) {
    const hypothesis = hypothesisRef(hypothesisLocalId);
    if (!hypothesis) invalid(`Unknown hypothesis ${hypothesisLocalId} for ${facet}${hypothesisRef.known ? `; ${hypothesisRef.known()}` : ""}`);
    return { state: "specified", value: normalizeFacetValue<T>(facet, raw), basis: { kind: "hypothesis", hypothesisId: hypothesis.id } };
  }
  if (evidenceIds) {
    if (evidenceIds.length === 0 || evidenceIds.some((item) => typeof item !== "string")) invalid(`${facet} facet evidenceIds must be non-empty strings`);
    const evidence = resolveEvidenceRefs(evidenceIds as string[], resolveEvidence, `${facet} facet`);
    const inadmissible = evidence.find((item) => !isAdmissibleProof(item));
    if (inadmissible) evidenceRejected(`${facet} facet cites ${inadmissible.id}, which has no Runtime-verified quote`);
    return { state: "specified", value: normalizeFacetValue<T>(facet, raw), basis: { kind: "evidence", evidenceIds: evidence.map((item) => item.id) as unknown as NonEmpty<Evidence["id"]> } };
  }
  return { state: "specified", value: normalizeFacetValue<T>(facet, raw), basis: { kind: "inference" } };
}

function listFacet<T>(value: unknown, facet: "filters" | "groupBy", hypothesisRef: HypothesisResolver, resolveEvidence: EvidenceResolver): readonly Facet<T>[] {
  return Array.isArray(value)
    ? value.map((item) => proposalFacet<T>(item, facet, hypothesisRef, resolveEvidence))
    : [{ state: "unknown" }];
}

const METRIC_NAME = /^[A-Za-z0-9_一-鿿-]{1,64}$/;

/** Named metric definitions: a present name replaces its definition, null removes it. */
function patchMetrics(previous: AnswerSpec["metrics"], patch: unknown, hypothesisRef: HypothesisResolver, resolveEvidence: EvidenceResolver): AnswerSpec["metrics"] {
  const entries = asRecord(patch);
  if (!entries) invalid("metrics must map metric names to definitions");
  const next: Record<string, Facet<MetricSpec>> = { ...(previous ?? {}) };
  for (const [rawName, value] of Object.entries(entries)) {
    const name = rawName.trim();
    if (!METRIC_NAME.test(name)) invalid(`Metric name ${JSON.stringify(rawName)} must be 1-64 letters, digits, _ or -`);
    if (value === null) delete next[name];
    else next[name] = proposalFacet<MetricSpec>(value, "metric", hypothesisRef, resolveEvidence);
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function buildSpec(proposal: AnswerSpecProposal, hypothesisRef: HypothesisResolver, resolveEvidence: EvidenceResolver): AnswerSpec {
  const metrics = proposal.metrics !== undefined ? patchMetrics(undefined, proposal.metrics, hypothesisRef, resolveEvidence) : undefined;
  return {
    entity: proposalFacet(proposal.entity, "entity", hypothesisRef, resolveEvidence),
    metric: proposalFacet<MetricSpec>(proposal.metric, "metric", hypothesisRef, resolveEvidence),
    filters: listFacet<FilterSpec>(proposal.filters, "filters", hypothesisRef, resolveEvidence),
    groupBy: listFacet<GroupingSpec>(proposal.groupBy, "groupBy", hypothesisRef, resolveEvidence),
    time: proposalFacet(proposal.time, "time", hypothesisRef, resolveEvidence),
    ranking: proposalFacet(proposal.ranking, "ranking", hypothesisRef, resolveEvidence),
    output: proposalFacet(proposal.output, "output", hypothesisRef, resolveEvidence),
    ...(metrics ? { metrics } : {}),
  };
}

/** Only keys present in the patch replace the carried facet; omitted keys keep value and basis. */
function patchSpec(previous: AnswerSpec, patch: AnswerSpecProposal, hypothesisRef: HypothesisResolver, resolveEvidence: EvidenceResolver): AnswerSpec {
  const has = (key: keyof AnswerSpecProposal) => Object.prototype.hasOwnProperty.call(patch, key);
  const metrics = has("metrics") ? patchMetrics(previous.metrics, patch.metrics, hypothesisRef, resolveEvidence) : previous.metrics;
  return {
    entity: has("entity") ? proposalFacet(patch.entity, "entity", hypothesisRef, resolveEvidence) : previous.entity,
    metric: has("metric") ? proposalFacet<MetricSpec>(patch.metric, "metric", hypothesisRef, resolveEvidence) : previous.metric,
    filters: has("filters") ? listFacet<FilterSpec>(patch.filters, "filters", hypothesisRef, resolveEvidence) : previous.filters,
    groupBy: has("groupBy") ? listFacet<GroupingSpec>(patch.groupBy, "groupBy", hypothesisRef, resolveEvidence) : previous.groupBy,
    time: has("time") ? proposalFacet(patch.time, "time", hypothesisRef, resolveEvidence) : previous.time,
    ranking: has("ranking") ? proposalFacet(patch.ranking, "ranking", hypothesisRef, resolveEvidence) : previous.ranking,
    output: has("output") ? proposalFacet(patch.output, "output", hypothesisRef, resolveEvidence) : previous.output,
    ...(metrics ? { metrics } : {}),
  };
}

function affectsList(affects: readonly unknown[], label: string): NonEmpty<FacetName> {
  if (!Array.isArray(affects) || affects.length === 0 || affects.some((facet) => !isFacetName(facet))) invalid(`Invalid ${label}`);
  return [...new Set(affects as FacetName[])] as unknown as NonEmpty<FacetName>;
}

/** Every cited reference must qualify; a single unqualified citation rejects the call with its reason. */
function qualifyAll(hypothesis: Hypothesis, refs: readonly string[], resolve: EvidenceResolver, label: string): NonEmpty<QualifiedEvidenceId> {
  if (refs.length === 0) evidenceRejected(`${label} requires at least one qualifying evidence reference`);
  const qualified = resolveEvidenceRefs(refs, resolve, label).map((evidence) => {
    try {
      return qualifyEvidence(hypothesis, evidence);
    } catch (error) {
      if (error instanceof QualificationError) evidenceRejected(`${label}: ${error.message}`);
      throw error;
    }
  });
  return qualified as unknown as NonEmpty<QualifiedEvidenceId>;
}

/**
 * Support is one action (ADR-0006 applied to Hypotheses): the Runtime, not the
 * model, decides whether it is verified. Unknown evidence ids are rejected;
 * evidence that exists but cannot qualify the hypothesis only makes the
 * support unverified and disclosed. A clarification path can settle business
 * meaning, so an unverified business-semantics support of the population is
 * still rejected there.
 */
function supportHypothesis(hypothesis: Hypothesis, refs: readonly string[], populationDecisions: PopulationDecisions, resolve: EvidenceResolver, label: string, assumed = false): Resolution {
  if (refs.length === 0 && !assumed) evidenceRejected(`${label} requires at least one evidence reference`);
  const cited = resolveEvidenceRefs(refs, resolve, label);
  const reasons: string[] = [];
  const proof = cited.flatMap((evidence) => {
    try {
      return [qualifyEvidence(hypothesis, evidence)];
    } catch (error) {
      if (!(error instanceof QualificationError)) throw error;
      reasons.push(error.message);
      return [];
    }
  });
  if (proof.length > 0) return { outcome: "supported", hypothesisId: hypothesis.id, proof: proof as unknown as NonEmpty<QualifiedEvidenceId> };
  if (populationDecisions === "require_evidence" && hypothesis.kind === "business_semantics" && hypothesis.affects.some((facet) => POPULATION_FACETS.has(facet))) {
    transitionInvalid(`${label} settles the material population and none of the cited evidence qualifies it${reasons.length > 0 ? ` (${reasons.join("; ")})` : ""}; cite a verbatim request, business document or user confirmation, or ask the user`);
  }
  return { outcome: "provisional", hypothesisId: hypothesis.id, disclosureRequired: true, citedEvidenceIds: cited.map((evidence) => evidence.id) };
}

/** Choice selection applies the business-semantics authority matrix through a non-persisted synthetic Hypothesis. */
function qualifyChoiceSelection(choice: Choice, alternativeId: string, refs: readonly string[], resolve: EvidenceResolver, label: string): NonEmpty<QualifiedEvidenceId> {
  const synthetic: Hypothesis = {
    id: makeInternalId("choice-proof") as unknown as HypothesisId,
    kind: "business_semantics",
    statement: choice.alternatives.find((item) => item.id === alternativeId)?.statement ?? "choice",
    affects: choice.affects,
    basis: "choice selection",
    impact: "choice selection",
  };
  return qualifyAll(synthetic, refs, resolve, label);
}

const MIN_RATIONALE_LENGTH = 20;

/**
 * A verified quote only proves the text exists. Selecting one alternative also
 * needs the argument for why that evidence excludes the others; without one the
 * choice stays unresolved or becomes a disclosed provisional selection.
 */
function selectionRationale(value: unknown, label: string): string {
  const rationale = typeof value === "string" ? value.trim() : "";
  if (rationale.length < MIN_RATIONALE_LENGTH) {
    transitionInvalid(`${label} requires a rationale explaining why the cited evidence rules out every other alternative; if it cannot, keep the choice unresolved or make a disclosed provisional selection`);
  }
  return rationale;
}

function decisionRationale(value: unknown, label: string, expectation: string): string {
  const rationale = typeof value === "string" ? value.trim() : "";
  if (rationale.length < MIN_RATIONALE_LENGTH) transitionInvalid(`${label} requires a rationale: ${expectation}`);
  return rationale;
}

function hypothesisKey(kind: string, statement: string): string {
  return `${kind}\u0000${normalizeQuoteText(statement).toLowerCase()}`;
}

function choiceKey(statements: readonly string[]): string {
  return [...statements].map((statement) => normalizeQuoteText(statement).toLowerCase()).sort().join("\u0000");
}

interface CreatedItems {
  readonly hypotheses: readonly Hypothesis[];
  readonly choices: readonly Choice[];
  readonly resolutions: readonly Resolution[];
  readonly choiceResolutions: readonly ChoiceResolution[];
  readonly hypothesesByLocalId: ReadonlyMap<string, Hypothesis>;
  readonly choicesByLocalId: ReadonlyMap<string, Choice>;
  readonly alternativesByChoiceLocalId: ReadonlyMap<string, ReadonlyMap<string, Choice["alternatives"][number]["id"]>>;
}

function createItems(
  hypothesisInputs: readonly HypothesisProposal[],
  choiceInputs: readonly ChoiceProposal[],
  resolveEvidence: EvidenceResolver,
  existing: { readonly hypotheses: readonly Hypothesis[]; readonly choices: readonly Choice[] },
  populationDecisions: PopulationDecisions = "require_evidence",
): CreatedItems {
  const existingIds = new Set<string>([...existing.hypotheses.map((item) => item.id), ...existing.choices.map((item) => item.id)]);
  const existingHypothesisKeys = new Map(existing.hypotheses.map((item) => [hypothesisKey(item.kind, item.statement), item.id]));
  const existingChoiceKeys = new Map(existing.choices.map((item) => [choiceKey(item.alternatives.map((alternative) => alternative.statement)), item.id]));
  const localIds = new Set<string>();
  const claimLocal = (value: string, label: string) => {
    const local = requiredLocalId(value, label);
    if (localIds.has(local)) invalid(`Duplicate localId ${local}`);
    if (existingIds.has(local)) invalid(`localId ${local} collides with an existing Runtime id`);
    localIds.add(local);
    return local;
  };

  const hypothesesByLocalId = new Map<string, Hypothesis>();
  const resolutions: Resolution[] = [];
  for (const input of hypothesisInputs) {
    const local = claimLocal(input.localId, "hypothesis.localId");
    if (!isHypothesisKind(input.kind) || !input.statement?.trim() || !input.basis?.trim() || !input.impact?.trim()) invalid(`Invalid hypothesis ${local}`);
    const duplicate = existingHypothesisKeys.get(hypothesisKey(input.kind, input.statement));
    if (duplicate) transitionInvalid(`Hypothesis ${local} repeats existing ${duplicate}; reference or dispose of the existing id instead of resubmitting it`);
    const hypothesis: Hypothesis = {
      id: makeInternalId("hypothesis") as unknown as HypothesisId,
      kind: input.kind,
      statement: input.statement.trim(),
      affects: affectsList(input.affects, `hypothesis ${local} affects`),
      basis: input.basis.trim(),
      impact: input.impact.trim(),
    };
    hypothesesByLocalId.set(local, hypothesis);
    if ((input.proposedEvidenceIds && input.proposedEvidenceIds.length > 0) || input.assumed === true) {
      resolutions.push(supportHypothesis(hypothesis, input.proposedEvidenceIds ?? [], populationDecisions, resolveEvidence, `Hypothesis ${local}`, input.assumed === true));
    }
  }

  const choicesByLocalId = new Map<string, Choice>();
  const alternativesByChoiceLocalId = new Map<string, ReadonlyMap<string, Choice["alternatives"][number]["id"]>>();
  const choiceResolutions: ChoiceResolution[] = [];
  for (const input of choiceInputs) {
    const local = claimLocal(input.localId, "choice.localId");
    const affects = affectsList(input.affects, `choice ${local} affects`);
    if (!Array.isArray(input.alternatives) || input.alternatives.length < 2) invalid(`Invalid choice ${local}`);
    if (input.selectedAlternativeId && input.provisionalAlternativeId) invalid(`Choice ${local} cannot be both selected and provisional`);
    if (input.provisionalAlternativeId && affects.some((facet) => facet === "entity" || facet === "filters")) {
      invalid(`Material population choice ${local} requires qualified evidence or user clarification`);
    }
    const duplicate = existingChoiceKeys.get(choiceKey(input.alternatives.map((alternative) => alternative.statement ?? "")));
    if (duplicate) transitionInvalid(`Choice ${local} repeats existing ${duplicate}; reference or dispose of the existing id instead of resubmitting it`);
    const alternativeLocals = new Map<string, Choice["alternatives"][number]["id"]>();
    const alternatives = input.alternatives.map((alternative) => {
      const alternativeLocal = requiredLocalId(alternative.localId, "choice.alternative.localId");
      if (alternativeLocals.has(alternativeLocal)) invalid(`Duplicate alternative ${alternativeLocal}`);
      const id = makeInternalId("alternative") as unknown as Choice["alternatives"][number]["id"];
      alternativeLocals.set(alternativeLocal, id);
      return { id, statement: requiredLocalId(alternative.statement, "choice.alternative.statement") };
    });
    const choice: Choice = { id: makeInternalId("choice") as unknown as ChoiceId, affects, alternatives: alternatives as unknown as Choice["alternatives"] };
    choicesByLocalId.set(local, choice);
    alternativesByChoiceLocalId.set(local, alternativeLocals);
    if (input.decidedAlternativeId) {
      if (input.selectedAlternativeId || input.provisionalAlternativeId) invalid(`Choice ${local} uses decidedAlternativeId together with a legacy selection field`);
      const alternativeId = alternativeLocals.get(input.decidedAlternativeId) ?? input.decidedAlternativeId;
      assertChoiceAlternative(choice, alternativeId);
      choiceResolutions.push(decideChoice(choice, alternativeId, { rationale: input.decisionRationale, evidenceIds: input.decisionEvidenceIds }, populationDecisions, resolveEvidence, `Choice ${local} decision`));
      continue;
    }
    const selectedLocal = input.selectedAlternativeId ?? input.provisionalAlternativeId;
    if (!selectedLocal) continue;
    const alternativeId = alternativeLocals.get(selectedLocal) ?? selectedLocal;
    assertChoiceAlternative(choice, alternativeId);
    if (input.provisionalAlternativeId) {
      const rationale = typeof input.selectionRationale === "string" ? input.selectionRationale.trim() : "";
      choiceResolutions.push({ outcome: "provisional", choiceId: choice.id, alternativeId: alternativeId as Choice["alternatives"][number]["id"], disclosureRequired: true, ...(rationale ? { rationale } : {}) });
      continue;
    }
    const rationale = selectionRationale(input.selectionRationale, `Choice ${local} selection`);
    choiceResolutions.push({
      outcome: "selected",
      choiceId: choice.id,
      alternativeId: alternativeId as Choice["alternatives"][number]["id"],
      proof: qualifyChoiceSelection(choice, alternativeId, input.selectionEvidenceIds ?? [], resolveEvidence, `Choice ${local} selection`),
      rationale,
    });
  }
  return {
    hypotheses: [...hypothesesByLocalId.values()],
    choices: [...choicesByLocalId.values()],
    resolutions,
    choiceResolutions,
    hypothesesByLocalId,
    choicesByLocalId,
    alternativesByChoiceLocalId,
  };
}

/**
 * Resolves notProbeable declarations against existing Choices and Choices
 * added in the same call, and merges them with the carried-forward waivers.
 */
function applyWaivers(
  inputs: readonly ProbeWaiverProposal[],
  carried: readonly ProbeWaiver[],
  choices: readonly Choice[],
  created: Pick<CreatedItems, "choicesByLocalId" | "alternativesByChoiceLocalId">,
): readonly ProbeWaiver[] {
  const waivers = new Map(carried.map((waiver) => [`${waiver.choiceId}\u0000${waiver.alternativeId}`, waiver]));
  const byId = new Map(choices.map((choice) => [choice.id as string, choice]));
  for (const input of inputs) {
    const choiceRef = requiredLocalId(input.choiceId, "notProbeable.choiceId");
    const choice = created.choicesByLocalId.get(choiceRef) ?? byId.get(choiceRef);
    if (!choice) transitionInvalid(`notProbeable references unknown choice ${choiceRef}`);
    const alternativeRef = requiredLocalId(input.alternativeId, "notProbeable.alternativeId");
    const alternativeId = created.alternativesByChoiceLocalId.get(choiceRef)?.get(alternativeRef) ?? alternativeRef;
    if (!choice.alternatives.some((alternative) => alternative.id === alternativeId)) transitionInvalid(`notProbeable alternative ${alternativeRef} is not part of Choice ${choice.id}`);
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (reason.length < MIN_RATIONALE_LENGTH) transitionInvalid(`notProbeable for ${alternativeRef} requires a reason explaining why the alternative cannot be executed on its own`);
    const waiver: ProbeWaiver = { choiceId: choice.id, alternativeId: alternativeId as ProbeWaiver["alternativeId"], reason };
    waivers.set(`${waiver.choiceId}\u0000${waiver.alternativeId}`, waiver);
  }
  return [...waivers.values()];
}

/** A Choice is decided only after every alternative has a probe or a waiver. */
function assertProbeCoverage(choice: Choice, governance: ChoiceGovernance | undefined, waivers: readonly ProbeWaiver[], label: string): void {
  if (!governance) return;
  const summary = summarizeChoiceProbes(choice, governance.probes, waivers);
  if (!summary.covered) {
    transitionInvalid(`${label} needs the output of every alternative before a decision: run query_database kind=exploration with probe {choiceId: "${choice.id}", alternativeId} for ${summary.missing.join(", ")}, or declare notProbeable with a reason`);
  }
}

function facetsOf(spec: AnswerSpec): readonly [string, Facet<unknown>][] {
  return [
    ["entity", spec.entity],
    ["metric", spec.metric],
    ...spec.filters.map((facet, index) => [`filters[${index}]`, facet] as [string, Facet<unknown>]),
    ...spec.groupBy.map((facet, index) => [`groupBy[${index}]`, facet] as [string, Facet<unknown>]),
    ["time", spec.time],
    ["ranking", spec.ranking],
    ["output", spec.output],
    ...Object.entries(spec.metrics ?? {}).map(([name, facet]) => [`metrics.${name}`, facet] as [string, Facet<unknown>]),
  ];
}

/** A facet may rest on a Hypothesis only while that Hypothesis is present and not refuted. */
function assertFacetBindings(body: RevisionBody): void {
  const present = new Set<string>(body.hypotheses.map((item) => item.id));
  const refuted = new Set<string>(body.resolutions.filter((item) => item.outcome === "refuted").map((item) => item.hypothesisId));
  for (const [name, facet] of facetsOf(body.spec)) {
    if (facet.state !== "specified" || facet.basis.kind !== "hypothesis") continue;
    const id = facet.basis.hypothesisId;
    if (!present.has(id)) transitionInvalid(`${name} still depends on removed hypothesis ${id}; update the facet in the same revision`);
    if (refuted.has(id)) transitionInvalid(`${name} depends on refuted hypothesis ${id}; update the facet in the same revision`);
  }
}

export function beginTransition(input: BeginTransitionInput, resolveEvidence: EvidenceResolver, governance?: ChoiceGovernance): RevisionBody {
  const created = createItems(input.hypotheses ?? [], input.choices ?? [], resolveEvidence, { hypotheses: [], choices: [] }, governance?.populationDecisions);
  const spec = buildSpec(input.spec, hypothesisResolver((ref) => created.hypothesesByLocalId.get(ref), { added: created.hypothesesByLocalId, existing: [] }), resolveEvidence);
  const probeWaivers = applyWaivers(input.notProbeable ?? [], [], created.choices, created);
  assertCreatedDecisionsCovered(created, governance, probeWaivers, resolveEvidence);
  const decisionPoints = nextDecisionPoints(undefined, input.decisionPoints, governance, { choices: created.choices, hypotheses: created.hypotheses, resolutions: created.resolutions }, created, resolveEvidence);
  const body: RevisionBody = {
    spec,
    hypotheses: created.hypotheses,
    choices: created.choices,
    resolutions: created.resolutions,
    choiceResolutions: created.choiceResolutions,
    ...(probeWaivers.length > 0 ? { probeWaivers } : {}),
    ...(decisionPoints ? { decisionPoints } : {}),
  };
  assertFacetBindings(body);
  return body;
}

/**
 * Apply a revision delta to the carried-forward base Revision. The only ways an
 * existing item changes are the listed dispositions; supersession is the only
 * way one is removed.
 */
/** A Choice decided in the same call that creates it can only rest on waivers: it has no probes yet. */
function assertCreatedDecisionsCovered(created: CreatedItems, governance: ChoiceGovernance | undefined, waivers: readonly ProbeWaiver[], resolveEvidence: EvidenceResolver): void {
  const choices = new Map(created.choices.map((choice) => [choice.id as string, choice]));
  for (const resolution of created.choiceResolutions) {
    const choice = choices.get(resolution.choiceId);
    if (!choice || resolution.outcome === "equivalent") continue;
    // A decision at creation has no advice yet, so it never carries an override.
    governDecision(choice, resolution.alternativeId, resolution.outcome === "selected" ? "select" : "provisional", { rationale: resolution.rationale }, governance, waivers, resolveEvidence, `Choice ${choice.id}`);
  }
}

export function reviseTransition(previous: RevisionBody, input: ReviseTransitionInput, resolveEvidence: EvidenceResolver, governance?: ChoiceGovernance): RevisionTransition {
  const dispositions = input.dispositions ?? [];
  const previousHypotheses = new Map(previous.hypotheses.map((item) => [item.id as string, item]));
  const previousChoices = new Map(previous.choices.map((item) => [item.id as string, item]));
  const resolvedHypotheses = new Set<string>(previous.resolutions.map((item) => item.hypothesisId));
  const resolvedChoices = new Set<string>(previous.choiceResolutions.map((item) => item.choiceId));

  const touched = new Set<string>();
  const claimTarget = (id: string) => {
    if (touched.has(id)) transitionInvalid(`${id} received more than one disposition in the same revision`);
    touched.add(id);
  };
  const superseded = new Set<string>();
  for (const disposition of dispositions) {
    if (disposition.action !== "supersede") continue;
    const target = requiredLocalId(disposition.targetId, "supersede.targetId");
    if (!previousHypotheses.has(target) && !previousChoices.has(target)) transitionInvalid(`Cannot supersede unknown item ${target}; ${describeExisting([...previous.hypotheses, ...previous.choices])}`);
    claimTarget(target);
    superseded.add(target);
  }

  const carriedHypotheses = previous.hypotheses.filter((item) => !superseded.has(item.id));
  const carriedChoices = previous.choices.filter((item) => !superseded.has(item.id));
  const created = createItems(input.addHypotheses ?? [], input.addChoices ?? [], resolveEvidence, { hypotheses: carriedHypotheses, choices: carriedChoices }, governance?.populationDecisions);
  const probeWaivers = applyWaivers(
    input.notProbeable ?? [],
    (previous.probeWaivers ?? []).filter((waiver) => !superseded.has(waiver.choiceId)),
    [...carriedChoices, ...created.choices],
    created,
  );
  assertCreatedDecisionsCovered(created, governance, probeWaivers, resolveEvidence);

  const resolutions: Resolution[] = [...previous.resolutions.filter((item) => !superseded.has(item.hypothesisId)), ...created.resolutions];
  const choiceResolutions: ChoiceResolution[] = [...previous.choiceResolutions.filter((item) => !superseded.has(item.choiceId)), ...created.choiceResolutions];
  const supersessions: Supersession[] = [];

  const replacementId = (ref: string): { id: ItemId; affects: readonly FacetName[] } => {
    const createdHypothesis = created.hypothesesByLocalId.get(ref);
    if (createdHypothesis) return { id: createdHypothesis.id, affects: createdHypothesis.affects };
    const createdChoice = created.choicesByLocalId.get(ref);
    if (createdChoice) return { id: createdChoice.id, affects: createdChoice.affects };
    if (superseded.has(ref)) transitionInvalid(`${ref} is superseded in this revision and cannot replace another item`);
    const existing = previousHypotheses.get(ref) ?? previousChoices.get(ref);
    if (existing) return { id: existing.id, affects: existing.affects };
    return transitionInvalid(`Unknown replacement ${ref}; ${describeReferences({
      added: new Map<string, Hypothesis | Choice>([...created.hypothesesByLocalId, ...created.choicesByLocalId]),
      existing: [...carriedHypotheses, ...carriedChoices],
    })}`);
  };

  for (const disposition of dispositions) {
    switch (disposition.action) {
      case "support":
      case "refute": {
        const id = requiredLocalId(disposition.hypothesisId, `${disposition.action}.hypothesisId`);
        const hypothesis = previousHypotheses.get(id);
        if (!hypothesis && created.hypothesesByLocalId.has(id)) {
          transitionInvalid(`Cannot ${disposition.action} ${id}: it is added in this same call, and dispositions act only on existing ids. Put its evidence ids in addHypotheses proposedEvidenceIds instead, or dispose of its returned id in a later call`);
        }
        if (!hypothesis) transitionInvalid(`Cannot ${disposition.action} unknown hypothesis ${id}; ${describeExisting(previous.hypotheses)}`);
        claimTarget(id);
        if (resolvedHypotheses.has(id)) transitionInvalid(`Hypothesis ${id} is already resolved; supersede it to reopen`);
        resolutions.push(disposition.action === "support"
          ? supportHypothesis(hypothesis, disposition.evidenceIds ?? [], governance?.populationDecisions ?? "require_evidence", resolveEvidence, `support ${id}`)
          // A refutation removes the facets bound to the hypothesis, so it still needs qualifying evidence.
          : { outcome: "refuted", hypothesisId: hypothesis.id, proof: qualifyAll(hypothesis, disposition.evidenceIds ?? [], resolveEvidence, `refute ${id}`) });
        break;
      }
      case "select":
      case "provisional": {
        const id = requiredLocalId(disposition.choiceId, `${disposition.action}.choiceId`);
        const choice = previousChoices.get(id);
        if (!choice) transitionInvalid(`Cannot ${disposition.action} unknown choice ${id}; ${describeExisting(previous.choices)}`);
        claimTarget(id);
        if (resolvedChoices.has(id)) transitionInvalid(`Choice ${id} is already resolved; supersede it to reopen`);
        const alternativeId = requiredLocalId(disposition.alternativeId, `${disposition.action}.alternativeId`);
        if (!choice.alternatives.some((item) => item.id === alternativeId)) transitionInvalid(`Alternative ${alternativeId} is not part of Choice ${id}; use an alternative id from the Revision view`);
        const alternative = alternativeId as Choice["alternatives"][number]["id"];
        const governed = governDecision(choice, alternativeId, disposition.action, disposition, governance, probeWaivers, resolveEvidence, `${disposition.action} ${id}`);
        const override = governed.adviceOverride ? { adviceOverride: governed.adviceOverride } : {};
        if (disposition.action === "provisional") {
          if (choice.affects.some((facet) => facet === "entity" || facet === "filters")) {
            transitionInvalid(`Choice ${id} changes the material population; provisional selection is not allowed`);
          }
          choiceResolutions.push({ outcome: "provisional", choiceId: choice.id, alternativeId: alternative, disclosureRequired: true, ...(governed.rationale ? { rationale: governed.rationale } : {}), ...override });
        } else {
          const rationale = selectionRationale(disposition.rationale, `select ${id}`);
          choiceResolutions.push({ outcome: "selected", choiceId: choice.id, alternativeId: alternative, proof: qualifyChoiceSelection(choice, alternativeId, disposition.evidenceIds ?? [], resolveEvidence, `select ${id}`), rationale, ...override });
        }
        break;
      }
      case "decide": {
        const id = requiredLocalId(disposition.choiceId, "decide.choiceId");
        const choice = previousChoices.get(id);
        if (!choice && created.choicesByLocalId.has(id)) {
          transitionInvalid(`Cannot decide ${id}: it is added in this same call, and dispositions act only on existing ids. Use addChoices decidedAlternativeId instead, or decide its returned id in a later call`);
        }
        if (!choice) transitionInvalid(`Cannot decide unknown choice ${id}; ${describeExisting(previous.choices)}`);
        claimTarget(id);
        if (resolvedChoices.has(id)) transitionInvalid(`Choice ${id} is already resolved; supersede it to reopen`);
        const alternativeId = requiredLocalId(disposition.alternativeId, "decide.alternativeId");
        if (!choice.alternatives.some((item) => item.id === alternativeId)) transitionInvalid(`Alternative ${alternativeId} is not part of Choice ${id}; use an alternative id from the Revision view`);
        const decided = decideChoice(choice, alternativeId, disposition, governance?.populationDecisions ?? "require_evidence", resolveEvidence, `decide ${id}`);
        // ADR-0005 preconditions; the rationale was checked by decideChoice, so govern as a selection.
        const governed = governDecision(choice, alternativeId, "select", disposition, governance, probeWaivers, resolveEvidence, `decide ${id}`);
        choiceResolutions.push(governed.adviceOverride && decided.outcome !== "equivalent" ? { ...decided, adviceOverride: governed.adviceOverride } : decided);
        break;
      }
      case "equivalent": {
        const id = requiredLocalId(disposition.choiceId, "equivalent.choiceId");
        const choice = previousChoices.get(id);
        if (!choice) transitionInvalid(`Cannot mark unknown choice ${id} equivalent; ${describeExisting(previous.choices)}`);
        claimTarget(id);
        if (resolvedChoices.has(id)) transitionInvalid(`Choice ${id} is already resolved; supersede it to reopen`);
        const outputs = governance ? summarizeChoiceProbes(choice, governance.probes, probeWaivers).outputs : "incomplete";
        if (outputs !== "identical") transitionInvalid(`Choice ${id} is not equivalent: probe outputs are ${outputs}; only a Choice whose every alternative produced the same output can be marked equivalent`);
        choiceResolutions.push({ outcome: "equivalent", choiceId: choice.id });
        break;
      }
      case "supersede": {
        const target = disposition.targetId.trim();
        const item = previousHypotheses.get(target) ?? previousChoices.get(target)!;
        const reason = typeof disposition.reason === "string" ? disposition.reason.trim() : "";
        if (!reason) transitionInvalid(`Superseding ${target} requires a reason`);
        if (!Array.isArray(disposition.replacementIds) || disposition.replacementIds.length === 0) transitionInvalid(`Superseding ${target} requires at least one replacement`);
        const replacements = disposition.replacementIds.map((ref) => {
          if (ref === target) transitionInvalid(`${target} cannot replace itself`);
          return replacementId(ref);
        });
        const covered = new Set(replacements.flatMap((replacement) => replacement.affects));
        const uncovered = item.affects.filter((facet) => !covered.has(facet));
        if (uncovered.length > 0) transitionInvalid(`Replacements for ${target} do not cover affected facets: ${uncovered.join(", ")}`);
        supersessions.push({ targetId: item.id, replacementIds: [...new Set(replacements.map((replacement) => replacement.id))] as unknown as Supersession["replacementIds"], reason });
        break;
      }
      default:
        invalid("Unsupported disposition");
    }
  }

  const hypotheses = [...carriedHypotheses, ...created.hypotheses];
  const choices = [...carriedChoices, ...created.choices];
  const currentHypotheses = new Map(hypotheses.map((item) => [item.id as string, item]));
  const hypothesisRef = hypothesisResolver(
    (ref) => created.hypothesesByLocalId.get(ref) ?? currentHypotheses.get(ref),
    { added: created.hypothesesByLocalId, existing: carriedHypotheses },
  );
  const spec = input.spec ? patchSpec(previous.spec, input.spec, hypothesisRef, resolveEvidence) : previous.spec;
  const decisionPoints = nextDecisionPoints(previous.decisionPoints, input.decisionPoints, governance, { choices, hypotheses, resolutions }, created, resolveEvidence);
  const next: RevisionTransition = { spec, hypotheses, choices, resolutions, choiceResolutions, supersessions, ...(probeWaivers.length > 0 ? { probeWaivers } : {}), ...(decisionPoints ? { decisionPoints } : {}) };
  assertFacetBindings(next);
  try {
    assertContinuity(previous, next, supersessions);
  } catch (error) {
    if (error instanceof QualificationError) transitionInvalid(error.message);
    throw error;
  }
  return next;
}
