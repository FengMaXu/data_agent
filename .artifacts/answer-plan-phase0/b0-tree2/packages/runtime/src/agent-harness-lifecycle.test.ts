import { describe, expect, it } from "vitest";
import { createAgentHarnessResolver } from "./agent-harness-lifecycle.js";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("AgentHarness startup lifecycle", () => {
  it("starts warm-up without delaying startup", async () => {
    let createStarted = false;
    let releaseCreate!: () => void;
    const createGate = new Promise<void>((resolve) => { releaseCreate = resolve; });
    const resolver = createAgentHarnessResolver({
      getProfile: async () => ({ model: "test" }),
      create: async () => {
        createStarted = true;
        await createGate;
        return { id: "warm" };
      },
    });

    resolver.warmup();
    expect(createStarted).toBe(false);
    await tick();
    expect(createStarted).toBe(true);
    releaseCreate();
    await resolver.resolve();
  });

  it("shares warm-up with concurrent first requests", async () => {
    let createCount = 0;
    let releaseCreate!: () => void;
    const createGate = new Promise<void>((resolve) => { releaseCreate = resolve; });
    const resolver = createAgentHarnessResolver({
      getProfile: async () => ({ model: "test" }),
      create: async () => {
        createCount += 1;
        await createGate;
        return { id: "shared" };
      },
    });

    resolver.warmup();
    const first = resolver.resolve();
    const second = resolver.resolve();
    await tick();
    expect(createCount).toBe(1);
    releaseCreate();
    await expect(first).resolves.toEqual({ id: "shared" });
    await expect(second).resolves.toEqual({ id: "shared" });
  });

  it("shares initialization by scope without mixing interleaved sessions", async () => {
    const releases = new Map<string, () => void>();
    const createCount = new Map<string, number>();
    const resolver = createAgentHarnessResolver({
      getProfile: async () => ({ model: "test" }),
      create: async (_profile, scope) => {
        const key = scope ?? "";
        createCount.set(key, (createCount.get(key) ?? 0) + 1);
        await new Promise<void>((resolve) => { releases.set(key, resolve); });
        return { scope: key };
      },
    });

    const firstA = resolver.resolve("session-A");
    const firstB = resolver.resolve("session-B");
    const secondA = resolver.resolve("session-A");
    await tick();
    expect(createCount).toEqual(new Map([["session-A", 1], ["session-B", 1]]));
    releases.get("session-A")?.();
    releases.get("session-B")?.();
    await expect(Promise.all([firstA, firstB, secondA])).resolves.toEqual([
      { scope: "session-A" },
      { scope: "session-B" },
      { scope: "session-A" },
    ]);
  });

  it("uses a successfully warmed harness for later requests", async () => {
    let createCount = 0;
    const resolver = createAgentHarnessResolver({
      getProfile: async () => ({ model: "test" }),
      create: async () => {
        createCount += 1;
        return { id: "ready" };
      },
    });

    resolver.warmup();
    await resolver.resolve();
    await resolver.resolve();
    expect(createCount).toBe(1);
  });

  it("allows request-time recovery after warm-up failure", async () => {
    let createCount = 0;
    const warmupErrors: unknown[] = [];
    const resolver = createAgentHarnessResolver({
      getProfile: async () => ({ model: "test" }),
      create: async () => {
        createCount += 1;
        if (createCount === 1) throw new Error("temporary failure");
        return { id: "recovered" };
      },
    });

    resolver.warmup((error) => warmupErrors.push(error));
    await tick();
    await expect(resolver.resolve()).resolves.toEqual({ id: "recovered" });
    expect(createCount).toBe(2);
    expect(warmupErrors).toHaveLength(1);
  });
});
