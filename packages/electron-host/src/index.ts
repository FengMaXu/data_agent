import {
  parseDataAgentCommandEnvelope,
  type RequestContext,
} from "@data-agent/contracts";
import {
  DataAgentRuntime,
  DataAgentRuntimeError,
} from "@data-agent/runtime";

export interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: unknown, payload: unknown) => Promise<unknown>,
  ): void;
  removeHandler(channel: string): void;
}

export interface ElectronRuntimeHostOptions {
  contextFactory?: (event: unknown) => RequestContext;
}

export function registerElectronRuntimeIpc(
  ipcMain: IpcMainLike,
  runtime: DataAgentRuntime,
  options: ElectronRuntimeHostOptions = {},
): () => void {
  const contextFactory = options.contextFactory ?? (() => ({ userId: "local", host: "electron" as const }));

  ipcMain.handle("data-agent:command", async (event, payload) => {
    try {
      const command = parseDataAgentCommandEnvelope(payload);
      return await runtime.dispatch(command, contextFactory(event));
    } catch (error) {
      throw toIpcError(error);
    }
  });

  return () => ipcMain.removeHandler("data-agent:command");
}

function toIpcError(error: unknown): Error {
  if (error instanceof DataAgentRuntimeError) return error;
  if (error instanceof TypeError) {
    return new DataAgentRuntimeError("INVALID_COMMAND", error.message);
  }
  return new DataAgentRuntimeError("INVALID_COMMAND", "DataAgent command failed", {
    cause: error instanceof Error ? error.message : String(error),
  });
}
