import { describe, expect, it } from "vitest";
import { JsonlSessionRepo, TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { PiSessionDelegationLedger } from "./ledger.js";

const record = { runId: "run-1", childSessionId: "child-1", parentOperationId: "parent-op", parentInvocationId: "parent-inv", role: "explorer" as const, key: "one", state: "reserved" as const, recordedAt: new Date().toISOString() };

describe("PiSessionDelegationLedger", () => {
  it("persists reservations and marks unfinished children interrupted after reconstruction", async () => {
    const root = await mkdtemp(path.join(process.cwd(), ".tmp-delegation-ledger-"));
    try {
      let repo = new JsonlSessionRepo({ fileSystem: new NodeExecutionEnv({ cwd: root }), sessionsRoot: root });
      let session = await repo.create({ cwd: root, id: "parent" }, TODO_CONTEXT);
      let ledger = new PiSessionDelegationLedger(session);
      await ledger.reserve("parent-op", [record], 4);
      await ledger.append({ ...record, state: "accepted", operationId: "child-op", recordedAt: new Date().toISOString() });
      const metadata = (await repo.list({ cwd: root }, TODO_CONTEXT))[0]!;
      await session.close(TODO_CONTEXT);

      repo = new JsonlSessionRepo({ fileSystem: new NodeExecutionEnv({ cwd: root }), sessionsRoot: root });
      session = await repo.open(metadata, TODO_CONTEXT);
      ledger = new PiSessionDelegationLedger(session);
      await ledger.reconcile();
      expect((await ledger.list()).at(-1)).toMatchObject({ runId: "run-1", state: "interrupted", status: "interrupted", operationId: "child-op" });
      const recoveredReserved = { ...record, runId: "recovered-reserved", childSessionId: "recovered-child", parentOperationId: "recovered-parent" };
      await ledger.reserve("recovered-parent", [recoveredReserved], 4);
      await ledger.reconcile([{ runId: "recovered-reserved", operationId: "recovered-operation", status: "interrupted", terminalConfirmed: true }]);
      expect((await ledger.list()).at(-1)).toMatchObject({ runId: "recovered-reserved", state: "interrupted", operationId: "recovered-operation", terminalConfirmed: true });
      await expect(ledger.reserve("parent-op", [
        { ...record, runId: "run-2", childSessionId: "child-2" },
        { ...record, runId: "run-3", childSessionId: "child-3" },
        { ...record, runId: "run-4", childSessionId: "child-4" },
        { ...record, runId: "run-5", childSessionId: "child-5" },
      ], 4)).rejects.toThrow("SUBAGENT_OPERATION_BUDGET_EXHAUSTED");

      const batch = (offset: number) => [0, 1].map((index) => ({
        ...record,
        parentOperationId: "parallel-op",
        runId: `parallel-${offset + index}`,
        childSessionId: `parallel-child-${offset + index}`,
      }));
      const reservations = await Promise.allSettled([
        ledger.reserve("parallel-op", batch(0), 4),
        ledger.reserve("parallel-op", batch(2), 4),
        ledger.reserve("parallel-op", batch(4), 4),
      ]);
      expect(reservations.filter((item) => item.status === "fulfilled")).toHaveLength(2);
      expect(reservations.filter((item) => item.status === "rejected")).toHaveLength(1);
      expect((await ledger.list()).filter((item) => item.parentOperationId === "parallel-op")).toHaveLength(4);
      await session.close(TODO_CONTEXT);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
