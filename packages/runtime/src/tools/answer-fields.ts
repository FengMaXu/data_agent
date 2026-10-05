import type {
  Answering,
  AnswerTaskView,
  ChoiceProposal,
  DecisionPointName,
  DispositionProposal,
  HypothesisProposal,
  SpecStep,
  UntrustedEvidenceInput,
} from "../answering/public.js";

/**
 * ADR-0007 phase 1: one field vocabulary, compiled onto the existing Answer
 * Spec records. Each path becomes one step of a stepped begin/revise, so the
 * Runtime checks and applies it on its own. The domain records do not change;
 * items this compiler creates carry a "<path>: " statement prefix, which is
 * how a later call finds the items that belong to a path.
 */

type AnswerRevisionRecord = AnswerTaskView["currentRevision"];
type AnswerRevisionView = Awaited<ReturnType<Answering["revise"]>>;
type FacetName = "entity" | "metric" | "filters" | "groupBy" | "time" | "ranking" | "output";
type HypothesisKind = HypothesisProposal["kind"];

const SLOTS: readonly FacetName[] = ["entity", "metric", "filters", "groupBy", "time", "ranking", "output"];

interface SubfieldRule {
  readonly point?: DecisionPointName;
  readonly affects: readonly FacetName[];
  readonly kind: HypothesisKind;
}

/** Decision points become sub-fields of the slot they belong to (ADR-0007 decisions 1 and 4). */
const SUBFIELDS: Readonly<Record<string, SubfieldRule>> = {
  "entity.joinMultiplicity": { point: "join_multiplicity", affects: ["entity"], kind: "physical_mapping" },
  "metric.countGrain": { point: "count_grain", affects: ["metric"], kind: "business_semantics" },
  "metric.denominator": { point: "denominator", affects: ["metric"], kind: "business_semantics" },
  "filters.population": { point: "population", affects: ["filters"], kind: "business_semantics" },
  "time.field": { point: "time_field", affects: ["time"], kind: "physical_mapping" },
  "time.window": { point: "window", affects: ["time"], kind: "business_semantics" },
  "ranking.ties": { point: "ties", affects: ["ranking"], kind: "business_semantics" },
  "output.shape": { point: "output_shape", affects: ["output"], kind: "business_semantics" },
  // A data-source uncertainty that touches several slots; it has no decision point.
  source: { affects: ["entity", "metric", "filters"], kind: "physical_mapping" },
};

export const FIELD_PATHS: readonly string[] = [...SLOTS, ...Object.keys(SUBFIELDS), "metrics.<name>"];

/** A Report Task's named metric definitions (ADR-0009); each is set like the metric slot. */
const METRIC_DEFINITION = /^metrics\.([A-Za-z0-9_一-鿿-]{1,64})$/;

/**
 * The shared field a chart query deviates on when it changes a path (ADR-0009
 * decision 3). The field's `reason` is the deviation reason.
 */
const DEVIATION_PATHS: Readonly<Record<string, string>> = {
  entity: "entity",
  filters: "filters",
  time: "time",
  metric: "metric",
  "filters.population": "population",
  "entity.joinMultiplicity": "join_multiplicity",
  "time.field": "time_field",
  "time.window": "window",
};

/** Paths a Report Task owns (ADR-0009 decision 2). */
const REPORT_PATHS = new Set(["entity", "filters", "time", "filters.population", "entity.joinMultiplicity", "time.field", "time.window"]);

const POINT_PATHS = new Map(Object.entries(SUBFIELDS).flatMap(([path, rule]) => rule.point ? [[rule.point, path] as const] : []));

/** Slots whose value is an object and therefore cannot be one of several text candidates. */
const NO_OPEN_SLOTS = new Set<string>(["ranking", "output"]);

