import { describe, expect, it } from "vitest";
import type { DataAgentEventEnvelope } from "@data-agent/contracts";
import { TranscriptProjector } from "./transcript.js";

function projector() {
  const emitted: DataAgentEventEnvelope[] = [];
  let sequence = 1;
  const instance = new TranscriptProjector({
    resolve: (event) => ({ operationId: String(event.runId), operation: { requestId: "request-1", runId: String(event.runId), sessionId: "session-1" } }),
    nextSequence: () => sequence++,
    emit: (envelope) => emitted.push(envelope),
    onTerminal: () => undefined,
  });
  return { instance, events: () => emitted.map((envelope) => envelope.event) };
}

const receipt = {
  receiptId: "publication-1",
  taskId: "task-1",
  format: "inline",
  publicRef: "/api/runtime/publications/publication-1?session_id=session-1",
  disclosure: { required: true, provisionalChoiceIds: [], summary: "口径按字面解释。" },
  inlineContent: "| 销售额 |\n| 100 |",
  physicalProfile: { rowCount: 1 },
};

function finish(instance: TranscriptProjector, toolName: string, details: unknown, isError = false) {
  instance.project({ type: "tool_execution_start", runId: "run-1", toolCallId: "call-1", toolName, args: {} });
  instance.project({ type: "tool_execution_end", runId: "run-1", toolCallId: "call-1", toolName, result: { content: [{ type: "text", text: "[PUBLISHED]" }], details }, isError });
}

describe("TranscriptProjector publication delivery", () => {
  it("announces a published Receipt after the tool result, without the physical profile", () => {
    const { instance, events } = projector();
    finish(instance, "publish_query_result", receipt);
    expect(events().slice(-2).map((event) => event.type)).toEqual(["agent.tool_finished", "publication.delivered"]);
    expect(events().at(-1)).toEqual({ type: "publication.delivered", receiptId: "publication-1", taskId: "task-1", format: "inline", publicRef: receipt.publicRef, disclosure: "口径按字面解释。", inlineContent: "| 销售额 |\n| 100 |" });
  });

  it("announces export_query Receipts too", () => {
    const { instance, events } = projector();
    finish(instance, "export_query", { ...receipt, format: "csv", inlineContent: undefined, disclosure: undefined });
    expect(events().at(-1)).toEqual({ type: "publication.delivered", receiptId: "publication-1", taskId: "task-1", format: "csv", publicRef: receipt.publicRef });
  });

  it("stays silent for failed publishes, other tools and malformed details", () => {
    for (const [toolName, details, isError] of [
      ["publish_query_result", receipt, true],
      ["query_database", receipt, false],
      ["publish_query_result", { ...receipt, receiptId: "" }, false],
      ["publish_query_result", { ...receipt, format: "xlsx" }, false],
      ["publish_query_result", null, false],
    ] as const) {
      const { instance, events } = projector();
      finish(instance, toolName, details, isError);
      expect(events().map((event) => event.type)).not.toContain("publication.delivered");
    }
  });
});
