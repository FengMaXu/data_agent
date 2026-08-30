import { randomUUID } from "node:crypto";
import type { ReviewCoverage, SemanticDiff } from "./conversation-blind-reviewer.js";
import type { PublicationStatus } from "./publication.js";
import type { QueryAssuranceMode } from "./query-assurance.js";

export interface AssuranceAuditRecord {
  readonly auditId: string;
  readonly recordedAt: string;
  readonly taskId: string;
  readonly queryArtifactId?: string;
  readonly sqlHash?: string;
  readonly specVersion?: string;
  readonly schemaEvidenceFingerprint?: string;
  readonly queryDigestVersion?: string;
  readonly reviewerModel?: string;
  readonly reviewerPromptVersion?: string;
  readonly reviewPolicyVersion?: string;
  readonly reviewAvailability: "available" | "unavailable" | "off";
  readonly decision?: string;
  readonly coverage?: ReviewCoverage;
  readonly semanticDiffs?: readonly SemanticDiff[];
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
      ...(input.schemaEvidenceFingerprint ? { schemaEvidenceFingerprint: input.schemaEvidenceFingerprint } : {}),
      ...(input.queryDigestVersion ? { queryDigestVersion: input.queryDigestVersion } : {}),
      ...(input.reviewerModel ? { reviewerModel: input.reviewerModel } : {}),
      ...(input.reviewerPromptVersion ? { reviewerPromptVersion: input.reviewerPromptVersion } : {}),
      ...(input.reviewPolicyVersion ? { reviewPolicyVersion: input.reviewPolicyVersion } : {}),
      reviewAvailability: input.reviewAvailability,
      ...(input.decision ? { decision: input.decision } : {}),
      ...(input.coverage ? { coverage: input.coverage } : {}),
      ...(input.semanticDiffs ? { semanticDiffs: input.semanticDiffs.map((diff) => ({ ...diff, evidence: { ...diff.evidence } })) } : {}),
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
}
