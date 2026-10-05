import { describe, expect, it } from "vitest";
import { admitEvidence, quoteAppearsIn, type EvidenceSource } from "./evidence-admission.js";

const messages: Record<string, string> = {
  "message-request": "请按年度汇总每个销售员的订单金额，并与年度配额比较。",
  "message-followup": "配额按年度表里的 SalesQuota 取最大值就行。",
};

const answers: Record<string, string> = { "clar-1": "订单量=全部下单订单；GMV=订单支付金额合计(payment_value)" };

const source: EvidenceSource = {
  readUserMessage: async (sessionId, messageId) => sessionId === "session-1" ? messages[messageId] : undefined,
  readClarificationAnswer: async (sessionId, clarificationId) => sessionId === "session-1" ? answers[clarificationId] : undefined,
  readDocument: async (sourceRef) => sourceRef === "business-definitions"
    ? { kind: "task_document", content: "Sales amount means SUM(subtotal) excluding tax and freight." }
    : undefined,
};

const scope = { sessionId: "session-1", taskRequestMessageId: "message-request", source };

describe("Evidence Admission (ADR-0004)", () => {
  it("normalizes whitespace and width but still requires a verbatim span", () => {
    expect(quoteAppearsIn("按年度  汇总", "请按年度 汇总订单")).toBe(true);
    expect(quoteAppearsIn("ＳＵＭ(subtotal)", "SUM(subtotal)")).toBe(true);
    expect(quoteAppearsIn("按月汇总", "请按年度汇总")).toBe(false);
    expect(quoteAppearsIn("按", "请按年度汇总")).toBe(false);
  });

  it("binds request wording to the task request and verifies its quote", async () => {
    const [admitted] = await admitEvidence([{ localId: "q", kind: "request_wording", sourceRef: "message-followup", quote: "按年度汇总每个销售员的订单金额" }], scope);
    expect(admitted).toMatchObject({ localId: "q", kind: "request_wording", sourceRef: "message-request", verification: { method: "user_message_quote" } });
    await expect(admitEvidence([{ kind: "request_wording", quote: "按月汇总" }], scope)).rejects.toMatchObject({ code: "EVIDENCE_REJECTED" });
    await expect(admitEvidence([{ kind: "request_wording" }], scope)).rejects.toMatchObject({ code: "EVIDENCE_REJECTED" });
  });

  it("accepts a user confirmation only from a later user message", async () => {
    await expect(admitEvidence([{ kind: "user_confirmation", sourceRef: "message-request", quote: "按年度汇总" }], scope)).rejects.toMatchObject({ code: "EVIDENCE_REJECTED" });
    await expect(admitEvidence([{ kind: "user_confirmation", quote: "取最大值" }], scope)).rejects.toMatchObject({ code: "EVIDENCE_REJECTED" });
    await expect(admitEvidence([{ kind: "user_confirmation", sourceRef: "message-followup", quote: "取平均值" }], scope)).rejects.toMatchObject({ code: "EVIDENCE_REJECTED" });
    const [admitted] = await admitEvidence([{ kind: "user_confirmation", sourceRef: "message-followup", quote: "SalesQuota 取最大值" }], scope);
    expect(admitted).toMatchObject({ kind: "user_confirmation", sourceRef: "message-followup", verification: { method: "user_message_quote" } });
  });

  it("accepts a user confirmation from the user's recorded answer to a clarification", async () => {
    const [admitted] = await admitEvidence([{ kind: "user_confirmation", sourceRef: "clarification:clar-1", quote: "订单量=全部下单订单" }], scope);
    expect(admitted).toMatchObject({ kind: "user_confirmation", sourceRef: "clarification:clar-1", quote: "订单量=全部下单订单", verification: { method: "clarification_answer_quote" } });
    // Unknown or unanswered clarifications, another Session's answers and words the user did not say are rejected.
    await expect(admitEvidence([{ kind: "user_confirmation", sourceRef: "clarification:clar-2", quote: "订单量=全部下单订单" }], scope)).rejects.toMatchObject({ code: "EVIDENCE_REJECTED" });
    await expect(admitEvidence([{ kind: "user_confirmation", sourceRef: "clarification:clar-1", quote: "订单量=全部下单订单" }], { ...scope, sessionId: "session-2" })).rejects.toMatchObject({ code: "EVIDENCE_REJECTED" });
    await expect(admitEvidence([{ kind: "user_confirmation", sourceRef: "clarification:clar-1", quote: "仅已送达订单" }], scope)).rejects.toMatchObject({ code: "EVIDENCE_REJECTED" });
    const { readClarificationAnswer: _omitted, ...withoutAnswers } = source;
    await expect(admitEvidence([{ kind: "user_confirmation", sourceRef: "clarification:clar-1", quote: "订单量=全部下单订单" }], { ...scope, source: withoutAnswers })).rejects.toMatchObject({ code: "EVIDENCE_REJECTED" });
  });

  it("admits only authorized documents with their configured authority", async () => {
    await expect(admitEvidence([{ kind: "task_document", sourceRef: "semantic-guide", quote: "SUM(subtotal)" }], scope)).rejects.toMatchObject({ code: "EVIDENCE_REJECTED" });
    await expect(admitEvidence([{ kind: "reviewed_definition", sourceRef: "business-definitions", quote: "SUM(subtotal)" }], scope)).rejects.toMatchObject({ code: "EVIDENCE_REJECTED" });
    await expect(admitEvidence([{ kind: "task_document", sourceRef: "business-definitions", quote: "SUM(totaldue)" }], scope)).rejects.toMatchObject({ code: "EVIDENCE_REJECTED" });
    const [admitted] = await admitEvidence([{ kind: "task_document", sourceRef: "business-definitions", quote: "SUM(subtotal) excluding tax" }], scope);
    expect(admitted).toMatchObject({ kind: "task_document", verification: { method: "document_quote" } });
    // "document" leaves the authority to the composition root instead of the caller.
    const [unnamed] = await admitEvidence([{ kind: "document", sourceRef: "business-definitions", quote: "SUM(subtotal) excluding tax" }], scope);
    expect(unnamed).toMatchObject({ kind: "task_document", sourceRef: "business-definitions", verification: { method: "document_quote" } });
    await expect(admitEvidence([{ kind: "document", sourceRef: "semantic-guide", quote: "SUM(subtotal)" }], scope)).rejects.toMatchObject({ code: "EVIDENCE_REJECTED" });
  });

  it("rejects text evidence when no trusted source is configured", async () => {
    await expect(admitEvidence([{ kind: "request_wording", quote: "按年度汇总" }], { sessionId: "session-1", taskRequestMessageId: "message-request" })).rejects.toMatchObject({ code: "EVIDENCE_REJECTED" });
  });

  it("keeps schema facts unverified and never admits model-submitted observations", async () => {
    const [schema] = await admitEvidence([{ kind: "schema_fact", sourceRef: "schema:orders", quote: "order_id PK" }], scope);
    expect(schema).not.toHaveProperty("verification");
    await expect(admitEvidence([{ kind: "schema_fact", quote: "order_id PK" }], scope)).rejects.toMatchObject({ code: "EVIDENCE_REJECTED" });
    await expect(admitEvidence([{ kind: "query_observation", sourceRef: "forged", preview: { columns: [], rows: [], columnTypes: [], rowCount: 0, truncated: false } }], scope)).rejects.toMatchObject({ code: "EVIDENCE_REJECTED" });
  });

  it("rejects duplicate local handles", async () => {
    await expect(admitEvidence([
      { localId: "same", kind: "schema_fact", sourceRef: "a" },
      { localId: "same", kind: "schema_fact", sourceRef: "b" },
    ], scope)).rejects.toMatchObject({ code: "EVIDENCE_REJECTED" });
  });
});
