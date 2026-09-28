import type { BusinessContext, QueryBudgetPolicy } from "./model.js";
import type { AnsweringStore } from "./answering-store.js";
import type { ResultStore } from "./result-store.js";
import type { EvidenceSource } from "./evidence-admission.js";
import type { FanoutDialect, FanoutSchema } from "./fanout-check.js";
import type { AnsweringSqlExecutor } from "./sql-execution.js";
import type { SpecAlignmentAssessor } from "../judgment/spec-alignment.js";
import type { AdvisoryLedger } from "./advisory-ledger.js";

export interface FanoutAnsweringOptions {
  readonly enabled?: boolean;
  readonly dialect?: FanoutDialect;
  readonly schema?: FanoutSchema;
  readonly maxTargets?: number;
  readonly maxInputRows?: number;
}

export interface SpecFeedbackOptions {
  readonly assessor: SpecAlignmentAssessor;
  readonly getOriginalQuestion: (requestMessageId: string, options?: { readonly signal?: AbortSignal }) => Promise<string | undefined>;
  readonly timeoutMs?: number;
  readonly maxInputBytes?: number;
}

export type ResolvedSpecFeedbackOptions = Omit<SpecFeedbackOptions, "timeoutMs" | "maxInputBytes"> & {
  readonly timeoutMs: number;
  readonly maxInputBytes: number;
};

export type SemanticQualificationMode = "required" | "bypassed";

/**
 * Resolved collaborators shared by the Answering use-case modules. Only the
 * InMemoryAnswering facade constructs it; each module keeps its own
 * transaction boundaries and never exposes these capabilities to callers.
 */
export interface AnsweringDeps {
  readonly store: AnsweringStore;
  readonly resultStore: ResultStore;
  readonly sqlExecutor: AnsweringSqlExecutor;
  readonly budgetPolicy: QueryBudgetPolicy;
  readonly maxResultRows: number;
  readonly semanticQualificationMode: SemanticQualificationMode;
  /** Choice probe tracking and the decide-after-probe rule (ADR-0005). */
  readonly choiceProbes: boolean;
  /** compare_hypotheses advice per Choice, written by the trusted comparison tool. */
  readonly advisoryLedger?: AdvisoryLedger;
  /** An advisor is configured, so decisive core Choices need advice before a decision. */
  readonly adviceRequired: boolean;
  /** Whether an unverified decision may settle the material population (ADR-0006). */
  readonly populationDecisions: "require_evidence" | "allow_disclosed";
  readonly evidenceSource?: EvidenceSource;
  readonly specFeedback?: ResolvedSpecFeedbackOptions;
  readonly fanout: FanoutAnsweringOptions;
  /** Cached per Answering instance; loaded lazily from the executor. */
  readonly loadFanoutSchema: (context: BusinessContext) => Promise<FanoutSchema | undefined>;
}