type FieldState =
  | { readonly kind: "na" }
  | { readonly kind: "request"; readonly value: unknown; readonly quote: string }
  | { readonly kind: "cite"; readonly value: unknown; readonly cite: readonly { readonly source: string; readonly quote?: string }[] }
  | { readonly kind: "observed"; readonly value: unknown; readonly evidenceIds: readonly string[] }
  | { readonly kind: "assumed"; readonly value: unknown; readonly rationale: string }
  | { readonly kind: "open"; readonly candidates: readonly string[] }
  | { readonly kind: "decide"; readonly value: unknown; readonly rationale: string; readonly evidenceIds?: readonly string[]; readonly adviceOverride?: { readonly reason: string; readonly evidenceIds: readonly string[] } }
  /** A slot value with no stated basis: model inference, disclosed at publication. */
  | { readonly kind: "inferred"; readonly value: unknown };

export interface CompiledField {
  readonly path: string;
  /** Present when the path compiled; sent to Answering as one step labelled with the path. */
  readonly step?: SpecStep;
  /** Present when the path was rejected before reaching Answering. */
  readonly error?: string;
}

export interface CompileContext {
  /** Current Revision, or undefined when the call starts the task. */
  readonly revision?: Pick<AnswerRevisionRecord, "spec" | "hypotheses" | "choices" | "choiceResolutions" | "decisionPoints">;
}

const FORMS = 'one of: "n/a"; {value, basis:"request", quote}; {value, cite:[{source, quote}]}; {value, evidenceIds}; {value, basis:"assumed", rationale}; {open:[candidate, ...]}; to decide an open field {value:<candidate>, rationale, evidenceIds?}';

class FieldError extends Error {}

const FORM_KEYS = ["value", "open", "basis", "quote", "cite", "evidenceIds", "rationale", "reason", "adviceOverride"] as const;

function fail(message: string): never {
  throw new FieldError(message);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function strings(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => !text(item))) fail(`${label} must be a non-empty list of non-empty strings`);
  return (value as string[]).map((item) => item.trim());
}

function parseState(path: string, input: unknown, slot: boolean): { readonly state: FieldState; readonly reason?: string } {
  if (input === "n/a") return { state: { kind: "na" } };
  const body = record(input);
  // A slot value can itself be an object ({rowMode, rowCount}); without any field-form key it is the bare value.
  if (!body || (slot && !FORM_KEYS.some((key) => key in body))) {
    if (!slot) fail(`${path} needs a stated basis; write ${FORMS}`);
    return { state: { kind: "inferred", value: input } };
  }
  const reason = text(body.reason);
  const withReason = (state: FieldState) => reason ? { state, reason } : { state };
  if (body.open !== undefined) {
    const candidates = strings(body.open, `${path}.open`);
    if (candidates.length < 2) fail(`${path}.open needs at least two candidates`);
    if (new Set(candidates).size !== candidates.length) fail(`${path}.open repeats a candidate`);
    return withReason({ kind: "open", candidates });
  }
  if (!("value" in body)) fail(`${path} has no value; write ${FORMS}`);
  const value = body.value;
  if (value === null || value === undefined || value === "") fail(`${path}.value must not be empty`);
  if (!slot && !text(value)) fail(`${path}.value must be a sentence stating the decision`);
  if (body.basis === "request") {
    const quote = text(body.quote) ?? fail(`${path} with basis "request" needs the verbatim request text in quote`);
    return withReason({ kind: "request", value, quote });
  }
  if (body.basis === "assumed") {
    const rationale = text(body.rationale) ?? fail(`${path} with basis "assumed" needs a rationale`);
    return withReason({ kind: "assumed", value, rationale });
  }
  if (body.basis !== undefined) fail(`${path}.basis must be "request" or "assumed"; cite sources with cite, observations with evidenceIds`);
  if (body.cite !== undefined) {
    if (!Array.isArray(body.cite) || body.cite.length === 0) fail(`${path}.cite must list at least one {source, quote}`);
    const cite = body.cite.map((item, index) => {
      const entry = record(item) ?? fail(`${path}.cite[${index}] must be {source, quote}`);
      const source = text(entry.source) ?? fail(`${path}.cite[${index}].source is required`);
      const quote = text(entry.quote);
      return quote ? { source, quote } : { source };
    });
    return withReason({ kind: "cite", value, cite });
  }
  const evidenceIds = body.evidenceIds === undefined ? undefined : strings(body.evidenceIds, `${path}.evidenceIds`);
  const rationale = text(body.rationale);
  if (rationale) {
    const override = record(body.adviceOverride);
    const adviceOverride = override ? { reason: text(override.reason) ?? fail(`${path}.adviceOverride.reason is required`), evidenceIds: strings(override.evidenceIds, `${path}.adviceOverride.evidenceIds`) } : undefined;
    return withReason({ kind: "decide", value, rationale, ...(evidenceIds ? { evidenceIds } : {}), ...(adviceOverride ? { adviceOverride } : {}) });
  }
  if (evidenceIds) return withReason({ kind: "observed", value, evidenceIds });
  if (!slot) fail(`${path} needs a stated basis; write ${FORMS}`);
  return withReason({ kind: "inferred", value });
}

