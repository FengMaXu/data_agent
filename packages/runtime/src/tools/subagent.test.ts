import { describe, expect, it } from "vitest";
import { TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import { Value } from "typebox/value";
import { createSubagentToolDefinition, SUBAGENT_PARAMETERS } from "./subagent.js";
import type { ChildOutcome, Delegation, TrustedDelegationContext } from "../delegation/index.js";

const invocation = { invocationId: "parent-inv", operationId: "parent-op", turnId: "turn", getMemo: async () => undefined, setMemo: async () => undefined };

function outcome(key: string, overrides: Partial<ChildOutcome> = {}): ChildOutcome {
  return {
    key,
    runId: key,
    childSessionId: `child-${key}`,
    targetRef: `subagent:${key}`,
    targetState: "current",
    staleReasons: [],
    status: "completed",
    terminalConfirmed: true,
    report: { markdown: `## 结论\n\n${key} 的结果`, truncated: false },
    usage: { inputTokens: 1, outputTokens: 1, cost: null },
    ...overrides,
  };
}

describe("subagent AgentHarness tool", () => {
  it("accepts up to four explorer tasks without a Query Task binding", () => {
    const explorer = { key: "schema", role: "explorer", task: "列出 orders 的列" };
    expect(Value.Check(SUBAGENT_PARAMETERS, { tasks: [explorer] })).toBe(true);
    expect(Value.Check(SUBAGENT_PARAMETERS, { tasks: [1, 2, 3, 4].map((index) => ({ ...explorer, key: `k${index}` })) })).toBe(true);
    expect(Value.Check(SUBAGENT_PARAMETERS, { tasks: [1, 2, 3, 4, 5].map((index) => ({ ...explorer, key: `k${index}` })) })).toBe(false);
    expect(Value.Check(SUBAGENT_PARAMETERS, { tasks: [{ ...explorer, taskId: "" }] })).toBe(true);
    expect(Value.Check(SUBAGENT_PARAMETERS, { tasks: [{ ...explorer, outputFormat: "markdown" }] })).toBe(true);
    expect(Value.Check(SUBAGENT_PARAMETERS, { tasks: [{ key: "review", role: "reviewer", task: "review", taskId: "task-1" }] })).toBe(true);
  });

  it("returns each child's Markdown report without an untrusted-findings banner", async () => {
    let captured: TrustedDelegationContext | undefined;
    const delegation: Delegation = {
      async run(_input, context) {
        captured = context;
        return [outcome("schema"), outcome("values", { status: "failed", report: undefined, error: "SQL_ERROR" })];
      },
      async close() {},
    };
    const tool = createSubagentToolDefinition(delegation).tool as any;
    const result = await tool.execute("call", { tasks: [
      { key: "schema", role: "explorer", task: "列出 orders 的列" },
      { key: "values", role: "explorer", task: "status 的取值" },
    ] }, undefined, { sessionId: "session-1", principalId: "user-1", requestMessageId: "message-1" }, invocation, TODO_CONTEXT);
    expect(captured).toMatchObject({ principalId: "user-1", ownerSessionId: "session-1", parentOperationId: "parent-op", parentInvocationId: "parent-inv", requestMessageId: "message-1" });
    const text = result.content[0].text as string;
    expect(text).toContain("## schema（explorer）— completed");
    expect(text).toContain("schema 的结果");
    expect(text).toContain("## values（explorer）— failed");
    expect(text).toContain("SQL_ERROR");
    expect(text).not.toContain("UNTRUSTED");
    expect(text).not.toContain("mayAuthorizePublication");
  });

  it("ignores an explorer taskId and unknown fields, and never takes identity from arguments", async () => {
    let captured: unknown;
    let context: TrustedDelegationContext | undefined;
    const delegation: Delegation = {
      async run(input, trusted) { captured = input; context = trusted; return [outcome("a"), outcome("r")]; },
      async close() {},
    };
    const tool = createSubagentToolDefinition(delegation).tool as any;
    await tool.execute("call", { tasks: [
      { key: "a", role: "explorer", task: "列出列", taskId: "", outputFormat: "markdown", principalId: "forged" },
      { key: "r", role: "reviewer", task: "审阅", taskId: " task-1 " },
    ] }, undefined, { sessionId: "session-1", principalId: "user-1" }, invocation, TODO_CONTEXT);
    expect(captured).toEqual({ tasks: [
      { key: "a", role: "explorer", task: "列出列" },
      { key: "r", role: "reviewer", task: "审阅", taskId: "task-1" },
    ] });
    expect(context?.principalId).toBe("user-1");
  });

  it("marks truncated and stale reports", async () => {
    const delegation: Delegation = {
      async run() {
        return [outcome("docs", { targetState: "stale", staleReasons: ["knowledge changed"], report: { markdown: "## 结论", truncated: true } })];
      },
      async close() {},
    };
    const tool = createSubagentToolDefinition(delegation).tool as any;
    const result = await tool.execute("call", { tasks: [{ key: "docs", role: "explorer", task: "读业务定义" }] }, undefined, { sessionId: "session-1", principalId: "user-1" }, invocation, TODO_CONTEXT);
    expect(result.content[0].text).toContain("knowledge changed");
    expect(result.content[0].text).toContain("已截断");
  });
});
