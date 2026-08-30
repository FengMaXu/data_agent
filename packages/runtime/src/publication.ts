import { randomUUID } from "node:crypto";
import type { ExportCandidate } from "./export-candidate.js";
import type { QueryAssuranceMode, ReviewOutcome } from "./query-assurance.js";
import { DeliveryPolicy } from "./review-policy.js";

export type PublicationStatus = "published_approved" | "published_with_disagreement" | "not_published_rejected" | "not_published_review_unavailable";

export interface ReviewToken {
  readonly tokenId: string;
  readonly taskId: string;
  readonly queryArtifactId: string;
  readonly normalizedSqlHash: string;
  readonly specVersion: string;
  readonly schemaEvidenceFingerprint: string;
  readonly candidateId: string;
  readonly outcome: ReviewOutcome;
  readonly reviewerVersion?: string;
  readonly policyVersion?: string;
  readonly issuedAt: string;
}

export interface ReviewTokenInput {
  readonly taskId: string;
  readonly queryArtifactId: string;
  readonly normalizedSqlHash: string;
  readonly specVersion: string;
  readonly schemaEvidenceFingerprint: string;
  readonly candidate: ExportCandidate;
  readonly outcome: ReviewOutcome;
  readonly reviewerVersion?: string;
  readonly policyVersion?: string;
}

export interface PublicationAuthorization {
  readonly taskId: string;
  readonly queryArtifactId: string;
  readonly normalizedSqlHash: string;
  readonly specVersion: string;
  readonly candidateId: string;
  readonly semanticDiffHashes: readonly string[];
}

export interface PublicationReceipt {
  readonly receiptId: string;
  readonly taskId: string;
  readonly queryArtifactId: string;
  readonly candidateId: string;
  readonly status: PublicationStatus;
  readonly reviewOutcome: ReviewOutcome;
  readonly mode: QueryAssuranceMode;
  readonly targetPath: string;
  readonly authorization?: PublicationAuthorization;
  readonly publishedAt: string;
}

export interface PublicationRegistryOptions {
  readonly mode: QueryAssuranceMode;
  readonly modeFor?: () => QueryAssuranceMode;
  readonly specVersionFor?: (taskId: string) => string | undefined;
  readonly publishCandidate?: (candidate: ExportCandidate, targetPath: string) => Promise<void>;
  readonly now?: () => number;
}

function candidateMetadataMatchesToken(token: ReviewToken, candidate: ExportCandidate): boolean {
  const bound = candidate as ExportCandidate & { normalizedSqlHash?: string; specVersion?: string; schemaEvidenceFingerprint?: string };
  return (bound.normalizedSqlHash === undefined || token.normalizedSqlHash === bound.normalizedSqlHash)
    && (bound.specVersion === undefined || token.specVersion === bound.specVersion)
    && (bound.schemaEvidenceFingerprint === undefined || token.schemaEvidenceFingerprint === bound.schemaEvidenceFingerprint);
}

function candidateMatchesToken(token: ReviewToken, candidate: ExportCandidate): boolean {
  return token.taskId === candidate.taskId
    && token.queryArtifactId === candidate.queryArtifactId
    && token.candidateId === candidate.candidateId
    && candidateMetadataMatchesToken(token, candidate);
}

export class PublicationRegistry {
  private readonly receipts = new Map<string, PublicationReceipt>();
  private readonly inFlight = new Map<string, Promise<PublicationReceipt>>();
  private readonly activeTasks = new Set<string>();
  private readonly tokens = new Map<string, ReviewToken>();
  private readonly artifactReceipts = new Map<string, PublicationReceipt>();
  private readonly artifactInFlight = new Map<string, Promise<PublicationReceipt>>();
  private readonly now: () => number;

  constructor(private readonly options: PublicationRegistryOptions) {
    this.now = options.now ?? Date.now;
  }

  hasReceipt(taskId: string): boolean { return [...this.receipts.values()].some((receipt) => receipt.taskId === taskId); }
  receiptForArtifact(taskId: string, queryArtifactId: string): PublicationReceipt | undefined { return this.artifactReceipts.get(`${taskId}:${queryArtifactId}`); }

