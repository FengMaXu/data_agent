import { describe, expect, it } from "vitest";
import { DataAgentRuntime } from "@data-agent/runtime";
import { registerElectronRuntimeIpc, type IpcMainLike } from "./index.js";

 describe("Electron IPC Host", () => {
  it("dispatches the runtime probe without trusting renderer identity", async () => {
    const runtime = new DataAgentRuntime();
    const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();
    const ipcMain: IpcMainLike = {
      handle(channel, handler) {
        handlers.set(channel, handler);
      },
      removeHandler(channel) {
        handlers.delete(channel);
      },
    };

    const unregister = registerElectronRuntimeIpc(ipcMain, runtime);
    const response = await handlers.get("data-agent:command")?.({}, {
      protocolVersion: 1,
      requestId: "req-1",
      userId: "spoofed",
      command: { type: "runtime.probe" },
    });

    expect(response).toMatchObject({
      protocolVersion: 1,
      requestId: "req-1",
      response: { type: "runtime.probe.result" },
    });
    unregister();
    expect(handlers.has("data-agent:command")).toBe(false);
  });
});
