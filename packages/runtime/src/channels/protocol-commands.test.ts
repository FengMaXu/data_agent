import { describe, expect, it } from "vitest";
import { DataAgentRuntime } from "../protocol.js";

const command = (body: Record<string, unknown>) => ({ protocolVersion: 1 as const, requestId: "r", command: body }) as never;
const context = { userId: "u", host: "web" as const };

describe("channel commands", () => {
  it("say plainly when this host has no channels", async () => {
    await expect(new DataAgentRuntime().dispatch(command({ type: "channel.list" }), context)).rejects.toThrow("CHANNELS_NOT_CONFIGURED");
  });

  it("route list, provision and disconnect to the host's channel control", async () => {
    const runtime = new DataAgentRuntime();
    const calls: string[] = [];
    const status = [{ id: "feishu", label: "飞书", state: "unconfigured" as const, provisionable: true }];
    runtime.channelControl = {
      list: () => status,
      provision: async (id) => { calls.push(`provision:${id}`); return status; },
      disconnect: async (id) => { calls.push(`disconnect:${id}`); return status; },
    };
    for (const body of [{ type: "channel.list" }, { type: "channel.provision", channelId: "feishu" }, { type: "channel.disconnect", channelId: "feishu" }]) {
      expect((await runtime.dispatch(command(body), context)).response).toEqual({ type: "channel.list.result", channels: status });
    }
    expect(calls).toEqual(["provision:feishu", "disconnect:feishu"]);
  });
});
