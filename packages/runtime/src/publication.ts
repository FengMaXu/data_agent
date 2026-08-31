import { createHash, randomUUID } from "node:crypto";
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
  readonly candidatePath: string;
  readonly contentSha256: string;
  readonly semanticDiffHashes: readonly string[];
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
  readonly candidatePath: string;
  readonly contentSha256: string;
  readonly semanticDiffHashes: readonly string[];
}

export interface PublicationReceipt {
  readonly receiptId: string;
  readonly taskId: string;
  readonly queryArtifactId: string;
  readonly candidateId: string;
  readonly candidatePath: string;
  readonly contentSha256: string;
  readonly status: PublicationStatus;
  readonly reviewOutcome: ReviewOutcome;
  readonly mode: QueryAssuranceMode;
  readonly targetPath: string;
  readonly authorization?: PublicationAuthorization;
  readonly publishedAt: string;
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}

export function semanticDiffHash(diff: unknown): string {
  return createHash("sha256").update(stable(diff), "utf8").digest("hex");
}

export interface PublicationRegistryOptions {
  readonly mode: QueryAssuranceMode;
  readonly modeFor?: () => QueryAssuranceMode;
  readonly allowUnavailablePublication?: boolean;
  readonly specVersionFor?: (taskId: string) => string | undefined;
  readonly publishCandidate?: (candidate: ExportCandidate, targetPath: string) => Promise<void>;
  readonly now?: () => number;
}

function candidateMetadataMatchesToken(token: ReviewToken, candidate: ExportCandidate): boolean {
  const bound = candidate as ExportCandidate & { normalizedSqlHash?: string; specVersion?: string; schemaEvidenceFingerprint?: string };
  return token.candidatePath === candidate.path
    && token.contentSha256 === candidate.contentSha256
    && (bound.normalizedSqlHash === undefined || token.normalizedSqlHash === bound.normalizedSqlHash)
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
  private readonly taskReceipts = new Map<string, PublicationReceipt>();
  private readonly now: () => number;

  constructor(private readonly options: PublicationRegistryOptions) {
    this.now = options.now ?? Date.now;
  }

  hasReceipt(taskId: string): boolean { return [...this.receipts.values()].some((receipt) => receipt.taskId === taskId); }
  receiptForTask(taskId: string): PublicationReceipt | undefined { return this.taskReceipts.get(taskId); }
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
      candidatePath: input.candidate.path,
      contentSha256: input.candidate.contentSha256,
      semanticDiffHashes: input.outcome.availability === "available" && input.outcome.decision.diffs
        ? input.outcome.decision.diffs.map(semanticDiffHash)
        : [],
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
    if (known.taskId !== candidate.taskId || known.queryArtifactId !== candidate.queryArtifactId || !candidateMatchesToken(known, candidate)) throw new Error("REVIEW_TOKEN_CANDIDATE_MISMATCH");
    const artifactKey = `${known.taskId}:${known.queryArtifactId}`;
    const existingTask = this.taskReceipts.get(known.taskId);
    if (existingTask && existingTask.queryArtifactId !== known.queryArtifactId) throw new Error("PUBLICATION_TASK_ALREADY_COMPLETE");
    const existingArtifact = this.artifactReceipts.get(artifactKey);
    if (existingArtifact) {
      if (existingArtifact.candidatePath !== candidate.path || existingArtifact.contentSha256 !== candidate.contentSha256) throw new Error("REVIEW_TOKEN_CANDIDATE_MISMATCH");
      return existingArtifact;
    }
    const existing = this.receipts.get(token.tokenId);
    if (existing) return existing;
    const pendingArtifact = this.artifactInFlight.get(artifactKey);
    if (pendingArtifact) return pendingArtifact;
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
      this.taskReceipts.set(receipt.taskId, receipt);
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
      || authorization.candidateId !== token.candidateId
      || authorization.candidatePath !== token.candidatePath
      || authorization.contentSha256 !== token.contentSha256
      || authorization.semanticDiffHashes.length !== token.semanticDiffHashes.length
      || [...authorization.semanticDiffHashes].sort().some((hash, index) => hash !== [...token.semanticDiffHashes].sort()[index])) throw new Error("PUBLICATION_AUTHORIZATION_MISMATCH");
  }

  private async publishOnce(token: ReviewToken, candidate: ExportCandidate, targetPath: string, authorization?: PublicationAuthorization, promote?: () => Promise<void>): Promise<PublicationReceipt> {
    const mode = this.options.modeFor?.() ?? this.options.mode;
    const policy = new DeliveryPolicy(mode, { allowUnavailablePublication: this.options.allowUnavailablePublication });
    const delivery = policy.decide(token.outcome, authorization);
    if (!delivery.allowed) throw new Error(delivery.reason ?? "REVIEW_NOT_APPROVED");
    if (this.options.publishCandidate) await this.options.publishCandidate(candidate, targetPath);
    if (promote) await promote();
    const receipt: PublicationReceipt = {
      receiptId: randomUUID(),
      taskId: token.taskId,
      queryArtifactId: token.queryArtifactId,
      candidateId: candidate.candidateId,
      candidatePath: candidate.path,
      contentSha256: candidate.contentSha256,
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
