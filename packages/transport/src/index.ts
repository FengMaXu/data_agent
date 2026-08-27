import {
  parseDataAgentResponseEnvelope,
  type DataAgentCommandEnvelope,
  type DataAgentResponseEnvelope,
} from "@data-agent/contracts";

export interface DataAgentTransport {
  dispatch(command: DataAgentCommandEnvelope): Promise<DataAgentResponseEnvelope>;
}

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface ElectronCommandBridge {
  invoke(channel: string, payload: unknown): Promise<unknown>;
  subscribe?(listener: (payload: unknown) => void, sessionId?: string): () => void;
}

export function createHttpTransport(
  baseUrl: string,
  fetchLike: FetchLike = fetch,
): DataAgentTransport {
  return {
    async dispatch(command) {
      const response = await fetchLike(`${baseUrl.replace(/\/$/, "")}/api/runtime/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      if (!response.ok) {
        throw new Error(`DataAgent HTTP command failed: ${response.status}`);
      }
      return parseDataAgentResponseEnvelope(await response.json());
    },
  };
}

export { createHttpFileTransfer, type WorkspaceFileTransfer } from "./files.js";

export function createIpcTransport(bridge: ElectronCommandBridge): DataAgentTransport {
  return {
    async dispatch(command) {
      return parseDataAgentResponseEnvelope(
        await bridge.invoke("data-agent:command", command),
      );
    },
  };
}
