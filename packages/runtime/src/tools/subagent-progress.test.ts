import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolProgress } from "@data-agent/contracts";
import { isToolProgress } from "@data-agent/contracts";
import { SubagentProgressTracker } from "./subagent-progress.js";
import type { ChildOutcome } from "../delegation/index.js";

const input = { tasks: [
  { key: "schema", role: "explorer" as const, task: "列出 orders 的列\n只要列名和类型" },
  { key: "values", role: "explorer" as const, task: "x".repeat(400) },
] };

function outcome(key: string, overrides: Partial<ChildOutcome> = {}): ChildOutcome {
  return { key, runId: key, childSessionId: `child-${key}`, targetRef: key, targetState: "current", staleReasons: [], status: "completed", terminalConfirmed: true, report: { markdown: "## r", truncated: false }, usage: { inputTokens: null, outputTokens: null, cost: null }, ...overrides };
}

describe("SubagentProgressTracker", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("publishes every child at start with a bounded single-line task", () => {
    const published: ToolProgress[] = [];
    new SubagentProgressTracker(input, (progress) => published.push(progress), () => 1_000).start();
    expect(published).toHaveLength(1);
    expect(isToolProgress(published[0])).toBe(true);
    const [schema, values] = published[0]!.children;
    expect(schema).toEqual({ key: "schema", role: "explorer", task: "列出 orders 的列 只要列名和类型", currentTool: null, toolCalls: 0, startedAt: 1_000, status: "running", output: "pending" });
    expect(values!.task.length).toBeLessThanOrEqual(200);
  });

  it("coalesces tool starts and publishes a settled child at once", () => {
    const published: ToolProgress[] = [];
    const tracker = new SubagentProgressTracker(input, (progress) => published.push(progress), () => 1_000);
    tracker.apply({ key: "schema", type: "started", at: 1_100 });
    tracker.apply({ key: "schema", type: "tool_started", toolName: "describe_table", at: 1_200 });
    tracker.apply({ key: "schema", type: "tool_started", toolName: "query_database", at: 1_300 });
    expect(published).toHaveLength(0);
    vi.advanceTimersByTime(250);
    expect(published).toHaveLength(1);
    expect(published[0]!.children[0]).toMatchObject({ startedAt: 1_100, currentTool: "query_database", toolCalls: 2, status: "running" });
    tracker.apply({ key: "schema", type: "settled", status: "completed", reported: true, at: 4_100 });
    expect(published).toHaveLength(2);
    expect(published[1]!.children[0]).toMatchObject({ status: "completed", output: "produced", endedAt: 4_100, currentTool: "query_database" });
  });

  it("settles children the delegation never reported and stops publishing after finish", () => {
    const published: ToolProgress[] = [];
    const clock = [1_000, 9_000];
    const tracker = new SubagentProgressTracker(input, (progress) => published.push(progress), () => clock.shift() ?? 9_000);
    tracker.apply({ key: "schema", type: "settled", status: "completed", reported: true, at: 5_000 });
    const final = tracker.finish([outcome("schema"), outcome("values", { status: "budget_exhausted", report: undefined })]);
    expect(final.get("schema")).toMatchObject({ status: "completed", endedAt: 5_000 });
    expect(final.get("values")).toMatchObject({ status: "budget_exhausted", output: "none", endedAt: 9_000 });
    const count = published.length;
    tracker.apply({ key: "values", type: "tool_started", toolName: "late", at: 9_100 });
    vi.advanceTimersByTime(1_000);
    expect(published).toHaveLength(count);
  });
});
