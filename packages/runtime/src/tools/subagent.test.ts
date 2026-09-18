import { describe, expect, it } from "vitest";
import { TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import { Value } from "typebox/value";
import { createSubagentTool, SUBAGENT_PARAMETERS } from "./subagent.js";
import type { Delegation, TrustedDelegationContext } from "../delegation/index.js";

const input = { tasks: [{ key: "explore", role: "explorer" as const, task: "inspect duplicates", taskId: "task-1", revisionId: "revision-1" }] };

describe("subagent AgentHarness tool", () => {
  it("bounds a hostile two-child report before it enters the parent context", async () => {
    const delegation: Delegation = {
      async run() {
        return ["one", "two"].map((key) => ({
          key,
          runId: key,
          childSessionId: `child-${key}`,
          targetRef: "target",
          targetState: "current" as const,
          staleReasons: [],
          status: "completed" as const,
          terminalConfirmed: true,
          report: { summary: "x".repeat(2_000), findings: Array.from({ length: 16 }, () => ({ statement: "y".repeat(1_000), evidenceRefs: [] })), unchecked: [], questions: [] },
          usage: { inputTokens: 1, outputTokens: 1, cost: null },
        }));
      },
      async close() {},
    };
    const tool = createSubagentTool(delegation) as any;
    const result = await tool.execute("call", { tasks: [
      { key: "one", role: "reviewer", task: "one", taskId: "task", revisionId: "revision" },
      { key: "two", role: "reviewer", task: "two", taskId: "task", revisionId: "revision" },
    ] }, undefined, { sessionId: "session-1", principalId: "user-1" }, {
      invocationId: "parent-inv", operationId: "parent-op", getMemo: async () => undefined, setMemo: async () => undefined,
    }, TODO_CONTEXT);
    expect(Buffer.byteLength(result.content[0].text, "utf8")).toBeLessThan(8 * 1024 + 128);
    expect(result.content[0].text).toContain("mayAuthorizePublication");
    expect(result.content[0].text).toContain("reportTruncated");
  });

  it("has a strict bounded schema and derives identity from trusted invocation context", async () => {
    expect(Value.Check(SUBAGENT_PARAMETERS, input)).toBe(true);
    expect(Value.Check(SUBAGENT_PARAMETERS, { tasks: [{ ...input.tasks[0], principalId: "forged" }] })).toBe(false);
    expect(Value.Check(SUBAGENT_PARAMETERS, { tasks: [input.tasks[0], input.tasks[0], input.tasks[0]] })).toBe(false);
    let captured: TrustedDelegationContext | undefined;
    const delegation: Delegation = {
      async run(_input, context) {
        captured = context;
        return [{ key: "explore", runId: "run", childSessionId: "child", targetRef: "target", targetState: "current", staleReasons: [], status: "completed", terminalConfirmed: true, report: { summary: "done", findings: [], unchecked: ["intent"], questions: [] }, usage: { inputTokens: 1, outputTokens: 1, cost: null } }];
      },
      async close() {},
    };
    const tool = createSubagentTool(delegation) as any;
    const memo = new Map<string, unknown>();
    const invocation = { invocationId: "parent-inv", operationId: "parent-op", turnId: "turn", getMemo: async (key: string) => memo.get(key), setMemo: async (key: string, value: unknown) => { memo.set(key, value); } };
    const result = await tool.execute("call", input, undefined, { sessionId: "session-1", principalId: "user-1" }, invocation, TODO_CONTEXT);
    expect(captured).toMatchObject({ principalId: "user-1", ownerSessionId: "session-1", parentOperationId: "parent-op", parentInvocationId: "parent-inv" });
    expect(result.content[0].text).toContain("done");
    expect(result.content[0].text).toContain("mayAuthorizePublication");
    expect(result.content[0].text).toContain("authority");
    expect(Buffer.byteLength(result.content[0].text, "utf8")).toBeLessThan(8 * 1024 + 128);
  });
});
