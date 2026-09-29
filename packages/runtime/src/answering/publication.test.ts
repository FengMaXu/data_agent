import { describe, expect, it } from "vitest";
import { createAnsweringAgentToolDefinitions } from "../tools/answering.js";
import { InMemoryAnsweringStore } from "./answering-store.js";
import { composeDisclosure } from "./publication.js";
import { InMemoryResultStore } from "./result-store.js";
import { InMemoryAnswering } from "./service.js";
import type { AnswerRevisionRecord, BusinessContext, ResultCandidateRecord } from "./model.js";

const evidenceBasis = { kind: "evidence", evidenceIds: ["evidence_q"] } as const;
const spec = {
  entity: { state: "specified", value: { name: "orders" }, basis: evidenceBasis },
  metric: { state: "specified", value: { kind: "count" }, basis: evidenceBasis },
  filters: [],
  groupBy: [],
  time: { state: "not_applicable" },
  ranking: { state: "not_applicable" },
  output: { state: "specified", value: { rowMode: "scalar" }, basis: evidenceBasis },
};

function revision(overrides: Partial<AnswerRevisionRecord> = {}): AnswerRevisionRecord {
  return { taskId: "task_1", revisionId: "revision_1", requestId: "r", spec, hypotheses: [], choices: [], resolutions: [], choiceResolutions: [], state: { state: "draft", revisionId: "revision_1" }, createdAt: "t", ...overrides } as unknown as AnswerRevisionRecord;
}

function candidate(overrides: Partial<ResultCandidateRecord> = {}): ResultCandidateRecord {
  return { candidateId: "candidate_1", coverage: [], findings: [], ...overrides } as unknown as ResultCandidateRecord;
}

describe("Publication disclosure", () => {
  it("discloses nothing when every facet has evidence and nothing is provisional", () => {
    expect(composeDisclosure(revision(), candidate())).toBeUndefined();
  });

  it("discloses provisional choices, inferred facets and fanout findings together", () => {
    const disclosure = composeDisclosure(
      revision({
        spec: { ...spec, metric: { state: "specified", value: { kind: "count" }, basis: { kind: "inference" } } } as never,
        choiceResolutions: [{ outcome: "provisional", choiceId: "choice_1", alternativeId: "alternative_1", disclosureRequired: true }] as never,
      }),
      candidate({ fanout: { ruleVersion: "answering-fanout-v1", status: "finding", snapshotScope: "result_snapshot", targets: [] } }),
    );
    expect(disclosure).toMatchObject({ required: true, provisionalChoiceIds: ["choice_1"], inferredFacets: ["metric"], fanoutStatus: "finding" });
    expect(disclosure?.summary).toContain("字面解释");
    expect(disclosure?.summary).toContain("metric");
    expect(disclosure?.summary).toContain("JOIN fanout");
  });

  it("discloses hypotheses supported without qualifying evidence with the facets they affect", () => {
    const disclosure = composeDisclosure(
      revision({
        hypotheses: [{ id: "hypothesis_1", kind: "data_property", statement: "amounts are in 亿元", affects: ["metric"], basis: "b", impact: "i" }] as never,
        resolutions: [{ outcome: "provisional", hypothesisId: "hypothesis_1", disclosureRequired: true, citedEvidenceIds: ["evidence_def"] }] as never,
      }),
      candidate(),
    );
    expect(disclosure).toMatchObject({ required: true, provisionalChoiceIds: [], provisionalHypothesisIds: ["hypothesis_1"] });
    expect(disclosure?.summary).toContain("未被合格证据证实的假设：metric");
  });
});

const context = (invocationId: string): BusinessContext => ({ principal: { id: "user-1" }, sessionId: "session-1", lane: "main", operationId: "operation-1", invocationId });
const listSpec = { entity: "orders", metric: "sum", filters: [], groupBy: [], time: { state: "not_applicable" }, ranking: { state: "not_applicable" }, output: { rowMode: "full" } };

