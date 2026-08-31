import { describe, expect, it } from "vitest";
import { InMemoryQueryAssurance, createReviewOffQueryAssurance } from "./query-assurance.js";
import { REVIEW_COVERAGE_FACETS } from "./conversation-blind-reviewer.js";
import { InMemoryAssuranceAuditStore } from "./assurance-audit.js";

describe("Review Off QueryAssurance", () => {
  it("prepares a task with an explicit off mode", async () => {
    const assurance = createReviewOffQueryAssurance();
    const task = await assurance.prepareTask({ question: "How many orders?" }, new AbortController().signal);

    expect(assurance.mode).toBe("off");
    expect(task).toMatchObject({ mode: "off" });
    expect(task.taskId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("does not silently change an explicit enforce mode without a controller", () => {
    expect(new InMemoryQueryAssurance({ mode: "enforce" }).mode).toBe("enforce");
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
          return { status: "approved", coverage: Object.fromEntries(REVIEW_COVERAGE_FACETS.map((facet) => [facet, { status: "not_applicable" }])) };
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

  it("blocks a hard Answer Contract mismatch even while reviewer mode is shadow", async () => {
    let reviewerCalls = 0;
    const assurance = new InMemoryQueryAssurance({
      mode: "shadow",
      reviewer: { review: async () => { reviewerCalls += 1; return { status: "approved", coverage: {} }; } },
    });
    const task = await assurance.prepareTask({
      question: "Return the requested answer column",
      answerContract: {
        output: { value: { columns: ["wanted"], rowMode: "scalar" }, authority: "request_wording", source: "question" },
      },
    }, new AbortController().signal);
    const artifact = await assurance.recordPreview?.({
      task,
      sql: "SELECT 1 AS actual",
      result: { columns: ["actual"], rows: [[1]], truncated: false },
      dialect: "sqlite",
      schema: { connectionId: "connection", dialect: "sqlite", tables: [] },
    }, new AbortController().signal);
    const metadata = artifact!.previewMetadata;
    const candidate = {
      candidateId: "candidate-1",
      taskId: task.taskId,
      queryArtifactId: artifact!.queryArtifactId,
      normalizedSqlHash: artifact!.normalizedSqlHash,
      specVersion: task.specVersion,
      schemaEvidenceFingerprint: artifact!.queryDigest!.schemaEvidenceFingerprint,
      path: "inline://candidate-1",
      contentSha256: "content-1",
      metadata,
    };
    const spec = assurance.getAnswerSpec(task.taskId, task.specVersion)!;
    const outcome = await assurance.reviewForPublication({
      task,
      candidate,
      reviewInput: { question: spec.question, clarifications: [], answerSpec: spec, schema: { connectionId: "connection", dialect: "sqlite", tables: [] }, sql: artifact!.normalizedSql, digest: artifact!.queryDigest!, resultMetadata: metadata, resultEvidence: metadata.resultEvidence },
    }, new AbortController().signal);
    expect(outcome).toMatchObject({ availability: "available", decision: { status: "rejected", blocking: true, diffs: [{ aspect: "projection" }] } });
    expect(reviewerCalls).toBe(0);
  });

  it("rejects a candidate whose binding does not match the stored Artifact", async () => {
    const assurance = new InMemoryQueryAssurance();
    const task = await assurance.prepareTask({ question: "q" }, new AbortController().signal);
    const artifact = await assurance.recordPreview?.({ task, sql: "SELECT 1", result: { columns: ["answer"], rows: [[1]], truncated: false } }, new AbortController().signal);
    const outcome = await assurance.reviewForPublication({
      task,
      candidate: {
        candidateId: "candidate-1",
        taskId: task.taskId,
        queryArtifactId: artifact!.queryArtifactId,
        normalizedSqlHash: "forged",
        specVersion: task.specVersion,
        schemaEvidenceFingerprint: "unknown",
        metadata: artifact!.previewMetadata,
      },
    }, new AbortController().signal);
    expect(outcome).toMatchObject({ availability: "unavailable", failure: { code: "REVIEW_CANDIDATE_BINDING_INVALID" } });
    expect(outcome).not.toHaveProperty("reviewToken");
  });

  it("allows one Automatic Semantic Repair per Spec version and resets on a new version", async () => {
    const assurance = new InMemoryQueryAssurance();
    expect(assurance.claimAutomaticRepair?.("task-1", "1")).toEqual({ allowed: true, attempt: 1 });
    expect(assurance.claimAutomaticRepair?.("task-1", "1")).toEqual({ allowed: false, attempt: 1 });
    expect(assurance.claimAutomaticRepair?.("task-1", "2")).toEqual({ allowed: true, attempt: 1 });
  });

  it("passes schema to the planner and persists its structured contract", async () => {
    let plannerInput: any;
    const assurance = new InMemoryQueryAssurance({
      specGenerator: {
        generate: async (input) => {
          plannerInput = input;
          return {
            ...input,
            answerContract: {
              output: { value: { columns: ["customer_id", "average_payments"], rowMode: "grouped" }, authority: "model_inference", source: "planner" },
              grain: { value: { entity: "customer", keyColumns: ["customer_id"] }, authority: "model_inference", source: "planner" },
              measures: [{ value: { kind: "avg", name: "average_payments" }, authority: "model_inference", source: "planner" }],
              denominator: { value: { expression: "COUNT(DISTINCT customer_id)", population: "all customers" }, authority: "model_inference", source: "planner" },
            },
          };
        },
      },
    });
    const task = await assurance.prepareTask({
      question: "What is the average payment count per customer?",
      schema: { connectionId: "connection", dialect: "sqlite", tables: [{ name: "payments", columns: ["customer_id"] }] },
    }, new AbortController().signal);
    const spec = assurance.getAnswerSpec(task.taskId, task.specVersion)!;
    expect(plannerInput.schema).toMatchObject({ connectionId: "connection" });
    expect(spec.answerContract).toMatchObject({
      output: { value: { columns: ["customer_id", "average_payments"], rowMode: "grouped" }, binding: "hypothesis" },
      grain: { value: { keyColumns: ["customer_id"] }, binding: "hypothesis" },
      denominator: { value: { population: "all customers" }, binding: "hypothesis" },
    });
  });

  it("accepts legacy string planner fields without losing the Query Task", async () => {
    const assurance = new InMemoryQueryAssurance({
      specGenerator: {
        generate: async (input) => ({
          ...input,
          hypotheses: ["The reference date is unresolved"] as any,
          ambiguities: ["Which reference date should be used?"] as any,
        }),
      },
    });
    const task = await assurance.prepareTask({ question: "Calculate recency" }, new AbortController().signal);
    expect(task).toMatchObject({ specStatus: "available", specGenerationStatus: "generated" });
    expect(task.answerSpec?.hypotheses[0]).toMatchObject({ statement: "The reference date is unresolved" });
    expect(task.answerSpec?.ambiguities[0]).toMatchObject({ question: "Which reference date should be used?", alternatives: [] });
  });

  it("falls back to a basic Answer Spec and audits the real Spec Generator failure", async () => {
    const auditStore = new InMemoryAssuranceAuditStore();
    const assurance = new InMemoryQueryAssurance({
      auditStore,
      specGenerator: { generate: async () => { throw new Error("SPEC_GENERATOR_TIMEOUT: planner exceeded 30s"); } },
    });
    const task = await assurance.prepareTask({
      question: "Return customer_id",
      outputColumns: ["customer_id"],
      rowMode: "full",
    }, new AbortController().signal);

    expect(task).toMatchObject({ specStatus: "available", specGenerationStatus: "fallback", specVersion: "1" });
    expect(assurance.getAnswerSpec?.(task.taskId)).toMatchObject({
      question: "Return customer_id",
      outputColumns: ["customer_id"],
      rowMode: "full",
    });
    expect(auditStore.list(task.taskId)).toEqual([
      expect.objectContaining({
        taskId: task.taskId,
        specStatus: "available",
        specGenerationStatus: "fallback",
        specGenerationFailure: {
          code: "SPEC_GENERATOR_TIMEOUT",
          message: "SPEC_GENERATOR_TIMEOUT: planner exceeded 30s",
        },
      }),
    ]);
  });

  it("does not convert cancellation into a fallback Answer Spec", async () => {
    const assurance = new InMemoryQueryAssurance({
      specGenerator: {
        generate: async (_input, signal) => {
          await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("provider aborted")), { once: true }));
          throw new Error("unreachable");
        },
      },
    });
    const controller = new AbortController();
    const pending = assurance.prepareTask({ question: "q" }, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError", code: "QUERY_ASSURANCE_ABORTED" });
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