  issueToken(input: ReviewTokenInput): ReviewToken {
    if (input.candidate.taskId !== input.taskId || input.candidate.queryArtifactId !== input.queryArtifactId) throw new Error("REVIEW_TOKEN_CANDIDATE_BINDING_INVALID");
    const token: ReviewToken = {
      tokenId: randomUUID(),
      taskId: input.taskId,
      queryArtifactId: input.queryArtifactId,
      normalizedSqlHash: input.normalizedSqlHash,
      specVersion: input.specVersion,
      schemaEvidenceFingerprint: input.schemaEvidenceFingerprint,
      candidateId: input.candidate.candidateId,
      outcome: input.outcome,
      ...(input.reviewerVersion ? { reviewerVersion: input.reviewerVersion } : {}),
      ...(input.policyVersion ? { policyVersion: input.policyVersion } : {}),
      issuedAt: new Date(this.now()).toISOString(),
    };
    this.tokens.set(token.tokenId, token);
    return token;
  }

  async publish(token: ReviewToken, candidate: ExportCandidate, targetPath: string, authorization?: PublicationAuthorization, promote?: () => Promise<void>): Promise<PublicationReceipt> {
    const known = this.tokens.get(token.tokenId);
    if (!known) throw new Error("REVIEW_TOKEN_UNKNOWN");
    if (known.taskId !== candidate.taskId || known.queryArtifactId !== candidate.queryArtifactId || !candidateMetadataMatchesToken(known, candidate)) throw new Error("REVIEW_TOKEN_CANDIDATE_MISMATCH");
    const artifactKey = `${known.taskId}:${known.queryArtifactId}`;
    const existingArtifact = this.artifactReceipts.get(artifactKey);
    if (existingArtifact) return existingArtifact;
    const existing = this.receipts.get(token.tokenId);
    if (existing) return existing;
    const pendingArtifact = this.artifactInFlight.get(artifactKey);
    if (pendingArtifact) return pendingArtifact;
    if (!candidateMatchesToken(known, candidate)) throw new Error("REVIEW_TOKEN_CANDIDATE_MISMATCH");
    const pending = this.inFlight.get(token.tokenId);
    if (pending) return pending;
    if (this.options.specVersionFor) {
      const current = this.options.specVersionFor(token.taskId);
      if (current !== undefined && current !== token.specVersion) throw new Error("REVIEW_TOKEN_SPEC_STALE");
    }
    this.validateAuthorization(known, authorization);
    if (this.activeTasks.has(token.taskId)) throw new Error("PUBLICATION_TASK_BUSY");
    this.activeTasks.add(token.taskId);
    const operation = this.publishOnce(known, candidate, targetPath, authorization, promote).then((receipt) => {
      this.artifactReceipts.set(artifactKey, receipt);
      return receipt;
    }).finally(() => {
      this.activeTasks.delete(token.taskId);
      this.inFlight.delete(token.tokenId);
      this.artifactInFlight.delete(artifactKey);
    });
    this.inFlight.set(token.tokenId, operation);
    this.artifactInFlight.set(artifactKey, operation);
    return operation;
  }

  private validateAuthorization(token: ReviewToken, authorization?: PublicationAuthorization): void {
    if (!authorization) return;
    if (authorization.taskId !== token.taskId
      || authorization.queryArtifactId !== token.queryArtifactId
      || authorization.normalizedSqlHash !== token.normalizedSqlHash
      || authorization.specVersion !== token.specVersion
      || authorization.candidateId !== token.candidateId) throw new Error("PUBLICATION_AUTHORIZATION_MISMATCH");
  }

  private async publishOnce(token: ReviewToken, candidate: ExportCandidate, targetPath: string, authorization?: PublicationAuthorization, promote?: () => Promise<void>): Promise<PublicationReceipt> {
    const mode = this.options.modeFor?.() ?? this.options.mode;
    const policy = new DeliveryPolicy(mode);
    const delivery = policy.decide(token.outcome, authorization);
    if (!delivery.allowed) throw new Error(delivery.reason ?? "REVIEW_NOT_APPROVED");
    if (this.options.publishCandidate) await this.options.publishCandidate(candidate, targetPath);
    if (promote) await promote();
    const receipt: PublicationReceipt = {
      receiptId: randomUUID(),
      taskId: token.taskId,
      queryArtifactId: token.queryArtifactId,
      candidateId: candidate.candidateId,
      status: delivery.status,
      reviewOutcome: token.outcome,
      mode,
      targetPath,
      ...(authorization ? { authorization } : {}),
      publishedAt: new Date(this.now()).toISOString(),
    };
    this.receipts.set(token.tokenId, receipt);
    return receipt;
  }
}
