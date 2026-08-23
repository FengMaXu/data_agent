import { describe, expect, it } from "vitest";
import { DataAgentRuntime } from "@data-agent/runtime";
import { registerElectronRuntimeIpc, type IpcMainLike } from "./index.js";

 describe("Electron IPC Host", () => {
  it("dispatches the runtime probe without trusting renderer identity", async () => {
    const runtime = new DataAgentRuntime({ agent: { prompt: async () => undefined, abort: () => undefined } });
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
      command: { type: "agent.prompt", prompt: "hello" },
    });

    expect(response).toMatchObject({
      protocolVersion: 1,
      requestId: "req-1",
      response: { type: "agent.prompt.accepted" },
    });
    unregister();
    expect(handlers.has("data-agent:command")).toBe(false);
  });
});

import { MetadataStore, PiJsonlSessionStore } from "@data-agent/runtime";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

describe("Electron IPC Host: migrated capabilities", () => {
  it("dispatches task/session/knowledge/config commands over IPC", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ipc-e2e-"));
    await mkdir(path.join(root, "knowledge"), { recursive: true });
    const metadata = new MetadataStore(path.join(root, "meta.db"));
    const runtime = new DataAgentRuntime({
      metadata,
      sessions: new PiJsonlSessionStore(path.join(root, "sessions")),
      knowledgeRoot: path.join(root, "knowledge"),
      agent: { prompt: async () => undefined, abort: () => undefined },
    });
    const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();
    registerElectronRuntimeIpc({ handle: (channel, handler) => { handlers.set(channel, handler); }, removeHandler: (channel) => { handlers.delete(channel); } }, runtime);

    const dispatch = (type: string, extra: Record<string, unknown> = {}) =>
      handlers.get("data-agent:command")?.({}, { protocolVersion: 1, requestId: `r-${Date.now()}`, command: { type, ...extra } });

    const created = await dispatch("task.create", { name: "IPC" }) as { response?: { type?: string; item?: { id?: string } } };
    expect(created.response?.type).toBe("mutation.result");
    const taskId = created.response!.item!.id!;
    const session = await dispatch("session.create", { taskId, name: "S" }) as { response?: { item?: { id?: string } } };
    expect(session.response?.item?.id).toBeTruthy();
    await dispatch("knowledge.save", { path: "a.md", content: "# hi" });
    const list = await dispatch("knowledge.list") as { response?: { files?: Array<{ path: string }> } };
    expect(list.response?.files?.some((f) => f.path === "a.md")).toBe(true);
    await dispatch("config.save", { patch: { key1: "v" } });
    const cfg = await dispatch("config.get") as { response?: { config?: Record<string, unknown> } };
    expect(cfg.response?.config?.key1).toBe("v");
  }, 30000);
});