/** Text evidence for a cite source; quotes are verified by Evidence Admission. */
function citeEvidence(path: string, cite: readonly { readonly source: string; readonly quote?: string }[], currentMessageId: string | undefined): UntrustedEvidenceInput[] {
  return cite.map((item, index) => {
    const localId = `${path}#cite${index + 1}`;
    const [scheme, ...rest] = item.source.split(":");
    const ref = rest.join(":").trim();
    const quoted = (label: string) => item.quote ?? fail(`${path}.cite[${index}] from ${label} needs a verbatim quote`);
    if (item.source === "message") {
      if (!currentMessageId) fail(`${path}.cite[${index}]: the current user message is not available in this call`);
      return { localId, kind: "user_confirmation", sourceRef: currentMessageId, quote: quoted("message") };
    }
    if (scheme === "clarification" && ref) return { localId, kind: "user_confirmation", sourceRef: `clarification:${ref}`, quote: quoted("a clarification") };
    if (scheme === "knowledge" && ref) return { localId, kind: "document", sourceRef: ref, quote: quoted("a document") };
    if (scheme === "schema" && ref) return { localId, kind: "schema_fact", sourceRef: ref, ...(item.quote ? { quote: item.quote } : {}) };
    return fail(`${path}.cite[${index}].source ${JSON.stringify(item.source)} must be knowledge:<id>, schema:<table.column>, clarification:<id> or message`);
  });
}

function requestEvidence(path: string, quote: string): UntrustedEvidenceInput {
  return { localId: `${path}#request`, kind: "request_wording", quote };
}

function prefix(path: string): string {
  return `${path}: `;
}

function valueText(value: unknown): string {
  return typeof value === "string" ? value.trim() : JSON.stringify(value);
}

/** Items of the current Revision that this compiler created for a path. */
function itemsOf(path: string, revision: CompileContext["revision"]) {
  const head = prefix(path);
  return {
    hypotheses: (revision?.hypotheses ?? []).filter((item) => item.statement.startsWith(head)),
    choices: (revision?.choices ?? []).filter((item) => item.alternatives.every((alternative) => alternative.statement.startsWith(head))),
  };
}

function openChoice(path: string, revision: CompileContext["revision"]) {
  const resolved = new Set((revision?.choiceResolutions ?? []).map((item) => item.choiceId as string));
  return itemsOf(path, revision).choices.find((choice) => !resolved.has(choice.id));
}

function slotIsSet(slot: FacetName, revision: CompileContext["revision"]): boolean {
  if (!revision) return false;
  const facet = revision.spec[slot];
  return Array.isArray(facet) ? !facet.some((item) => item.state === "unknown") : (facet as { state: string }).state !== "unknown";
}

/** The facet value a slot takes from a field value; list slots take a list. */
function slotValue(slot: FacetName, value: unknown): unknown {
  if (slot === "filters" || slot === "groupBy") return Array.isArray(value) ? value : [value];
  return value;
}

/** Where a slot-like path writes its facet: a slot of the spec, or one named metric definition. */
interface SlotTarget {
  readonly slot: FacetName;
  readonly set: boolean;
  readonly patch: (facet: unknown) => Record<string, unknown>;
  readonly notApplicable: unknown;
}

