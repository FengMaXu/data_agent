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
