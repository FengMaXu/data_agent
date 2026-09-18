import { describe, expect, it } from "vitest";
import { ReviewCache, type ReviewCacheIdentity } from "./review-cache.js";

const identity = (overrides: Partial<ReviewCacheIdentity> = {}): ReviewCacheIdentity => ({
  taskId: "task-1",
  taskQuestionHash: "question-1",
  specVersion: "spec-1",
  schemaEvidenceFingerprint: "schema-1",
  normalizedSqlHash: "sql-1",
  queryDigestVersion: "digest-1",
  parserEngine: "deterministic-tokenizer",
  dialect: "sqlite",
  reviewerModel: "model-1",
  reviewerPromptVersion: "prompt-1",
  reviewPolicyVersion: "policy-1",
  hardConstraintAdmissionPolicy: "hard-1",
  reviewCoverageSchemaVersion: "coverage-1",
  parserVersion: "parser-1",
  semanticEvidenceFingerprint: "semantic-1",
  resultEvidenceHash: "result-1",
  ...overrides,
});

const approved = { availability: "available", decision: { status: "approved", coverage: { projection: "checked" } } } as const;

describe("ReviewCache", () => {
  it("deduplicates concurrent reviews and reports cache hits", async () => {
    const cache = new ReviewCache();
    let calls = 0;
    const loader = async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return approved; };
    const first = await Promise.all([
      cache.getOrCreate(identity(), loader),
      cache.getOrCreate(identity(), loader),
    ]);
    const second = await cache.getOrCreate(identity(), loader);

    expect(calls).toBe(1);
    expect(first.map((item) => item.cacheHit)).toEqual([false, false]);
    expect(second).toMatchObject({ cacheHit: true, outcome: approved });
  });

  it("invalidates every versioned identity component and never caches unavailable outcomes", async () => {
    const cache = new ReviewCache();
    let calls = 0;
    const loader = async () => { calls += 1; return approved; };
    await cache.getOrCreate(identity(), loader);
    for (const field of Object.keys(identity()) as Array<keyof ReviewCacheIdentity>) {
      await cache.getOrCreate(identity({ [field]: `${identity()[field]}-changed` }), loader);
    }
    expect(calls).toBe(1 + Object.keys(identity()).length);
    await cache.getOrCreate(identity({ taskId: "task-2" }), loader);
    expect(calls).toBe(2 + Object.keys(identity()).length);

    let unavailableCalls = 0;
    const unavailable = async () => { unavailableCalls += 1; return { availability: "unavailable", failure: { code: "TIMEOUT", message: "timeout", retryable: true } } as const; };
    await cache.getOrCreate(identity({ normalizedSqlHash: "unavailable" }), unavailable);
    await cache.getOrCreate(identity({ normalizedSqlHash: "unavailable" }), unavailable);
    expect(unavailableCalls).toBe(2);
  });

  it("stores only the review identity and outcome, not loader input", async () => {
    const cache = new ReviewCache();
    await cache.getOrCreate(identity(), async () => approved);
    expect(cache.entries()).toMatchObject([{ key: expect.stringMatching(/^[a-f0-9]{64}$/), outcome: approved }]);
    expect(JSON.stringify(cache.entries())).not.toContain("password");
  });
});
