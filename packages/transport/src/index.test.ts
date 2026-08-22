import { describe, expect, it } from "vitest";
import { createHttpTransport, createIpcTransport } from "./index.js";

const command = {
  protocolVersion: 1 as const,
  requestId: "req-1",
  command: { type: "runtime.probe" as const },
};

const response = {
  protocolVersion: 1 as const,
  requestId: "req-1",
  response: {
    type: "runtime.probe.result" as const,
    service: "data-agent-runtime" as const,
    runtimeVersion: "0.1.0" as const,
  },
};

describe("Renderer transport", () => {
  it("uses HTTP for the same command contract", async () => {
    const transport = createHttpTransport("http://localhost", async (input, init) => {
      expect(input).toBe("http://localhost/api/runtime/command");
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify(response), { status: 200 });
    });

    await expect(transport.dispatch(command)).resolves.toEqual(response);
  });

  it("uses the Electron bridge without exposing IPC details to callers", async () => {
    const transport = createIpcTransport({
      invoke: async (channel, payload) => {
        expect(channel).toBe("data-agent:command");
        expect(payload).toEqual(command);
        return response;
      },
    });

    await expect(transport.dispatch(command)).resolves.toEqual(response);
  });
});