async function publishedAnswering(store = new InMemoryAnsweringStore(), resultStore = new InMemoryResultStore()) {
  const answering = new InMemoryAnswering({
    store,
    resultStore,
    // A leading NULL and DECIMAL text are the cases first-row type inference gets wrong.
    sqlExecutor: { run: async () => ({ columns: ["region", "amount"], rows: [["east", null], ["west", "12.50"], ["north", "-3.25"]], truncated: false }) },
  });
  const begun = await answering.begin({ requestMessageId: "message-1", requestId: "begin-1", spec: listSpec }, context("begin-1"));
  const execution = await answering.execute({ kind: "result", taskId: begun.taskId, revisionId: begun.revisionId, sql: "SELECT region, amount FROM orders" }, context("execute-1"));
  if (execution.artifact.kind !== "candidate") throw new Error("expected Result Candidate");
  const candidateHash = (await answering.inspect({ taskId: begun.taskId }, context("inspect-candidate"))).candidate?.contentHash;
  if (!candidateHash) throw new Error("expected a stored Candidate hash");
  return { answering, store, resultStore, taskId: begun.taskId, candidateId: execution.artifact.candidateId, candidateHash };
}

describe("Publication Physical Profile", () => {
  it("attaches a profile of every stored row without changing either content hash", async () => {
    const { answering, resultStore, candidateId, candidateHash } = await publishedAnswering();
    const receipt = await answering.publish({ candidateId, format: "auto", requestId: "publish-1" }, context("publish-1"));
    expect(receipt.physicalProfile).toEqual({
      version: 1,
      rowCount: 3,
      truncated: false,
      columns: [
        { name: "region", kind: "text", nullCount: 0, distinctCount: 3 },
        { name: "amount", kind: "decimal", encodedAs: "string", nullCount: 1, distinctCount: 2, min: "-3.25", max: "12.50" },
      ],
    });
    expect(receipt.contentHash).toBe(candidateHash);
    expect(receipt.presentationContentHash).toBe((await resultStore.encodeCsv(receipt.resultRef, context("encode"))).contentHash);
    await expect(resultStore.openAuthorized(receipt.resultRef, receipt, context("open"))).resolves.toMatchObject({ contentHash: candidateHash });
  });

  it("keeps reading Receipts published before profiling existed", async () => {
    const first = await publishedAnswering();
    const published = await first.answering.publish({ candidateId: first.candidateId, format: "auto", requestId: "publish-legacy" }, context("publish-legacy"));
    const snapshot = first.store.snapshot();
    const legacySnapshot = { ...snapshot, receipts: snapshot.receipts.map(({ physicalProfile: _profile, ...receipt }) => receipt) };
    const reopened = new InMemoryAnswering({ store: new InMemoryAnsweringStore(legacySnapshot), resultStore: first.resultStore, sqlExecutor: { run: async () => { throw new Error("SQL must not re-run"); } } });

    const retried = await reopened.publish({ candidateId: first.candidateId, format: "auto", requestId: "publish-legacy" }, context("publish-legacy-retry"));
    expect(retried.receiptId).toBe(published.receiptId);
    expect(retried.physicalProfile).toBeUndefined();
    const view = await reopened.inspect({ taskId: first.taskId }, context("inspect-legacy"));
    expect(view.publication?.receiptId).toBe(published.receiptId);
    await expect(first.resultStore.openAuthorized(retried.resultRef, retried, context("open-legacy"))).resolves.toMatchObject({ contentHash: published.contentHash });
  });

  it("keeps the profile out of model-visible publish and inspect text", async () => {
    const { answering, taskId, candidateId } = await publishedAnswering();
    const tools = createAnsweringAgentToolDefinitions(answering).map((definition) => definition.tool);
    const invocation = (invocationId: string) => ({ operationId: "operation-1", invocationId, getMemo: async () => undefined, setMemo: async () => undefined }) as never;
    const toolContext = { sessionId: "session-1", principalId: "user-1" };

    const published = await tools.find((tool) => tool.name === "publish_query_result")!.execute("publish", { candidateId, format: "inline" } as never, undefined, toolContext as never, invocation("publish-tool"), {} as never);
    const publishText = (published.content[0] as { text: string }).text;
    expect(publishText).toMatch(/^\[PUBLISHED\] inline \[download\]\(/);
    expect(publishText).not.toContain("physicalProfile");

    const inspected = await tools.find((tool) => tool.name === "inspect_answer")!.execute("inspect", { taskId } as never, undefined, toolContext as never, invocation("inspect-tool"), {} as never);
    const inspectText = (inspected.content[0] as { text: string }).text;
    expect(inspectText).toContain(`"receiptId"`);
    expect(inspectText).not.toContain("physicalProfile");
    expect((inspected.details as { publication?: { physicalProfile?: unknown } }).publication?.physicalProfile).toBeDefined();
  });
});
