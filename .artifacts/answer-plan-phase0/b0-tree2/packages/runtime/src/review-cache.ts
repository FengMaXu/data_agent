import { createHash } from "node:crypto";
import type { ReviewOutcome } from "./query-assurance.js";

export interface ReviewCacheIdentity {
  readonly taskId: string;
  readonly taskQuestionHash: string;
  readonly specVersion: string;
  readonly schemaEvidenceFingerprint: string;
  readonly normalizedSqlHash: string;
  readonly queryDigestVersion: string;
  readonly parserEngine: "sqlglot" | "deterministic-tokenizer";
  readonly dialect: string;
  readonly reviewerModel: string;
  readonly reviewerPromptVersion: string;
  readonly reviewPolicyVersion: string;
  readonly hardConstraintAdmissionPolicy: string;
  readonly reviewCoverageSchemaVersion: string;
  readonly parserVersion: string;
  readonly gatePolicyVersion?: string;
  readonly gateApplicabilityVersion?: string;
  readonly probeTemplateVersion?: string;
  readonly evidenceAdmissionPolicyVersion?: string;
  /** Runtime-selected business evidence is part of the review context. */
  readonly semanticEvidenceFingerprint: string;
  /** Result values are part of review evidence; identical SQL may yield a different result later. */
  readonly resultEvidenceHash: string;
}

export interface ReviewCacheEntry {
  readonly key: string;
  readonly outcome: ReviewOutcome;
}

export interface CachedReviewOutcome {
  readonly outcome: ReviewOutcome;
  readonly cacheHit: boolean;
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}

function keyOf(identity: ReviewCacheIdentity): string {
  return createHash("sha256").update(stable(identity), "utf8").digest("hex");
}

export class ReviewCache {
  private readonly stored = new Map<string, ReviewCacheEntry>();
  private readonly inFlight = new Map<string, Promise<ReviewOutcome>>();

  async getOrCreate(identity: ReviewCacheIdentity, loader: () => Promise<ReviewOutcome>, signal?: AbortSignal): Promise<CachedReviewOutcome> {
    if (signal?.aborted) throw new Error("REVIEW_CACHE_ABORTED");
    const key = keyOf(identity);
    const existing = this.stored.get(key);
    if (existing) return { outcome: existing.outcome, cacheHit: true };
    const pending = this.inFlight.get(key);
    if (pending) return { outcome: await pending, cacheHit: false };
    const operation = loader();
    this.inFlight.set(key, operation);
    try {
      const outcome = await operation;
      if (outcome.availability === "available") this.stored.set(key, { key, outcome });
      return { outcome, cacheHit: false };
    } finally {
      if (this.inFlight.get(key) === operation) this.inFlight.delete(key);
    }
  }

  entries(): ReviewCacheEntry[] { return [...this.stored.values()].map((entry) => ({ key: entry.key, outcome: entry.outcome })); }
  clear(): void { this.stored.clear(); }
}
