import { describe, expect, it } from "vitest";
import { createReviewOffQueryAssurance } from "./query-assurance.js";

describe("Review Off QueryAssurance", () => {
  it("prepares a task with an explicit off mode", async () => {
    const assurance = createReviewOffQueryAssurance();
    const task = await assurance.prepareTask({ question: "How many orders?" }, new AbortController().signal);

    expect(assurance.mode).toBe("off");
    expect(task).toMatchObject({ mode: "off" });
    expect(task.taskId).toMatch(/^[0-9a-f-]{36}$/i);
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
    }, signal);

    expect(first.taskId).not.toBe(second.taskId);
    expect(artifact).toMatchObject({
      taskId: first.taskId,
      normalizedSqlHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      previewMetadata: { columns: ["id"], rowCount: 2, truncated: false },
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