function slotTarget(path: string, revision: CompileContext["revision"]): SlotTarget | undefined {
  if ((SLOTS as readonly string[]).includes(path)) {
    const slot = path as FacetName;
    const list = slot === "filters" || slot === "groupBy";
    return { slot, set: slotIsSet(slot, revision), patch: (facet) => ({ [slot]: facet }), notApplicable: list ? [] : { state: "not_applicable" } };
  }
  const name = METRIC_DEFINITION.exec(path)?.[1];
  if (!name) return undefined;
  // "n/a" removes the definition.
  return { slot: "metric", set: Boolean(revision?.spec.metrics?.[name]), patch: (facet) => ({ metrics: { [name]: facet } }), notApplicable: null };
}

function slotPatch(target: SlotTarget, value: unknown, basis: Record<string, unknown>): Record<string, unknown> {
  const facetValue = slotValue(target.slot, value);
  const wrap = (item: unknown) => Object.keys(basis).length > 0 ? { value: item, ...basis } : item;
  const list = target.slot === "filters" || target.slot === "groupBy";
  return target.patch(list ? (facetValue as unknown[]).map(wrap) : wrap(facetValue));
}

function compileOne(path: string, input: unknown, context: CompileContext, currentMessageId: string | undefined): SpecStep {
  const step = compileStep(path, input, context, currentMessageId);
  // On a chart query, the reason for changing an inherited field is its deviation reason.
  const reason = text(record(input)?.reason);
  const deviation = DEVIATION_PATHS[path];
  return reason && deviation ? { ...step, deviations: [{ path: deviation, reason }] } : step;
}

