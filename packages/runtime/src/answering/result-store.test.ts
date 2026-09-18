import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FileResultStore } from "./result-store.js";
import type { BusinessContext } from "./model.js";

const context: BusinessContext = { principal: { id: "user-1" }, sessionId: "session-1", lane: "main", operationId: "operation-1", invocationId: "invocation-1" };

describe("immutable ResultStore", () => {
  it("preserves typed values and distinguishes NULL from an empty string", async () => {
    const root = await mkdtemp(join(process.cwd(), ".tmp-typed-result-store-"));
    const store = new FileResultStore(root);
    const typed = await store.createPrivate({
      columns: ["big", "decimal", "nullable", "empty", "when"],
      columnTypes: ["BIGINT", "DECIMAL", "NULL", "TEXT", "TIMESTAMP WITH TIME ZONE"],
      rows: [[1234567890123456789n, "10.20", null, "", new Date("2026-01-01T08:00:00.000Z")]],
      truncated: false,
    }, context);
    try {
      const reopened = await store.openPrivate(typed.resultRef, context);
      expect(reopened?.rows[0]).toEqual([1234567890123456789n, "10.20", null, "", new Date("2026-01-01T08:00:00.000Z")]);
      const inline = await store.encodeInline(typed.resultRef, context);
      const csv = await store.encodeCsv(typed.resultRef, context);
      expect(inline.content).toContain("1234567890123456789");
      expect(inline.content).toContain("10.20");
      expect(csv.content).toContain('""');
      expect(csv.content).toContain("2026-01-01T08:00:00.000Z");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reconciles private orphans without rerunning SQL", async () => {
    const root = await mkdtemp(join(process.cwd(), ".tmp-orphan-result-store-"));
    const store = new FileResultStore(root);
    try {
      const keep = await store.createPrivate({ columns: ["value"], rows: [[1]], truncated: false }, context);
      const orphan = await store.createPrivate({ columns: ["value"], rows: [[2]], truncated: false }, context);
      await expect(store.openPrivate(orphan.resultRef, context)).resolves.toBeDefined();
      const receipt = { receiptId: "publication-1", taskId: "task-1", principalId: "user-1", sessionId: "session-1", candidateId: "candidate-1", revisionId: "revision-1", resultRef: keep.resultRef, format: "inline", publicRef: "/api/runtime/publications/publication-1?session_id=session-1", contentHash: keep.contentHash, policyVersion: "answering-publication-v1", createdByInvocationId: "invocation-1", requestId: "publish-1", createdAt: "2026-01-01T00:00:00.000Z" } as never;
      await expect(store.openAuthorized(keep.resultRef, { ...receipt, principalId: "other-user" }, context)).rejects.toThrow("RESULT_REF_NOT_AUTHORIZED");
      await expect(store.reconcile([keep.resultRef], context)).resolves.toEqual([orphan.resultRef]);
      await expect(store.openPrivate(orphan.resultRef, context)).resolves.toBeUndefined();
      await expect(store.openPrivate(keep.resultRef, context)).resolves.toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a tampered object instead of treating it as a valid Candidate", async () => {
    const root = await mkdtemp(join(process.cwd(), ".tmp-result-store-"));
    try {
      const store = new FileResultStore(root);
      const created = await store.createPrivate({ columns: ["value", "missing"], rows: [[1n, null]], columnTypes: ["BIGINT", "NULL"], truncated: false }, context);
      const file = join(root, `${created.resultRef}.json`);
      const tampered = JSON.parse(await readFile(file, "utf8")) as { rows: unknown[][] };
      tampered.rows[0][0] = "not-the-original-bigint";
      await writeFile(file, JSON.stringify(tampered), "utf8");
      await expect(store.openPrivate(created.resultRef, context)).rejects.toThrow("RESULT_INTEGRITY_MISMATCH");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
