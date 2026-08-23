import { describe, expect, it } from "vitest";
import { createElectronRuntimeClient, createHttpRuntimeClient, selectRuntimeClient } from "../runtime-client";

const probeResponse = {
  protocolVersion: 1 as const,
  requestId: "req-1",
  response: { type: "runtime.probe.result" as const, service: "data-agent-runtime" as const, runtimeVersion: "0.1.0" as const },
};

describe("runtime client", () => {
  it("dispatches through the Electron bridge when available", async () => {
    let channel: string | undefined;
    const client = selectRuntimeClient({
      electronBridge: { invoke: async (ch, payload) => { channel = ch; expect((payload as any).command.type).toBe("runtime.probe"); return probeResponse; } },
    });
    const result = await client.dispatch({ type: "runtime.probe" });
    expect(channel).toBe("data-agent:command");
    expect(result.response.type).toBe("runtime.probe.result");
  });

  it("falls back to HTTP with the same contract", async () => {
    const client = selectRuntimeClient({
      httpBaseUrl: "http://127.0.0.1:8080",
      fetchLike: (async (input: any) => new Response(JSON.stringify(probeResponse), { status: 200 })) as any,
    });
    const created = (client as any).dispatch;
    expect(created).toBeDefined();
    await expect(client.dispatch({ type: "runtime.probe" })).resolves.toMatchObject({ response: { type: "runtime.probe.result" } });
    void createElectronRuntimeClient; void createHttpRuntimeClient;
  });
});
