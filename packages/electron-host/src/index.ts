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
  on(channel: string, listener: IpcEventListener): void;
  removeListener(channel: string, listener: IpcEventListener): void;
}

type IpcEventListener = (event: unknown, payload?: unknown) => void;
interface IpcSenderLike {
  send(channel: string, payload: unknown): void;
}
interface EventSubscription {
  sessionId?: string;
  unsubscribe: () => void;
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
  const eventSubscriptions = new Map<IpcSenderLike, EventSubscription>();

  ipcMain.handle("data-agent:command", async (event, payload) => {
    try {
      const command = parseDataAgentCommandEnvelope(payload);
      const context: RequestContext = contextFactory(event);
      const effectiveContext = context.sessionId || !command.sessionId
        ? context
        : { ...context, sessionId: command.sessionId };
      return await runtime.dispatch(command, effectiveContext);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  const removeSender = (sender: IpcSenderLike): void => {
    const subscription = eventSubscriptions.get(sender);
    if (!subscription) return;
    subscription.unsubscribe();
    eventSubscriptions.delete(sender);
  };

  const subscribeListener: IpcEventListener = (event, payload) => {
    const sender = getIpcSender(event);
    if (!sender) return;
    removeSender(sender);
    const sessionId = getSessionId(payload);
    const unsubscribe = runtime.subscribe((envelope) => {
      if (sessionId && envelope.sessionId !== sessionId) return;
      try {
        sender.send("data-agent:event", envelope);
      } catch {
        removeSender(sender);
      }
    });
    eventSubscriptions.set(sender, { sessionId, unsubscribe });
  };

  const unsubscribeListener: IpcEventListener = (event) => {
    const sender = getIpcSender(event);
    if (sender) removeSender(sender);
  };

  ipcMain.on("data-agent:events:subscribe", subscribeListener);
  ipcMain.on("data-agent:events:unsubscribe", unsubscribeListener);

  return () => {
    ipcMain.removeHandler("data-agent:command");
    ipcMain.removeListener("data-agent:events:subscribe", subscribeListener);
    ipcMain.removeListener("data-agent:events:unsubscribe", unsubscribeListener);
    for (const sender of eventSubscriptions.keys()) removeSender(sender);
  };
}

function getSessionId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const sessionId = (payload as { sessionId?: unknown }).sessionId;
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : undefined;
}

function getIpcSender(event: unknown): IpcSenderLike | undefined {
  if (!event || typeof event !== "object") return undefined;
  const sender = (event as { sender?: unknown }).sender;
  if (!sender || typeof sender !== "object") return undefined;
  if (typeof (sender as { send?: unknown }).send !== "function") return undefined;
  return sender as IpcSenderLike;
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
