import { randomUUID } from "node:crypto";
import type { ReviewCoverage, SemanticDiff } from "./conversation-blind-reviewer.js";
import type { PublicationStatus } from "./publication.js";
import type { QueryAssuranceMode } from "./query-assurance.js";
import type { GateResult } from "./query-gates.js";

export interface SpecGenerationFailure {
  readonly code: string;
  readonly message: string;
}

export interface ReviewFailureAudit {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface ProbeOutcomeAudit {
  readonly instanceId: string;
  readonly templateId: string;
  readonly templateVersion: string;
  readonly claimId: string;
  readonly status: "passed" | "failed" | "not_applicable" | "unsupported" | "inconclusive";
}

export interface AssuranceAuditRecord {
  readonly auditId: string;
  readonly recordedAt: string;
  readonly taskId: string;
  readonly queryArtifactId?: string;
  readonly sqlHash?: string;
  readonly specVersion?: string;
  readonly specStatus?: "available" | "unavailable";
  /** Whether the Answer Spec came from the planner or the basic fallback. */
  readonly specGenerationStatus?: "generated" | "fallback";
  /** Bounded, non-secret diagnostic for a failed planner attempt. */
  readonly specGenerationFailure?: SpecGenerationFailure;
  /** Bounded diagnostic for a reviewer request that could not complete. */
  readonly reviewFailure?: ReviewFailureAudit;
  readonly schemaEvidenceFingerprint?: string;
  /** Stable identity of Runtime-selected business evidence; raw text is never audited. */
  readonly semanticEvidenceFingerprint?: string;
  readonly queryDigestVersion?: string;
  readonly parserVersion?: string;
  readonly parserEngine?: "sqlglot" | "deterministic-tokenizer";
  readonly dialect?: string;
  readonly gatePolicyVersion?: string;
  readonly gateApplicabilityVersion?: string;
  readonly probeTemplateVersion?: string;
  readonly evidenceAdmissionPolicyVersion?: string;
  readonly reviewerModel?: string;
  readonly reviewerPromptVersion?: string;
  readonly reviewPolicyVersion?: string;
  readonly reviewCoverageSchemaVersion?: string;
  readonly hardConstraintAdmissionPolicy?: string;
  readonly reviewAvailability: "available" | "unavailable" | "off";
  readonly decision?: string;
  /** Bounded reason for Abstained/Needs Clarification and other non-approval outcomes. */
  readonly decisionReason?: string;
  /** Bounded reviewer warnings retained without raw rows or reasoning. */
  readonly reviewWarnings?: readonly string[];
  readonly coverage?: ReviewCoverage;
  readonly semanticDiffs?: readonly SemanticDiff[];
  readonly deterministicGates?: readonly GateResult[];
  /** Probe status and frozen identity only; probe evidence is not audited raw. */
  readonly probeOutcomes?: readonly ProbeOutcomeAudit[];
  readonly repairAttempt: number;
  readonly publicationStatus?: PublicationStatus;
  readonly reviewMode: QueryAssuranceMode;
  readonly cacheHit?: boolean;
  readonly latencyMs?: number;
  readonly tokens?: number;
  readonly cost?: number;
}

export type AssuranceAuditInput = Omit<AssuranceAuditRecord, "auditId" | "recordedAt"> & Record<string, unknown>;

export interface AssuranceAuditStore {
  append(input: AssuranceAuditInput): AssuranceAuditRecord;
  list(taskId?: string): readonly AssuranceAuditRecord[];
  snapshot?(): readonly AssuranceAuditRecord[];
  restore?(records: readonly AssuranceAuditRecord[]): void;
}

export class InMemoryAssuranceAuditStore implements AssuranceAuditStore {
  private readonly records: AssuranceAuditRecord[] = [];
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) { this.now = options.now ?? Date.now; }

