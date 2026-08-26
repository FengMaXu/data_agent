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
