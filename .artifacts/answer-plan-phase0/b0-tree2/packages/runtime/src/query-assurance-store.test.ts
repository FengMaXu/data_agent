import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonFileQueryAssuranceStateStore } from "./query-assurance-store.js";

const state = {
  version: 1 as const,
  specs: [],
  tasks: [],
  artifacts: [],
  repairAttempts: [["task:1", 1] as const],
  failedCandidates: [],
};

describe("JsonFileQueryAssuranceStateStore", () => {
  it("appends versioned state snapshots and restores the latest one", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-assurance-state-"));
    try {
      const file = join(root, "nested", "state.json");
      const store = new JsonFileQueryAssuranceStateStore(file);
      store.save(state);
      store.save({ ...state, repairAttempts: [["task:1", 2]] });
      const records = (await readFile(file, "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line));
      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({ version: 1, repairAttempts: [["task:1", 1]] });
      expect(store.load()).toMatchObject({ ...state, repairAttempts: [["task:1", 2]] });
      expect(await readFile(file, "utf8")).not.toContain("partial");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("authenticates cross-trust journals and rejects missing or incorrect keys", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-assurance-state-auth-"));
    try {
      const file = join(root, "state.jsonl");
      new JsonFileQueryAssuranceStateStore(file, { integrityKey: "trusted-secret" }).save(state);
      expect(() => new JsonFileQueryAssuranceStateStore(file).load()).toThrow("QUERY_ASSURANCE_STATE_AUTHENTICATION_REQUIRED");
      expect(() => new JsonFileQueryAssuranceStateStore(file, { integrityKey: "wrong-secret" }).load()).toThrow("QUERY_ASSURANCE_STATE_AUTHENTICATION_INVALID");
      expect(new JsonFileQueryAssuranceStateStore(file, { integrityKey: "trusted-secret" }).load()).toMatchObject(state);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed when a stale writer would overwrite a newer snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-assurance-state-concurrency-"));
    try {
      const file = join(root, "state.jsonl");
      const first = new JsonFileQueryAssuranceStateStore(file);
      const stale = new JsonFileQueryAssuranceStateStore(file);
      expect(first.load()).toBeUndefined();
      expect(stale.load()).toBeUndefined();
      first.save(state);
      expect(() => stale.save({ ...state, repairAttempts: [["task:1", 2]] })).toThrow("QUERY_ASSURANCE_STATE_CONCURRENT_WRITE");
      expect(first.load()).toMatchObject(state);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed for an unknown state version", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-assurance-state-version-"));
    try {
      const file = join(root, "state.json");
      await writeFile(file, JSON.stringify({ version: 2 }), "utf8");
      expect(() => new JsonFileQueryAssuranceStateStore(file).load()).toThrow("QUERY_ASSURANCE_STATE_VERSION_UNSUPPORTED");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
