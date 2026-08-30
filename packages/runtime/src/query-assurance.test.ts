import { describe, expect, it } from "vitest";
import { InMemoryQueryAssurance, createReviewOffQueryAssurance } from "./query-assurance.js";

describe("Review Off QueryAssurance", () => {
  it("prepares a task with an explicit off mode", async () => {
    const assurance = createReviewOffQueryAssurance();
    const task = await assurance.prepareTask({ question: "How many orders?" }, new AbortController().signal);

    expect(assurance.mode).toBe("off");
    expect(task).toMatchObject({ mode: "off" });
    expect(task.taskId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("downgrades an uncalibrated enforce request to Shadow Review", () => {
    expect(new InMemoryQueryAssurance({ mode: "enforce" }).mode).toBe("shadow");
  });

  it("reports review unavailable instead of fabricating an Approved decision", async () => {
    const assurance = createReviewOffQueryAssurance();
    const task = await assurance.prepareTask({ question: "How many orders?" }, new AbortController().signal);

    await expect(assurance.reviewForPublication({ task, candidate: { queryArtifactId: "artifact-1" } }, new AbortController().signal)).resolves.toEqual({
      availability: "unavailable",
      failure: {
        code: "REVIEW_OFF",
        message: "Query Assurance review is disabled",
        retryable: false,
      },
    });
  });

  it("keeps separate Query Tasks and records immutable preview Artifacts", async () => {
    const assurance = createReviewOffQueryAssurance();
    const signal = new AbortController().signal;
    const first = await assurance.prepareTask({ question: "How many orders?" }, signal);
    const second = await assurance.prepareTask({ question: "How many customers?" }, signal);
    const artifact = await assurance.recordPreview?.({
      task: first,
      sql: " SELECT id FROM orders; ",
      result: { columns: ["id"], rows: [[1], [2]], truncated: false },
      dialect: "sqlite",
      schema: { connectionId: "connection", dialect: "sqlite", tables: [{ name: "orders", columns: ["id"] }] },
    }, signal);

    expect(first.taskId).not.toBe(second.taskId);
    expect(artifact).toMatchObject({
      taskId: first.taskId,
      normalizedSqlHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      previewMetadata: { columns: ["id"], rowCount: 2, truncated: false },
      queryDigest: { dialect: "sqlite", schemaEvidenceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) },
      schemaEvidence: { connectionId: "connection", dialect: "sqlite", tables: [{ name: "orders", columns: ["id"] }] },
      internalEvidence: true,
    });
    expect(await assurance.getArtifact?.(first.taskId, artifact!.queryArtifactId, signal)).toEqual(artifact);
    expect(await assurance.getArtifact?.(second.taskId, artifact!.queryArtifactId, signal)).toBeUndefined();
  });

  it("does not return expired Artifacts", async () => {
    let now = 1_000;
    const assurance = createReviewOffQueryAssurance({ artifactTtlMs: 100, now: () => now });
    const task = await assurance.prepareTask({ question: "How many orders?" }, new AbortController().signal);
    const artifact = await assurance.recordPreview?.({ task, sql: "SELECT 1", result: { columns: ["answer"], rows: [[1]], truncated: false } }, new AbortController().signal);

    now += 101;
    await expect(assurance.getArtifact?.(task.taskId, artifact!.queryArtifactId, new AbortController().signal)).resolves.toBeUndefined();
  });

  it("delegates a complete publication input to a configured reviewer in shadow mode", async () => {
    let calls = 0;
    const assurance = new InMemoryQueryAssurance({
      mode: "shadow",
      reviewer: {
        review: async (input) => {
          calls += 1;
          expect(input.sql).toBe("SELECT 1");
          return { status: "approved", coverage: { projection: "checked" } };
        },
      },
    });
    const task = await assurance.prepareTask({ question: "How many?" }, new AbortController().signal);
    const outcome = await assurance.reviewForPublication({ task, candidate: "candidate", reviewInput: {
      question: "How many?",
      clarifications: [],
      answerSpec: { taskId: task.taskId, specVersion: "1", question: "How many?", hardConstraints: [], hypotheses: [], ambiguities: [], provenance: [] },
      schema: { connectionId: "connection", dialect: "sqlite", tables: [] },
      sql: "SELECT 1",
      digest: { normalizedSql: "SELECT 1", normalizedSqlHash: "hash", dialect: "sqlite", parserVersion: "p", queryDigestVersion: "1", schemaEvidenceFingerprint: "schema", sources: [], joins: [], filters: [], measures: [], groupBy: [], projections: [], outputLineage: [], windows: [], orderBy: [], setOperations: [], nullHandling: [], coverage: {}, unsupportedNodes: [], lineageCompleteness: "complete" },
      resultMetadata: { columns: ["answer"], columnTypes: ["INTEGER"], rowCount: 1, truncated: false, nullCounts: { answer: 0 } },
    } }, new AbortController().signal);

    expect(calls).toBe(1);
    expect(outcome).toMatchObject({ availability: "available", decision: { status: "approved" }, cacheHit: false });
    const cached = await assurance.reviewForPublication({ task, candidate: "candidate", reviewInput: {
      question: "How many?",
      clarifications: [],
      answerSpec: { taskId: task.taskId, specVersion: "1", question: "How many?", hardConstraints: [], hypotheses: [], ambiguities: [], provenance: [] },
      schema: { connectionId: "connection", dialect: "sqlite", tables: [] },
      sql: "SELECT 1",
      digest: { normalizedSql: "SELECT 1", normalizedSqlHash: "hash", dialect: "sqlite", parserVersion: "p", queryDigestVersion: "1", schemaEvidenceFingerprint: "schema", sources: [], joins: [], filters: [], measures: [], groupBy: [], projections: [], outputLineage: [], windows: [], orderBy: [], setOperations: [], nullHandling: [], coverage: {}, unsupportedNodes: [], lineageCompleteness: "complete" },
      resultMetadata: { columns: ["answer"], columnTypes: ["INTEGER"], rowCount: 1, truncated: false, nullCounts: { answer: 0 } },
    } }, new AbortController().signal);
    expect(cached).toMatchObject({ availability: "available", cacheHit: true });
    expect(calls).toBe(1);
  });

  it("marks a failed Spec Generator unavailable instead of fabricating an empty Spec", async () => {
    const assurance = new InMemoryQueryAssurance({ specGenerator: { generate: async () => { throw new Error("SPEC_GENERATOR_TIMEOUT"); } } });
    const task = await assurance.prepareTask({ question: "q" }, new AbortController().signal);
    expect(task).toMatchObject({ specStatus: "unavailable" });
    expect(assurance.getAnswerSpec?.(task.taskId)).toBeUndefined();
  });

  it("converts reviewer failures to Review Unavailable rather than Approved", async () => {
    const assurance = new InMemoryQueryAssurance({ mode: "shadow", reviewer: { review: async () => { throw new Error("PROVIDER_TIMEOUT"); } } });
    const task = await assurance.prepareTask({ question: "q" }, new AbortController().signal);
    await expect(assurance.reviewForPublication({ task, candidate: "candidate", reviewInput: {} as any }, new AbortController().signal)).resolves.toMatchObject({ availability: "unavailable", failure: { code: "REVIEW_INPUT_INCOMPLETE" } });
  });

  it("propagates cancellation at both lifecycle operations", async () => {
    const assurance = createReviewOffQueryAssurance();
    const controller = new AbortController();
    controller.abort();

    await expect(assurance.prepareTask({ question: "How many orders?" }, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
      code: "QUERY_ASSURANCE_ABORTED",
    });
    await expect(assurance.reviewForPublication({ task: { taskId: "task-1", mode: "off" }, candidate: "candidate-1" }, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
      code: "QUERY_ASSURANCE_ABORTED",
    });
  });
});
