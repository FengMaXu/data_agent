import { afterEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("../client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import { subscribeRuntimeEvents } from "../runtime-client";

function streamOf(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const envelope = (sequence: number) => JSON.stringify({ protocolVersion: 1, sequence, requestId: "r", timestamp: 1, event: { type: "agent.completed" } });

describe("runtime event stream subscription", () => {
  afterEach(() => { apiFetch.mockReset(); });

  it("reports the connection, forwards data and turns a resync event into a snapshot request", async () => {
    apiFetch.mockResolvedValueOnce(streamOf([": connected\n\n", "event: resync\ndata: {\"afterSequence\":3}\n\n", `id: 9\ndata: ${envelope(9)}\n\n`]));
    apiFetch.mockImplementation(() => new Promise(() => undefined));
    const received: unknown[] = [];
    const onConnected = vi.fn();
    const onResync = vi.fn();
    const unsubscribe = subscribeRuntimeEvents((payload) => received.push(payload), "session-1", { onConnected, onResync });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(onResync).toHaveBeenCalledTimes(1);
    expect(received[0]).toMatchObject({ sequence: 9 });
    unsubscribe();
  });

  it("does not move the cursor past an event the listener failed on, and reports reconnects", async () => {
    apiFetch.mockResolvedValueOnce(streamOf([`id: 4\ndata: ${envelope(4)}\n\n`, "data: {not json\n\n", `id: 5\ndata: ${envelope(5)}\n\n`]));
    apiFetch.mockImplementation(() => new Promise(() => undefined));
    const states: string[] = [];
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const unsubscribe = subscribeRuntimeEvents((payload) => {
      if ((payload as { sequence: number }).sequence === 5) throw new Error("render failed");
    }, "session-1", { onConnectionChange: (state) => states.push(state) });
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2), { timeout: 2_000 });
    const reconnectUrl = apiFetch.mock.calls[1]![0] as URL;
    expect(reconnectUrl.searchParams.get("after_sequence")).toBe("4");
    expect(states.slice(0, 2)).toEqual(["connected", "reconnecting"]);
    expect(errors).toHaveBeenCalledWith("[runtime-events] event listener failed", expect.any(Error));
    errors.mockRestore();
    unsubscribe();
  });
});
