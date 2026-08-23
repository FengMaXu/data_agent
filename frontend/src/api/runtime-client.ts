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

// ── Feature-level helpers over versioned commands ──────────────────────────

export async function listTasksViaRuntime(): Promise<Array<{ id: string; name: string; createdAt?: number; updatedAt?: number }>> {
  const envelope = await getRuntimeClient().dispatch({ type: "task.list" });
  const result = envelope.response;
  if (result.type !== "list.result") throw new Error("UNEXPECTED_RESPONSE");
  return result.items as Array<{ id: string; name: string; createdAt?: number; updatedAt?: number }>;
}

export async function createTaskViaRuntime(name: string): Promise<{ id: string }> {
  const envelope = await getRuntimeClient().dispatch({ type: "task.create", name });
  const result = envelope.response;
  if (result.type !== "mutation.result") throw new Error("UNEXPECTED_RESPONSE");
  return result.item as { id: string };
}

export async function listSessionsViaRuntime(taskId?: string): Promise<Array<{ id: string; taskId?: string; name: string }>> {
  const envelope = await getRuntimeClient().dispatch({ type: "session.list", ...(taskId ? { taskId } : {}) });
  const result = envelope.response;
  if (result.type !== "list.result") throw new Error("UNEXPECTED_RESPONSE");
  return result.items as Array<{ id: string; taskId?: string; name: string }>;
}

export async function createSessionViaRuntime(taskId: string, name?: string): Promise<{ id: string }> {
  const envelope = await getRuntimeClient().dispatch({ type: "session.create", taskId, ...(name ? { name } : {}) });
  const result = envelope.response;
  if (result.type !== "mutation.result") throw new Error("UNEXPECTED_RESPONSE");
  return result.item as { id: string };
}

export async function listWorkspaceViaRuntime(): Promise<string[]> {
  const envelope = await getRuntimeClient().dispatch({ type: "workspace.list" });
  const result = envelope.response;
  if (result.type !== "workspace.result" || !result.files) throw new Error("UNEXPECTED_RESPONSE");
  return result.files;
}

export async function searchKnowledgeViaRuntime(query: string): Promise<Array<{ path: string; title: string; score: number }>> {
  const envelope = await getRuntimeClient().dispatch({ type: "knowledge.search", query });
  const result = envelope.response;
  if (result.type !== "knowledge.search.result") throw new Error("UNEXPECTED_RESPONSE");
  return result.hits as Array<{ path: string; title: string; score: number }>;
}

export async function readKnowledgeViaRuntime(path: string): Promise<string> {
  const envelope = await getRuntimeClient().dispatch({ type: "knowledge.read", path });
  const result = envelope.response;
  if (result.type !== "knowledge.read.result") throw new Error("UNEXPECTED_RESPONSE");
  return result.content;
}

export async function stopAgentViaRuntime(): Promise<void> {
  await getRuntimeClient().dispatch({ type: "agent.stop" });
}

export async function steerAgentViaRuntime(prompt: string): Promise<void> {
  await getRuntimeClient().dispatch({ type: "agent.steer", prompt });
}

export async function renameSessionViaRuntime(sessionId: string, name: string): Promise<void> {
  await getRuntimeClient().dispatch({ type: "session.rename", sessionId, name });
}

export async function deleteSessionViaRuntime(sessionId: string): Promise<void> {
  await getRuntimeClient().dispatch({ type: "session.delete", sessionId });
}

export async function renameTaskViaRuntime(taskId: string, name: string): Promise<void> {
  await getRuntimeClient().dispatch({ type: "task.rename", taskId, name });
}

export async function deleteTaskViaRuntime(taskId: string): Promise<void> {
  await getRuntimeClient().dispatch({ type: "task.delete", taskId });
}
export async function createTaskWithIdViaRuntime(name: string): Promise<{ id: string; name: string }> {
  const envelope = await getRuntimeClient().dispatch({ type: 'task.create', name });
  const result = envelope.response;
  if (result.type !== 'mutation.result') throw new Error('UNEXPECTED_RESPONSE');
  return result.item as { id: string; name: string };
}

export async function deleteWorkspaceFileViaRuntime(path: string): Promise<void> {
  await getRuntimeClient().dispatch({ type: "workspace.delete", path });
}

export async function writeWorkspaceFileViaRuntime(path: string, content: string): Promise<void> {
  await getRuntimeClient().dispatch({ type: "workspace.write", path, content });
}

export async function listKnowledgeViaRuntime(): Promise<Array<{ path: string; size: number; modifiedAt: number }>> {
  const envelope = await getRuntimeClient().dispatch({ type: "knowledge.list" });
  const result = envelope.response;
  if (result.type !== "knowledge.list.result") throw new Error("UNEXPECTED_RESPONSE");
  return result.files;
}

