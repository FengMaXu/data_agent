import { describe, expect, it } from "vitest";
import { MemorySessionRepo, TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { DataAgentEvent } from "@data-agent/contracts";
import { InMemoryAnswering } from "../answering/service.js";
import { InMemoryAnsweringStore } from "../answering/answering-store.js";
import { InMemoryResultStore } from "../answering/result-store.js";
import type { PublicationId } from "../answering/model.js";
import { ArtifactDirectory } from "./artifact-directory.js";
import { createPiSessionHost } from "../agent/harness-factory.js";
import { createCoreAgentToolDefinitions } from "../tools/core.js";

// Real tool, published in-memory fixture, and native Pi events: no SQL server or model network.
describe("native show_widget delivery", () => {
  it("delivers two charts to live chat with the same payloads as history recovery", async () => {
    const sessionId = "widget-delivery";
    const session = await new MemorySessionRepo().create({ id: sessionId }, TODO_CONTEXT);
    const store = new InMemoryAnsweringStore();
    const resultStore = new InMemoryResultStore();
    const answering = new InMemoryAnswering({ store, resultStore, sqlExecutor: { run: async () => ({ columns: ["industry", "sales"], rows: [["Wholesale", "120.5"], ["Retail", "80"]], truncated: false }) } });
    const business = (invocationId: string) => ({ principal: { id: "user-1" }, sessionId, lane: "main", operationId: "fixture", invocationId });
    const begun = await answering.begin({ requestMessageId: "fixture-request", requestId: "begin", spec: { entity: "industries", metric: "sales", filters: [], groupBy: [], time: { state: "not_applicable" }, ranking: { state: "not_applicable" }, output: { rowMode: "full" } } }, business("begin"));
    const execution = await answering.execute({ kind: "result", taskId: begun.taskId, revisionId: begun.revisionId, sql: "SELECT industry, sales FROM fixture" }, business("execute"));
    if (execution.artifact.kind !== "candidate") throw new Error("expected candidate");
    const receipt = await answering.publish({ candidateId: execution.artifact.candidateId, format: "auto", requestId: "publish" }, business("publish"));
    const artifacts = new ArtifactDirectory({
      findPublication: (id, context) => store.transact((tx) => tx.getReceipt(id as PublicationId), context),
      readAuthorized: (found, context) => resultStore.encodeCsv(found.resultRef, context),
      readRowsAuthorized: async (found, context) => {
        const result = await resultStore.openAuthorized(found.resultRef, found, context);
        return { columns: result.columns, rows: result.rows, contentHash: result.contentHash };
      },
    });
    const tool = createCoreAgentToolDefinitions({ workspace: {} as never, publishedRows: artifacts }).find((definition) => definition.tool.name === "show_widget")!;
    const chart = (title: string) => ({ version: 1, title, data: { kind: "publication", receiptId: receipt.receiptId }, fields: { sales: { type: "quantitative", storage: "raw", unit: "元", additivity: "additive" } }, chart: { mark: "cartesian", x: { field: "industry" }, layers: [{ type: "bar", y: { field: "sales" } }] } });
    const faux = fauxProvider({ provider: "widget-delivery-test", models: [{ id: "model" }] });
    const models = createModels();
    models.setProvider(faux.provider);
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("show_widget", { kind: "chart", spec: chart("Sales A") }, { id: "chart-a" }), fauxToolCall("show_widget", { kind: "chart", spec: chart("Sales B") }, { id: "chart-b" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("Charts ready."),
    ]);
    const host = await createPiSessionHost({
      session, sessionId, toolContext: { sessionId, principalId: "user-1" }, toolDefinitions: [tool],
      answering, answeringStore: store, resultStore, systemPrompt: "Render the requested charts.",
      profile: { provider: faux.provider, model: faux.models[0].id },
      queryTaskProjection: {} as never, artifactDirectory: artifacts,
      clarificationDialogs: { subscribe: () => () => undefined } as never,
      piRuntime: { models, model: faux.models[0] },
    });
    const events: DataAgentEvent[] = [];
    const nativeToolEvents: string[] = [];
    host.subscribe((event) => { if (event.envelope) events.push(event.envelope.event); });
    host.facets.transcript.subscribeObservations((observation) => {
      if (observation.event.type.startsWith("tool_")) nativeToolEvents.push(observation.event.type);
    });
    try {
      const accepted = await host.controller.prompt("Show two sales charts.");
      const driven = await host.lane.drive({ operationId: accepted.operationId }, TODO_CONTEXT);
      expect(driven.ok).toBe(true);
      expect(nativeToolEvents.filter((type) => type === "tool_end")).toHaveLength(2);
      expect(nativeToolEvents).not.toContain("tool_update");
      expect(events.filter((event) => event.type === "agent.tool_finished" && !event.isError)).toHaveLength(2);
      const widgets = events.filter((event) => event.type === "widget");
      expect(widgets).toHaveLength(2);
      for (const widget of widgets) {
        const related = events.filter((event) => "toolCallId" in event && event.toolCallId === widget.toolCallId);
        expect(related.map((event) => event.type)).toEqual(["agent.tool_started", "widget", "widget_done", "agent.tool_finished"]);
      }
      const restored = (await host.facets.transcript.messages()).flatMap((message) => Object.values(message.widgetsById ?? {}));
      expect(restored).toHaveLength(2);
      expect(widgets.map((event) => event.widget)).toEqual(expect.arrayContaining(restored));
      expect(events.filter((event) => event.type === "agent.completed")).toHaveLength(1);
    } finally {
      await host.close();
    }
  });
});