function compileStep(path: string, input: unknown, context: CompileContext, currentMessageId: string | undefined): SpecStep {
  const revision = context.revision;
  const target = slotTarget(path, revision);
  const slot = target?.slot;
  const rule = SUBFIELDS[path];
  if (!target && !rule) fail(`unknown field path ${path}; use one of ${FIELD_PATHS.join(", ")}`);
  const { state, reason } = parseState(path, input, Boolean(target));
  const existing = itemsOf(path, revision);
  const open = openChoice(path, revision);
  const step: { label: string } & Omit<SpecStep, "label"> & Record<string, unknown> = { label: path };
  const evidence: UntrustedEvidenceInput[] = [];
  const dispositions: DispositionProposal[] = [];

  if (state.kind === "decide") {
    if (!open) fail(`${path} has no open candidates to decide; give the value a basis instead (${FORMS})`);
    const wanted = prefix(path) + valueText(state.value);
    const alternative = open.alternatives.find((item) => item.statement === wanted)
      ?? fail(`${path}: ${JSON.stringify(valueText(state.value))} is not one of the candidates ${open.alternatives.map((item) => JSON.stringify(item.statement.slice(prefix(path).length))).join(", ")}`);
    dispositions.push({
      action: "decide",
      choiceId: open.id,
      alternativeId: alternative.id,
      rationale: state.rationale,
      ...(state.evidenceIds ? { evidenceIds: state.evidenceIds } : {}),
      ...(state.adviceOverride ? { adviceOverride: state.adviceOverride } : {}),
    });
    if (target) Object.assign(step, { spec: slotPatch(target, state.value, {}) });
    return { ...step, dispositions } as SpecStep;
  }

  // Rewriting a handled field needs a reason; its items leave only by supersession (ADR-0007 decision 6).
  const owned = [...existing.hypotheses, ...existing.choices];
  const alreadySet = owned.length > 0 || (target ? target.set : Boolean(rule?.point && revision?.decisionPoints?.[rule.point]));
  if (alreadySet && !reason) fail(`${path} is already set; add "reason" to change it, or decide its open candidates with {value, rationale}`);

  const replacement = `${path}#item`;
  const supersede = () => {
    for (const item of owned) dispositions.push({ action: "supersede", targetId: item.id, replacementIds: [replacement], reason: reason! });
  };

  if (state.kind === "open") {
    if (target && target.slot !== path) fail(`${path} cannot hold text candidates; a metric definition is an object`);
    if (slot && NO_OPEN_SLOTS.has(slot)) fail(`${path} cannot hold text candidates; leave ${path} to its sub-field (${path}.${slot === "ranking" ? "ties" : "shape"}) or set it directly`);
    const choice: ChoiceProposal = {
      localId: replacement,
      affects: [...(slot ? [slot] : rule!.affects)],
      alternatives: state.candidates.map((candidate, index) => ({ localId: `${path}#alt${index + 1}`, statement: prefix(path) + candidate })),
    };
    supersede();
    Object.assign(step, { addChoices: [choice] });
    if (slot) Object.assign(step, { spec: { [slot]: slot === "filters" || slot === "groupBy" ? [{ state: "unknown" }] : { state: "unknown" } } });
    if (rule?.point) Object.assign(step, { decisionPoints: [{ name: rule.point, status: "choice", choiceId: replacement }] });
    return { ...step, ...(dispositions.length > 0 ? { dispositions } : {}) } as SpecStep;
  }

  if (target) {
    // A slot records its basis on the facet; replacing a Choice needs a new Choice or a decision.
    if (existing.choices.length > 0) fail(`${path} has candidates; decide one with {value, rationale}, or replace them with {open:[...], reason}`);
    if (state.kind === "na") return { ...step, spec: target.patch(target.notApplicable) } as SpecStep;
    if (state.kind === "request") {
      evidence.push(requestEvidence(path, state.quote));
      return { ...step, evidence, spec: slotPatch(target, state.value, { evidenceIds: [`${path}#request`] }) } as SpecStep;
    }
    if (state.kind === "cite") {
      evidence.push(...citeEvidence(path, state.cite, currentMessageId));
      return { ...step, evidence, spec: slotPatch(target, state.value, { evidenceIds: evidence.map((item) => item.localId!) }) } as SpecStep;
    }
    if (state.kind === "observed") return { ...step, spec: slotPatch(target, state.value, { evidenceIds: state.evidenceIds }) } as SpecStep;
    // assumed and inferred: model inference, disclosed at publication.
    return { ...step, spec: slotPatch(target, state.value, {}) } as SpecStep;
  }

  if (state.kind === "na") {
    if (owned.length > 0) fail(`${path} already has items that can only leave by replacement; give it a value with a reason instead of "n/a"`);
    if (!rule!.point) fail(`${path} has nothing to mark not applicable; omit it`);
    return { ...step, decisionPoints: [{ name: rule!.point, status: "not_applicable" }] } as SpecStep;
  }
  if (state.kind === "inferred") fail(`${path} needs a stated basis; write ${FORMS}`);

  // A sub-field value becomes a Hypothesis whose verification the Runtime derives from what it cites (ADR-0006).
  const hypothesis: HypothesisProposal = {
    localId: replacement,
    kind: rule!.kind,
    statement: prefix(path) + valueText(state.value),
    affects: [...rule!.affects],
    basis: state.kind === "assumed" ? state.rationale : state.kind === "request" ? "request wording" : state.kind === "cite" ? "cited source" : "query observation",
    impact: `decides ${path}`,
    ...(state.kind === "assumed" ? { assumed: true } : {}),
  };
  let point: Record<string, unknown> | undefined;
  if (state.kind === "request") {
    evidence.push(requestEvidence(path, state.quote));
    Object.assign(hypothesis, { proposedEvidenceIds: [`${path}#request`] });
    point = rule!.point ? { name: rule!.point, status: "fixed_by_request", quote: state.quote } : undefined;
  } else {
    if (state.kind === "cite") evidence.push(...citeEvidence(path, state.cite, currentMessageId));
    if (state.kind === "cite") Object.assign(hypothesis, { proposedEvidenceIds: evidence.map((item) => item.localId!) });
    if (state.kind === "observed") Object.assign(hypothesis, { proposedEvidenceIds: state.evidenceIds });
    point = rule!.point ? { name: rule!.point, status: "assumed", hypothesisId: replacement, ...(state.kind === "observed" ? { observationEvidenceIds: state.evidenceIds } : {}) } : undefined;
  }
  supersede();
  return {
    ...step,
    addHypotheses: [hypothesis],
    ...(evidence.length > 0 ? { evidence } : {}),
    ...(point ? { decisionPoints: [point] } : {}),
    ...(dispositions.length > 0 ? { dispositions } : {}),
  } as SpecStep;
}

