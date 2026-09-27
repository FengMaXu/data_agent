import { afterEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("../client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import { subscribeRuntimeEvents } from "../runtime-client";

function streamOf(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
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
});