  append(input: AssuranceAuditInput): AssuranceAuditRecord {
    const record: AssuranceAuditRecord = {
      auditId: randomUUID(),
      recordedAt: new Date(this.now()).toISOString(),
      taskId: input.taskId,
      ...(input.queryArtifactId ? { queryArtifactId: input.queryArtifactId } : {}),
      ...(input.sqlHash ? { sqlHash: input.sqlHash } : {}),
      ...(input.specVersion ? { specVersion: input.specVersion } : {}),
      ...(input.specStatus ? { specStatus: input.specStatus } : {}),
      ...(input.specGenerationStatus ? { specGenerationStatus: input.specGenerationStatus } : {}),
      ...(input.specGenerationFailure ? { specGenerationFailure: { ...input.specGenerationFailure } } : {}),
      ...(input.reviewFailure ? { reviewFailure: { ...input.reviewFailure } } : {}),
      ...(input.schemaEvidenceFingerprint ? { schemaEvidenceFingerprint: input.schemaEvidenceFingerprint } : {}),
      ...(input.semanticEvidenceFingerprint ? { semanticEvidenceFingerprint: input.semanticEvidenceFingerprint } : {}),
      ...(input.queryDigestVersion ? { queryDigestVersion: input.queryDigestVersion } : {}),
      ...(input.parserVersion ? { parserVersion: input.parserVersion } : {}),
      ...(input.parserEngine ? { parserEngine: input.parserEngine } : {}),
      ...(input.dialect ? { dialect: input.dialect } : {}),
      ...(input.gatePolicyVersion ? { gatePolicyVersion: input.gatePolicyVersion } : {}),
      ...(input.gateApplicabilityVersion ? { gateApplicabilityVersion: input.gateApplicabilityVersion } : {}),
      ...(input.probeTemplateVersion ? { probeTemplateVersion: input.probeTemplateVersion } : {}),
      ...(input.evidenceAdmissionPolicyVersion ? { evidenceAdmissionPolicyVersion: input.evidenceAdmissionPolicyVersion } : {}),
      ...(input.reviewerModel ? { reviewerModel: input.reviewerModel } : {}),
      ...(input.reviewerPromptVersion ? { reviewerPromptVersion: input.reviewerPromptVersion } : {}),
      ...(input.reviewPolicyVersion ? { reviewPolicyVersion: input.reviewPolicyVersion } : {}),
      ...(input.reviewCoverageSchemaVersion ? { reviewCoverageSchemaVersion: input.reviewCoverageSchemaVersion } : {}),
      ...(input.hardConstraintAdmissionPolicy ? { hardConstraintAdmissionPolicy: input.hardConstraintAdmissionPolicy } : {}),
      reviewAvailability: input.reviewAvailability,
      ...(input.decision ? { decision: input.decision } : {}),
      ...(input.decisionReason ? { decisionReason: String(input.decisionReason).slice(0, 2_000) } : {}),
      ...(Array.isArray(input.reviewWarnings) ? { reviewWarnings: input.reviewWarnings.filter((item): item is string => typeof item === "string").slice(0, 10).map((item) => item.slice(0, 500)) } : {}),
      ...(input.coverage ? { coverage: input.coverage } : {}),
      ...(input.semanticDiffs ? { semanticDiffs: input.semanticDiffs.map((diff) => ({ ...diff, evidence: { ...diff.evidence } })) } : {}),
      ...(Array.isArray(input.deterministicGates) ? { deterministicGates: input.deterministicGates } : {}),
      ...(Array.isArray(input.probeOutcomes) ? { probeOutcomes: input.probeOutcomes.map((probe) => ({ ...probe })) } : {}),
      repairAttempt: input.repairAttempt,
      ...(input.publicationStatus ? { publicationStatus: input.publicationStatus } : {}),
      reviewMode: input.reviewMode,
      ...(input.cacheHit !== undefined ? { cacheHit: input.cacheHit } : {}),
      ...(input.latencyMs !== undefined ? { latencyMs: input.latencyMs } : {}),
      ...(input.tokens !== undefined ? { tokens: input.tokens } : {}),
      ...(input.cost !== undefined ? { cost: input.cost } : {}),
    };
    this.records.push(record);
    return record;
  }

  list(taskId?: string): readonly AssuranceAuditRecord[] {
    return this.records.filter((record) => taskId === undefined || record.taskId === taskId).map((record) => ({ ...record }));
  }

  snapshot(): readonly AssuranceAuditRecord[] { return this.records.map((record) => ({ ...record })); }

  restore(records: readonly AssuranceAuditRecord[]): void {
    this.records.length = 0;
    this.records.push(...records.map((record) => ({ ...record })));
  }
}