/** Compiles every path on its own; a path that cannot compile is reported and not sent. */
export function compileFields(fields: Readonly<Record<string, unknown>>, context: CompileContext, currentMessageId?: string): readonly CompiledField[] {
  return Object.entries(fields).map(([rawPath, input]) => {
    const path = rawPath.trim();
    try {
      return { path, step: compileOne(path, input, context, currentMessageId) };
    } catch (error) {
      if (error instanceof FieldError) return { path, error: error.message };
      throw error;
    }
  });
}

/** The path a Revision item belongs to, from its statement prefix. */
function pathOf(statement: string): string | undefined {
  return FIELD_PATHS.find((path) => statement.startsWith(prefix(path)));
}

/**
 * What still needs attention after a call (ADR-0007 decision 5): open fields
 * with their probe handles, unverified fields, and fields not yet declared.
 */
export function fieldStateTable(view: AnswerRevisionView): string {
  const lines: string[] = [];
  const report = view.role === "report";
  if (report) lines.push("- 报告任务：只设共享字段（entity、filters、time、filters.population、entity.joinMultiplicity、time.field、time.window、source、metrics.<name>），本身不出结果；每张图用 parentTaskId 建一个图表查询");
  if (view.parent) {
    lines.push(`- 报告任务 ${view.parent.taskId}：继承自 ${view.parent.revisionId}${view.parent.current ? "" : "；报告任务已修改，先用 rebind: true 重新绑定"}`);
    if (view.metricRef) lines.push(`- 指标取自报告任务的 metrics.${view.metricRef}`);
    if (view.deviations && view.deviations.length > 0) lines.push(`- 偏离共享口径（发布时披露）: ${view.deviations.map((item) => `${item.path}（${item.reason}）`).join("；")}`);
  }
  const open = view.choices.filter((choice) => choice.status === "unresolved");
  for (const choice of open) {
    const path = pathOf(choice.alternatives[0]!.statement) ?? choice.affects.join("+");
    const probes = new Map((choice.probes ?? []).map((probe) => [probe.alternativeId as string, probe]));
    const candidates = choice.alternatives.map((alternative) => {
      const probe = probes.get(alternative.id);
      const output = probe?.state === "available" ? ` output=${probe.output}` : probe ? ` ${probe.state}` : "";
      return `${alternative.id}=${JSON.stringify(alternative.statement.slice(prefix(path).length))}${output}`;
    });
    lines.push(`- 待定 ${path}: choiceId=${choice.id}; ${candidates.join("; ")}${choice.outputs ? `; outputs=${choice.outputs}` : ""}`);
  }
  const unverified = [
    ...view.hypotheses.filter((item) => item.status === "provisional").map((item) => pathOf(item.statement) ?? item.affects.join("+")),
    ...view.choices.filter((item) => item.status === "provisional").map((item) => pathOf(item.alternatives[0]!.statement) ?? item.affects.join("+")),
    ...view.inferredFacets,
  ];
  if (unverified.length > 0) lines.push(`- 未证实（发布时披露）: ${[...new Set(unverified)].join(", ")}`);
  const pending = view.hypotheses.filter((item) => item.status === "unresolved").map((item) => pathOf(item.statement) ?? item.id);
  if (pending.length > 0) lines.push(`- 未处置的假设: ${pending.join(", ")}`);
  // A Report Task answers only for its shared fields.
  const shared = (path: string) => !report || REPORT_PATHS.has(path);
  const undeclared = [
    ...view.unresolvedFacets.filter((facet) => !open.some((choice) => choice.affects.includes(facet))),
    ...(view.undeclaredDecisionPoints ?? []).map((point) => POINT_PATHS.get(point) ?? point),
  ].filter(shared);
  if (undeclared.length > 0) lines.push(`- 未声明: ${[...new Set(undeclared)].join(", ")}`);
  // Unverified fields are disclosed, not blocking.
  if (open.length === 0 && pending.length === 0 && undeclared.length === 0) lines.push(report ? "- 共享字段已处理，图表查询可以执行结果查询" : "- 没有待处理的字段，可以执行结果查询");
  return lines.join("\n");
}
