import { describe, expect, it } from "vitest";
import { AgentHarness, JsonlSessionRepo, TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { createModels } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { HarnessChildExecutor } from "./child-harness.js";
import { JsonlChildSessionRepository } from "./child-session-repo.js";
import { NativeDelegation } from "./delegation.js";
import { PiSessionDelegationLedger } from "./ledger.js";
import type { DelegationLedgerRecord } from "./index.js";

const base = (runId: string, state: DelegationLedgerRecord["state"]): DelegationLedgerRecord => ({
  runId,
  childSessionId: `child-${runId}`,
  parentOperationId: "parent-operation",
  parentInvocationId: "parent-invocation",
  role: "reviewer",
  key: runId,
  state,
  ...(state === "accepted" || state === "settled" ? { operationId: `operation-${runId}` } : {}),
  ...(state === "settled" ? { status: "completed" as const } : {}),
  recordedAt: new Date().toISOString(),
});

async function childWithReport(children: JsonlChildSessionRepository, runId: string, parentSessionId = "parent") {
  const child = await children.create({ id: `child-${runId}`, parentSessionId });
  const lane = await child.createBranch("main", null, TODO_CONTEXT);
  await lane.appendMessage(fauxAssistantMessage(JSON.stringify({ summary: runId, findings: [], unchecked: ["intent"], questions: [] })), TODO_CONTEXT);
  await child.close(TODO_CONTEXT);
}

describe("durable subagent interruption reconciliation", () => {
  it("does not resume or duplicate ambiguous children and keeps historical reports readable", async () => {
    const root = await mkdtemp(path.join(process.cwd(), ".tmp-subagent-recovery-"));
    const parentRoot = path.join(root, "parent");
    const childRoot = path.join(root, "children");
    try {
      let parentRepo = new JsonlSessionRepo({ fileSystem: new NodeExecutionEnv({ cwd: parentRoot }), sessionsRoot: parentRoot });
      let parent = await parentRepo.create({ cwd: parentRoot, id: "parent" }, TODO_CONTEXT);
      let ledger = new PiSessionDelegationLedger(parent);
      await ledger.reserve("parent-operation", [base("reserved", "reserved"), base("accepted", "reserved"), base("settled", "reserved")], 4);
      await ledger.append(base("accepted", "accepted"));
      await ledger.append(base("settled", "accepted"));
      await ledger.append(base("settled", "settled"));
      const children = new JsonlChildSessionRepository(childRoot);
      await childWithReport(children, "accepted");
      await childWithReport(children, "settled");
      const orphan = await children.create({ id: "orphan", parentSessionId: "parent" });
      await orphan.close(TODO_CONTEXT);
      const parentMetadata = (await parentRepo.list({ cwd: parentRoot }, TODO_CONTEXT))[0]!;
      await parent.close(TODO_CONTEXT);

      parentRepo = new JsonlSessionRepo({ fileSystem: new NodeExecutionEnv({ cwd: parentRoot }), sessionsRoot: parentRoot });
      parent = await parentRepo.open(parentMetadata, TODO_CONTEXT);
      ledger = new PiSessionDelegationLedger(parent);
      await ledger.reconcile();
      const records = await ledger.list();
      const latest = new Map(records.map((record) => [record.runId, record]));
      expect(latest.get("reserved")).toMatchObject({ state: "interrupted", status: "interrupted" });
      expect(latest.get("accepted")).toMatchObject({ state: "interrupted", status: "interrupted", operationId: "operation-accepted" });
      expect(latest.get("settled")).toMatchObject({ state: "settled", status: "completed" });

      await children.removeOrphans(new Set(records.map((record) => record.childSessionId)));
      const childRepo = new JsonlSessionRepo({ fileSystem: new NodeExecutionEnv({ cwd: childRoot }), sessionsRoot: childRoot });
      const metadata = await childRepo.list({ cwd: childRoot }, TODO_CONTEXT);
      expect(metadata.map((item) => item.id).sort()).toEqual(["child-accepted", "child-settled"]);
      for (const item of metadata) {
        const child = await childRepo.open(item, TODO_CONTEXT);
        const entries = await child.findEntries(undefined, TODO_CONTEXT);
        expect(JSON.stringify(entries)).toContain(item.id.replace("child-", ""));
        await child.close(TODO_CONTEXT);
      }
      await parent.close(TODO_CONTEXT);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reconciles an operation accepted before the reserved ledger was advanced and recognizes a completed accepted operation", async () => {
    const root = await mkdtemp(path.join(process.cwd(), ".tmp-subagent-recovery-windows-"));
    const childRoot = path.join(root, "children");
    try {
      const faux = fauxProvider({ provider: "recovery-windows", models: [{ id: "model" }] });
      const models = createModels();
      models.setProvider(faux.provider);
      faux.setResponses([fauxAssistantMessage("completed before parent settlement")]);
      const children = new JsonlChildSessionRepository(childRoot);

      const reservedSession = await children.create({ id: "child-reserved-window", parentSessionId: "parent" });
      const reservedHarness = await AgentHarness.create({ session: reservedSession, models, model: faux.models[0], tools: [], activeToolNames: [], systemPrompt: "child" }, TODO_CONTEXT);
      const reservedLane = await reservedHarness.harness.lane("main", TODO_CONTEXT);
      const reservedAdmission = await reservedLane.accept({ kind: "prompt", prompt: "accepted before ledger append" }, TODO_CONTEXT);
      expect(reservedAdmission.ok).toBe(true);
      if (!reservedAdmission.ok) throw reservedAdmission.error;
      await reservedHarness.harness.close(TODO_CONTEXT);

      const completedSession = await children.create({ id: "child-completed-window", parentSessionId: "parent" });
      const completedHarness = await AgentHarness.create({ session: completedSession, models, model: faux.models[0], tools: [], activeToolNames: [], systemPrompt: "child" }, TODO_CONTEXT);
      const completedLane = await completedHarness.harness.lane("main", TODO_CONTEXT);
      const completedAdmission = await completedLane.accept({ kind: "prompt", prompt: "complete before parent settlement" }, TODO_CONTEXT);
      expect(completedAdmission.ok).toBe(true);
      if (!completedAdmission.ok) throw completedAdmission.error;
      const completedDrive = await completedLane.drive({ operationId: completedAdmission.value.operationId }, TODO_CONTEXT);
      expect(completedDrive.ok && completedDrive.value.kind === "settled" && completedDrive.value.outcome.status === "completed").toBe(true);
      await completedHarness.harness.close(TODO_CONTEXT);

      const records: DelegationLedgerRecord[] = [
        { ...base("reserved-window", "reserved"), childSessionId: "child-reserved-window" },
        { ...base("completed-window", "accepted"), childSessionId: "child-completed-window", operationId: completedAdmission.value.operationId },
      ];
      const executor = new HarnessChildExecutor({ sessions: new JsonlChildSessionRepository(childRoot), models, model: faux.models[0] });
      const recovery = new Map((await executor.reconcile(records)).map((item) => [item.runId, item]));
      expect(recovery.get("reserved-window")).toMatchObject({ operationId: reservedAdmission.value.operationId, status: "interrupted", terminalConfirmed: true });
      expect(recovery.get("completed-window")).toMatchObject({ operationId: completedAdmission.value.operationId, status: "interrupted", terminalConfirmed: true, error: "SUBAGENT_RECOVERY_RESULT_NOT_DELIVERED:completed" });

      const reopenedReserved = await new JsonlChildSessionRepository(childRoot).open("child-reserved-window");
      expect(reopenedReserved).toBeDefined();
      const reopenedHarness = await AgentHarness.create({ session: reopenedReserved!, models, model: faux.models[0], tools: [], activeToolNames: [], systemPrompt: "reopened" }, TODO_CONTEXT);
      const result = await (await reopenedHarness.harness.lane("main", TODO_CONTEXT)).getResult(reservedAdmission.value.operationId, TODO_CONTEXT);
      expect(result?.status).toBe("aborted");
      await reopenedHarness.harness.close(TODO_CONTEXT);
      await executor.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("recognizes failed and already-aborted accepted operations as confirmed terminal states", async () => {
    const root = await mkdtemp(path.join(process.cwd(), ".tmp-subagent-recovery-terminal-states-"));
    const childRoot = path.join(root, "children");
    try {
      const faux = fauxProvider({ provider: "recovery-terminal-states", models: [{ id: "model" }] });
      const models = createModels();
      models.setProvider(faux.provider);
      faux.setResponses([fauxAssistantMessage("provider failed", { stopReason: "error", errorMessage: "provider failed" })]);
      const children = new JsonlChildSessionRepository(childRoot);
      const operationIds = new Map<string, string>();

      for (const state of ["failed", "aborted"] as const) {
        const session = await children.create({ id: `child-${state}`, parentSessionId: "parent" });
        const created = await AgentHarness.create({ session, models, model: faux.models[0], tools: [], activeToolNames: [], systemPrompt: "child" }, TODO_CONTEXT);
        const lane = await created.harness.lane("main", TODO_CONTEXT);
        const admission = await lane.accept({ kind: "prompt", prompt: state }, TODO_CONTEXT);
        expect(admission.ok).toBe(true);
        if (!admission.ok) throw admission.error;
        operationIds.set(state, admission.value.operationId);
        if (state === "aborted") {
          const requested = await lane.requestAbort(admission.value.operationId, TODO_CONTEXT);
          expect(requested.ok).toBe(true);
        }
        const driven = await lane.drive({ operationId: admission.value.operationId }, TODO_CONTEXT);
        expect(driven.ok && driven.value.kind === "settled" && driven.value.outcome.status === state).toBe(true);
        await created.harness.close(TODO_CONTEXT);
      }

      const records: DelegationLedgerRecord[] = (["failed", "aborted"] as const).map((state) => ({
        ...base(state, "accepted"),
        childSessionId: `child-${state}`,
        operationId: operationIds.get(state)!,
      }));
      const executor = new HarnessChildExecutor({ sessions: new JsonlChildSessionRepository(childRoot), models, model: faux.models[0] });
      const recovery = new Map((await executor.reconcile(records)).map((item) => [item.runId, item]));
      expect(recovery.get("failed")).toMatchObject({ status: "interrupted", terminalConfirmed: true, error: "SUBAGENT_RECOVERY_RESULT_NOT_DELIVERED:failed" });
      expect(recovery.get("aborted")).toMatchObject({ status: "interrupted", terminalConfirmed: true });
      expect(recovery.get("aborted")).not.toHaveProperty("error");
      await executor.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("aborts an accepted native child operation before marking it interrupted", async () => {
    const root = await mkdtemp(path.join(process.cwd(), ".tmp-subagent-native-recovery-"));
    const parentRoot = path.join(root, "parent");
    const childRoot = path.join(root, "children");
    try {
      const faux = fauxProvider({ provider: "native-recovery", models: [{ id: "model" }] });
      const models = createModels();
      models.setProvider(faux.provider);
      let parentRepo = new JsonlSessionRepo({ fileSystem: new NodeExecutionEnv({ cwd: parentRoot }), sessionsRoot: parentRoot });
      let parent = await parentRepo.create({ cwd: parentRoot, id: "parent" }, TODO_CONTEXT);
      const children = new JsonlChildSessionRepository(childRoot);
      const child = await children.create({ id: "child-open", parentSessionId: "parent" });
      const childCreated = await AgentHarness.create({ session: child, models, model: faux.models[0], tools: [], activeToolNames: [], systemPrompt: "child" }, TODO_CONTEXT);
      const childLane = await childCreated.harness.lane("main", TODO_CONTEXT);
      const accepted = await childLane.accept({ kind: "prompt", prompt: "This operation is intentionally left open." }, TODO_CONTEXT);
      expect(accepted.ok).toBe(true);
      if (!accepted.ok) throw accepted.error;
      const record: DelegationLedgerRecord = { ...base("open", "reserved"), childSessionId: "child-open" };
      const ledger = new PiSessionDelegationLedger(parent);
      await ledger.reserve("parent-operation", [record], 4);
      await ledger.append({ ...record, state: "accepted", operationId: accepted.value.operationId, recordedAt: new Date().toISOString() });
      await childCreated.harness.close(TODO_CONTEXT);
      const parentMetadata = (await parentRepo.list({ cwd: parentRoot }, TODO_CONTEXT))[0]!;
      await parent.close(TODO_CONTEXT);

      parentRepo = new JsonlSessionRepo({ fileSystem: new NodeExecutionEnv({ cwd: parentRoot }), sessionsRoot: parentRoot });
      parent = await parentRepo.open(parentMetadata, TODO_CONTEXT);
      const recoveredLedger = new PiSessionDelegationLedger(parent);
      const executor = new HarnessChildExecutor({ sessions: new JsonlChildSessionRepository(childRoot), models, model: faux.models[0] });
      const delegation = new NativeDelegation({
        executor,
        resolver: { async resolve(task) { return { targetRef: `query-task:${task.taskId}@${task.revisionId}`, prompt: task.task, systemPrompt: "child", toolDefinitions: [], allowedEvidenceRefs: new Set(), checkTarget: async () => ({ state: "current" as const, reasons: [] }) }; } },
        ledger: recoveredLedger,
      });
      const abort = new AbortController();
      abort.abort();
      await delegation.run({ tasks: [{ key: "trigger", role: "reviewer", task: "trigger initialization", taskId: "task", revisionId: "revision" }] }, {
        principalId: "user-1", ownerSessionId: "parent", parentOperationId: "trigger-operation", parentInvocationId: "trigger-invocation", context: TODO_CONTEXT,
      }, abort.signal);
      const latest = new Map((await recoveredLedger.list()).map((item) => [item.runId, item]));
      expect(latest.get("open")).toMatchObject({ state: "interrupted", status: "interrupted", operationId: accepted.value.operationId });
      const recoveredChild = await new JsonlChildSessionRepository(childRoot).open("child-open");
      expect(recoveredChild).toBeDefined();
      const reopened = await AgentHarness.create({ session: recoveredChild!, models, model: faux.models[0], tools: [], activeToolNames: [], systemPrompt: "reopened" }, TODO_CONTEXT);
      const result = await (await reopened.harness.lane("main", TODO_CONTEXT)).getResult(accepted.value.operationId, TODO_CONTEXT);
      expect(result?.status).toBe("aborted");
      await reopened.harness.close(TODO_CONTEXT);
      await delegation.close();
      await parent.close(TODO_CONTEXT);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
