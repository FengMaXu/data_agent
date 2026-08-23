import { describe, expect, it } from "vitest";
import { selectRuntimeClient } from "../runtime-client";
import type { DataAgentResponseEnvelope } from "@data-agent/contracts";

const probeResponse: DataAgentResponseEnvelope = {
  protocolVersion: 1,
  requestId: "req-1",
  response: { type: "runtime.probe.result", service: "data-agent-runtime", runtimeVersion: "0.1.0" },
};

describe("runtime client", () => {
  it("dispatches through the Electron bridge when available", async () => {
    let channel: string | undefined;
    const client = selectRuntimeClient({
      electronBridge: {
        invoke: async (ch, payload) => {
          channel = ch;
          expect((payload as any).command.type).toBe("runtime.probe");
          return probeResponse;
        },
      },
    });
    const result = await client.dispatch({ type: "runtime.probe" });
    expect(channel).toBe("data-agent:command");
    expect(result.response.type).toBe("runtime.probe.result");
  });

  it("falls back to HTTP with the same contract", async () => {
    const client = selectRuntimeClient({
      httpBaseUrl: "http://127.0.0.1:8080",
      fetchLike: (async () => new Response(JSON.stringify(probeResponse), { status: 200 })) as any,
    });
    await expect(client.dispatch({ type: "runtime.probe" })).resolves.toMatchObject({
      response: { type: "runtime.probe.result" },
    });
  });
});
