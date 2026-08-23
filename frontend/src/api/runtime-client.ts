/**
 * Shared-transport client for the Renderer.
 * Wraps @data-agent/transport so every feature call goes through the versioned
 * command contract — Electron IPC or HTTP, selected once at startup.
 */
import {
  createHttpTransport,
  createIpcTransport,
  type DataAgentTransport,
  type ElectronCommandBridge,
} from "@data-agent/transport";
import type {
  DataAgentCommand,
  DataAgentCommandEnvelope,
  DataAgentResponseEnvelope,
} from "@data-agent/contracts";

let sequence = 0;

function envelope(command: DataAgentCommand, sessionId?: string): DataAgentCommandEnvelope {
  sequence += 1;
  return {
    protocolVersion: 1,
    requestId: `renderer-${Date.now()}-${sequence}`,
    command,
    ...(sessionId ? {} : {}),
  } as DataAgentCommandEnvelope;
}

export interface RuntimeClient {
  dispatch(command: DataAgentCommand, sessionId?: string): Promise<DataAgentResponseEnvelope>;
  /** Subscribe to runtime events via the Host bridge (Electron) or SSE (Web). */
  onEvent?(listener: (event: unknown) => void): () => void;
}

export function createElectronRuntimeClient(bridge: ElectronCommandBridge): RuntimeClient {
  const transport: DataAgentTransport = createIpcTransport(bridge);
  return {
    dispatch: (command, sessionId) => transport.dispatch(envelope(command, sessionId)) as unknown as Promise<DataAgentResponseEnvelope>,
  };
}

export function createHttpRuntimeClient(baseUrl: string, fetchLike: typeof fetch = fetch): RuntimeClient {
  const transport: DataAgentTransport = createHttpTransport(baseUrl, fetchLike as any);
  return {
    dispatch: (command, sessionId) => transport.dispatch(envelope(command, sessionId)) as unknown as Promise<DataAgentResponseEnvelope>,
  };
}

/** Picks the transport once: Electron bridge when present, otherwise HTTP. */
export function selectRuntimeClient(options: { electronBridge?: ElectronCommandBridge; httpBaseUrl?: string; fetchLike?: typeof fetch }): RuntimeClient {
  if (options.electronBridge) return createElectronRuntimeClient(options.electronBridge);
  return createHttpRuntimeClient(options.httpBaseUrl ?? "", options.fetchLike);
}

let selected: RuntimeClient | undefined;

/** Process-lifetime client: Electron bridge when window.dataAgent exists, else HTTP. */
export function getRuntimeClient(): RuntimeClient {
  if (selected) return selected;
  const bridge = (window as any).dataAgent;
  if (bridge && typeof bridge.invokeRuntimeCommand === "function") {
    selected = createElectronRuntimeClient({ invoke: (channel, payload) => bridge.invokeRuntimeCommand(channel, payload) });
  } else {
    const base = (import.meta as any).env?.VITE_API_BASE_URL?.trim()?.replace(/\/$/, "") ?? "";
    selected = createHttpRuntimeClient(base);
  }
  return selected;
}