export async function saveKnowledgeViaRuntime(path: string, content: string): Promise<void> {
  await getRuntimeClient().dispatch({ type: "knowledge.save", path, content });
}

export interface RuntimeSemanticConnection { connectionId: string; sources: Array<{ sourceName: string; sourceKind: string; assetType: string; title: string | null; isQueryable: boolean; hasOverlay: boolean; description: string }> }

export async function listSemanticSourcesViaRuntime(): Promise<Array<{ connectionId: string; sourceName: string; updatedAt: number }>> {
  const envelope = await getRuntimeClient().dispatch({ type: "semantic.sources.list" });
  const result = envelope.response;
  if (result.type !== "semantic.sources.result") throw new Error("UNEXPECTED_RESPONSE");
  return result.sources as Array<{ connectionId: string; sourceName: string; updatedAt: number }>;
}

export async function getSemanticSourceViaRuntime(connectionId: string, sourceName: string): Promise<{ rawYaml: string }> {
  const envelope = await getRuntimeClient().dispatch({ type: "semantic.sources.get", connectionId, sourceName });
  const result = envelope.response;
  if (result.type !== "semantic.source.result") throw new Error("UNEXPECTED_RESPONSE");
  return (result.source as { definition: { rawYaml?: string } }).definition as { rawYaml: string };
}

export interface RuntimeSkillInfo { name: string; description: string; tools?: string[] }

export async function listSkillsViaRuntime(): Promise<RuntimeSkillInfo[]> {
  const envelope = await getRuntimeClient().dispatch({ type: "skills.list" });
  const result = envelope.response;
  if (result.type !== "skills.list.result") throw new Error("UNEXPECTED_RESPONSE");
  return result.skills;
}

export async function getMcpConfigViaRuntime(): Promise<{ servers: Array<Record<string, unknown>> }> {
  const envelope = await getRuntimeClient().dispatch({ type: "mcp.config.get" });
  const result = envelope.response;
  if (result.type !== "mcp.config.result") throw new Error("UNEXPECTED_RESPONSE");
  const cfg = (result.config ?? {}) as { servers?: Array<Record<string, unknown>> };
  return { servers: cfg.servers ?? [] };
}

export async function saveMcpConfigViaRuntime(config: { servers: Array<Record<string, unknown>> }): Promise<void> {
  await getRuntimeClient().dispatch({ type: "mcp.config.save", config });
}

export interface RuntimeIngestStatus { status: string; jobId: string | null; summary: { updated: number; unchanged: number; failed: number; skipped: number }; errorCode: string | null }

export async function getIngestStatusViaRuntime(): Promise<RuntimeIngestStatus> {
  const envelope = await getRuntimeClient().dispatch({ type: "semantic.ingest.status" });
  const result = envelope.response;
  if (result.type !== "semantic.ingest.status.result") throw new Error("UNEXPECTED_RESPONSE");
  return result as unknown as RuntimeIngestStatus;
}

export async function retryIngestViaRuntime(): Promise<void> {
  const envelope = await getRuntimeClient().dispatch({ type: "semantic.ingest.retry" });
  if (envelope.response.type !== "semantic.ingest.retry.result") throw new Error("UNEXPECTED_RESPONSE");
}

export async function answerClarificationViaRuntime(clarificationId: string, answer: string): Promise<void> {
  await getRuntimeClient().dispatch({ type: "clarification.answer", clarificationId, answer });
}

export function subscribeRuntimeEvents(listener: (envelope: unknown) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const base = (import.meta as { env?: Record<string, string> }).env?.VITE_API_BASE_URL ?? "";
  const source = new EventSource(`${base}/api/runtime/events`);
  source.onmessage = (message) => {
    try { listener(JSON.parse(message.data)); } catch { /* ignore malformed */ }
  };
  return () => source.close();
}

export interface RuntimeChatHandle { cancel: () => void; finished: Promise<void> }

/**
 * Chat streaming over the shared transport: dispatches agent.prompt and
 * consumes versioned runtime events (agent.text_delta / agent.tool_started /
 * agent.tool_finished / agent.completed). The legacy SSE DTO adapter lives in
 * ChatArea and will be dissolved when the component consumes versioned
 * events natively.
 */
export function sendChatViaRuntime(
  prompt: string,
  onEvent: (envelope: any) => void,
  onError: (err: unknown) => void,
  onFinish: () => void,
): RuntimeChatHandle {
  const unsubscribe = subscribeRuntimeEvents((envelope) => onEvent(envelope));
  const controller = new AbortController();
  const finished = (async () => {
    try {
      await getRuntimeClient().dispatch({ type: "agent.prompt", prompt });
      onFinish();
    } catch (err) {
      if ((err as Error)?.name === "AbortError") { onFinish(); return; }
      onError(err);
      onFinish();
    }
  })();
  return { cancel: () => { controller.abort(); unsubscribe(); }, finished };
}
