import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createMcpQueryExecutor } from "./mcp-query-executor.js";

/**
 * Production Electron main entry for the TypeScript stack.
 *
 * Responsibilities:
 * - create the per-user data directories (metadata DB, Pi sessions, workspace, knowledge)
 * - construct the shared DataAgentRuntime over those paths
 * - register the versioned command channel on ipcMain
 * - open a BrowserWindow that loads the built Renderer (dist/index.html)
 *
 * The legacy Python backend is never spawned. The bundled Python runtime pack
 * and KTX semantic context are consumed from extraResources at runtime by the
 * Runtime itself.
 */

export interface ElectronMainRuntimePaths {
  userDataDir: string;
  /** Packaged resources dir; resolved from process.resourcesPath by the entry. */
  resourcesPath?: string;
  rendererDist: string;
}

declare const __dirname: string;

export function resolveRuntimePaths(options: { userDataDir: string; appDir?: string }): ElectronMainRuntimePaths {
  let appDir = options.appDir;
  if (!appDir && typeof __dirname !== "undefined") {
    // Both generated entry layouts keep the renderer one directory above the
    // host: frontend/electron-host in development and app.asar/electron-host
    // after packaging.
    appDir = path.resolve(__dirname, "..");
  }
  return {
    userDataDir: options.userDataDir,
    // Renderer output lives in <app>/dist when packaged via electron-builder files config
    rendererDist: path.join(appDir ?? process.cwd(), "dist"),
  };
}

export interface MainDeps {
  app: {
    whenReady(): Promise<void>;
    getPath(name: "userData"): string;
    quit(): void;
    requestSingleInstanceLock?(): boolean;
    on?(event: string, listener: (...args: unknown[]) => void): void;
  };
  /** Packaged resources dir (process.resourcesPath); absent in dev. */
  resourcesPath?: string;
  BrowserWindow: new (options: Record<string, unknown>) => {
    loadFile(file: string): Promise<void>;
    loadURL(url: string): Promise<void>;
    webContents?: { executeJavaScript(script: string): Promise<unknown> };
  };
  ipcMain: unknown;
  safeStorage?: ElectronSafeStorageLike;
  dialog?: ElectronDialogLike;
  autoUpdater?: ElectronUpdateServiceLike;
  protocol?: ElectronProtocolLike;
}

export interface ElectronSafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export interface ElectronDialogLike {
  showOpenDialog(options: Record<string, unknown>): Promise<{ canceled: boolean; filePaths: string[] }>;
}

export interface ElectronUpdateServiceLike {
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
}

export interface ElectronProtocolLike {
  registerSchemesAsPrivileged?(schemes: Array<{ scheme: string; privileges: Record<string, boolean> }>): void;
  handle(scheme: string, handler: (request: { url: string }) => Promise<Response>): Promise<void>;
  unhandle?(scheme: string): void;
}

interface DesktopIpcLike {
  handle(channel: string, listener: (event: unknown, payload: unknown) => Promise<unknown>): void;
  removeHandler(channel: string): void;
}

interface WorkspaceBytesLike {
  writeBytes(relativePath: string, content: Uint8Array): Promise<void>;
}

export interface StoredLLMSecrets {
  openai_api_key?: string;
  anthropic_api_key?: string;
  default_model?: string;
  openai_base_url?: string;
}

const SECRET_FIELDS = ["openai_api_key", "anthropic_api_key", "default_model", "openai_base_url"] as const;
type SecretField = typeof SECRET_FIELDS[number];

export function registerDesktopCapabilities(
  ipcMain: DesktopIpcLike,
  options: {
    userDataDir: string;
    safeStorage?: ElectronSafeStorageLike;
    dialog?: ElectronDialogLike;
    autoUpdater?: ElectronUpdateServiceLike;
    workspace?: WorkspaceBytesLike;
  },
): () => void {
  const secretPath = path.join(options.userDataDir, "secrets.json");
  const handlers = new Set<string>();
  const handle = (channel: string, listener: (event: unknown, payload: unknown) => Promise<unknown>): void => {
    ipcMain.handle(channel, listener);
    handlers.add(channel);
  };

  handle("data-agent:get-stored-secrets", async () => readStoredSecrets(secretPath, options.safeStorage));
  handle("data-agent:save-secrets", async (_event, payload) => {
    if (!options.safeStorage?.isEncryptionAvailable()) return { ok: false };
    const incoming = isRecord(payload) ? payload : {};
    const encrypted = readEncryptedSecretRecord(secretPath);
    for (const field of SECRET_FIELDS) {
      const value = incoming[field];
      if (value === undefined) continue;
      if (typeof value !== "string" || !value.trim()) {
        delete encrypted[field];
        continue;
      }
      encrypted[field] = options.safeStorage.encryptString(value).toString("base64");
    }
    writeEncryptedSecretRecord(secretPath, encrypted);
    return { ok: true };
  });
  handle("data-agent:select-python-executable", async () => {
    if (!options.dialog) return null;
    const result = await options.dialog.showOpenDialog({ properties: ["openFile"] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  handle("data-agent:workspace-upload", async (_event, payload) => {
    if (!options.workspace) throw new Error("WORKSPACE_NOT_CONFIGURED");
    if (!isRecord(payload) || typeof payload.fileName !== "string") throw new Error("WORKSPACE_FILE_REQUIRED");
    const bytes = toBytes(payload.bytes);
    if (!bytes) throw new Error("WORKSPACE_FILE_REQUIRED");
    const fileName = safeUploadName(payload.fileName);
    const sessionId = typeof payload.sessionId === "string" && payload.sessionId ? safeSessionSegment(payload.sessionId) : "";
    const storagePath = sessionId ? `${sessionId}/${fileName}` : fileName;
    await options.workspace.writeBytes(storagePath, bytes);
    return { filename: fileName, session_id: sessionId, relative_path: fileName, size: bytes.byteLength };
  });
  handle("data-agent:show-menu", async () => false);
  handle("data-agent:get-backend-port", async () => null);
  handle("data-agent:check-for-updates", async () => options.autoUpdater ? options.autoUpdater.checkForUpdates() : { ok: false, reason: "UPDATES_NOT_CONFIGURED" });
  handle("data-agent:download-update", async () => options.autoUpdater ? options.autoUpdater.downloadUpdate() : { ok: false, reason: "UPDATES_NOT_CONFIGURED" });
  handle("data-agent:quit-and-install-update", async () => {
    if (!options.autoUpdater) return { ok: false, reason: "UPDATES_NOT_CONFIGURED" };
    options.autoUpdater.quitAndInstall();
    return { ok: true };
  });

  return () => {
    for (const channel of handlers) ipcMain.removeHandler(channel);
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function isRuntimeAgentEvent(value: unknown): value is AgentEvent {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  return ["message_start", "message_update", "tool_execution_start", "tool_execution_update", "tool_execution_end"].includes(value.type);
}

function readEncryptedSecretRecord(secretPath: string): Partial<Record<SecretField, string>> {
  try {
    const parsed = JSON.parse(readFileSync(secretPath, "utf8")) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.encrypted)) return {};
    const encrypted = parsed.encrypted;
    return Object.fromEntries(SECRET_FIELDS.flatMap((field) => typeof encrypted[field] === "string" ? [[field, encrypted[field] as string]] : [])) as Partial<Record<SecretField, string>>;
  } catch {
    return {};
  }
}

function readStoredSecrets(secretPath: string, safeStorage?: ElectronSafeStorageLike): StoredLLMSecrets {
  if (!safeStorage?.isEncryptionAvailable()) return {};
  const encrypted = readEncryptedSecretRecord(secretPath);
  const result: StoredLLMSecrets = {};
  for (const field of SECRET_FIELDS) {
    const value = encrypted[field];
    if (!value) continue;
    try {
      result[field] = safeStorage.decryptString(Buffer.from(value, "base64"));
    } catch {
      // Ignore an unreadable entry; the remaining secrets may still be valid.
    }
  }
  return result;
}

function writeEncryptedSecretRecord(secretPath: string, encrypted: Partial<Record<SecretField, string>>): void {
  const temporary = `${secretPath}.${process.pid}.tmp`;
  mkdirSync(path.dirname(secretPath), { recursive: true });
  writeFileSync(temporary, JSON.stringify({ version: 1, encrypted }, null, 2), "utf8");
  renameSync(temporary, secretPath);
}

function toBytes(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) return Uint8Array.from(value);
  return undefined;
}

function safeUploadName(fileName: string): string {
  const normalized = fileName.replaceAll("\\", "/");
  const name = path.posix.basename(normalized);
  if (!name || name === "." || name === "..") throw new Error("WORKSPACE_FILE_REQUIRED");
  return name;
}

function safeSessionSegment(sessionId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sessionId) || sessionId === "." || sessionId === "..") throw new Error("INVALID_WORKSPACE_SESSION");
  return sessionId;
}

async function registerWorkspaceProtocol(protocol: ElectronProtocolLike | undefined, workspace: WorkspaceBytesLike & { readBytesWithLegacyFallback(relativePath: string): Promise<Uint8Array> }): Promise<() => void> {
  if (!protocol) return () => undefined;
  await protocol.handle("data-agent", async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== "workspace" || !url.pathname.startsWith("/workspace/files/")) return new Response("Not found", { status: 404 });
      const relativePath = url.searchParams.get("path") ?? "";
      if (!relativePath) return new Response("File path is required", { status: 400 });
      const bytes = await workspace.readBytesWithLegacyFallback(relativePath);
      return new Response(Buffer.from(bytes), { headers: { "Content-Type": contentTypeFor(relativePath), "Cache-Control": "no-store" } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  return () => protocol.unhandle?.("data-agent");
}

function contentTypeFor(relativePath: string): string {
  const extension = path.extname(relativePath).toLowerCase();
  return ({
    ".csv": "text/csv; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
  } as Record<string, string>)[extension] ?? "application/octet-stream";
}

function createElectronQueryExecutor(
  metadata: { getConfig(key: string): Promise<unknown> },
  options: { command: string; args: string[]; baseEnv?: Record<string, string> },
) {
  let executor: ReturnType<typeof createMcpQueryExecutor> | undefined;
  let executorKey = "";

  const resolveExecutor = async () => {
    const saved = await metadata.getConfig("ui.settings");
    const cfg = isRecord(saved) ? saved : {};
    const env: Record<string, string> = { ...(options.baseEnv ?? {}) };
    for (const [key, envName] of [["host", "DATA_AGENT_MYSQL_HOST"], ["port", "DATA_AGENT_MYSQL_PORT"], ["user", "DATA_AGENT_MYSQL_USER"], ["password", "DATA_AGENT_MYSQL_PASSWORD"], ["database", "DATA_AGENT_MYSQL_DATABASE"]] as const) {
      if (cfg[key] !== undefined && cfg[key] !== null) env[envName] = String(cfg[key]);
    }
    const nextKey = JSON.stringify(env);
    if (executor && executorKey === nextKey) return executor;
    if (executor) await executor.close();
    executor = createMcpQueryExecutor({ command: options.command, args: options.args, env });
    executorKey = nextKey;
    return executor;
  };

  return {
    run: (sql: string, rowLimit: number) => resolveExecutor().then((current) => current.run(sql, rowLimit)),
    async *stream(sql: string, signal?: AbortSignal) {
      yield* (await resolveExecutor()).stream(sql, signal);
    },
    async close(): Promise<void> {
      if (!executor) return;
      const current = executor;
      executor = undefined;
      executorKey = "";
      await current.close();
    },
  };
}

function mysqlMcpEnv(connection: Record<string, unknown>, baseEnv: Record<string, string> = {}): Record<string, string> {
  const env = { ...baseEnv };
  for (const [key, envName] of [["host", "DATA_AGENT_MYSQL_HOST"], ["port", "DATA_AGENT_MYSQL_PORT"], ["user", "DATA_AGENT_MYSQL_USER"], ["password", "DATA_AGENT_MYSQL_PASSWORD"], ["database", "DATA_AGENT_MYSQL_DATABASE"]] as const) {
    if (connection[key] !== undefined && connection[key] !== null) env[envName] = String(connection[key]);
  }
  return env;
}

function createElectronHostTesters(mcp: { command: string; args: string[]; baseEnv?: Record<string, string> }) {
  return {
    dbTester: {
      test: async (connection: Record<string, unknown>): Promise<{ success: boolean; message: string }> => {
        const host = String(connection.host ?? "127.0.0.1");
        const port = Number(connection.port ?? 3306);
        const database = connection.database ? String(connection.database) : undefined;
        const executor = createMcpQueryExecutor({ command: mcp.command, args: mcp.args, env: mysqlMcpEnv(connection, mcp.baseEnv) });
        try {
          await executor.run("SELECT 1 AS connection_ok", 1);
          return { success: true, message: `MySQL 连接成功（${host}:${port}${database ? `/ ${database}` : ""}）` };
        } catch (error) {
          return { success: false, message: `MySQL 连接失败: ${error instanceof Error ? error.message : String(error)}` };
        } finally {
          await executor.close().catch(() => undefined);
        }
      },
    },
    llmTester: { test: testLlmProfile },
  };
}

async function testLlmProfile(profile: Record<string, unknown>): Promise<{ success: boolean; message: string; details?: unknown }> {
  const provider = String(profile.provider ?? "openai");
  const apiKey = String(profile.api_key ?? profile.openai_api_key ?? profile.anthropic_api_key ?? "").trim();
  const model = String(profile.model ?? (provider === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-4o-mini"));
  if (!apiKey) return { success: false, message: "缺少 API Key" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    if (provider === "anthropic") {
      const baseUrl = String(profile.base_url ?? "https://api.anthropic.com").replace(/\/$/, "");
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
        signal: controller.signal,
      });
      if (response.ok) return { success: true, message: `Anthropic 连接成功（${model}）` };
      return { success: false, message: `Anthropic 校验失败 (HTTP ${response.status})`, details: (await response.text().catch(() => "")).slice(0, 300) };
    }
    const baseUrl = String(profile.base_url ?? profile.openai_base_url ?? "https://api.openai.com/v1").replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
      signal: controller.signal,
    });
    if (response.ok) return { success: true, message: `OpenAI 兼容接口连接成功（${model}）` };
    return { success: false, message: `OpenAI 兼容接口校验失败 (HTTP ${response.status})`, details: (await response.text().catch(() => "")).slice(0, 300) };
  } catch (error) {
    const reason = error instanceof Error ? (error.name === "AbortError" ? "请求超时（20s）" : error.message) : String(error);
    return { success: false, message: `模型服务连接失败: ${reason}` };
  } finally {
    clearTimeout(timer);
  }
}

async function runPackagedRendererSmoke(window: { webContents?: { executeJavaScript(script: string): Promise<unknown> } }): Promise<void> {
  if (!window.webContents) throw new Error("SMOKE_RENDERER_WEB_CONTENTS_MISSING");
  const result = await window.webContents.executeJavaScript(`
    (async () => {
      const invoke = window.dataAgentRuntime?.invokeRuntimeCommand;
      const subscribe = window.dataAgentRuntime?.subscribeRuntimeEvents;
      const upload = window.dataAgent?.uploadWorkspaceFile;
      if (!invoke || !subscribe || !upload) throw new Error("SMOKE_PRELOAD_BRIDGE_MISSING");
      const envelope = (requestId, command, sessionId) => ({ protocolVersion: 1, requestId, ...(sessionId ? { sessionId } : {}), command });
      const probe = await invoke(envelope("smoke-probe", { type: "runtime.probe" }));
      const config = await invoke(envelope("smoke-config", { type: "config.get" }));
      const artifact = await upload({ fileName: "smoke-renderer.txt", bytes: new Uint8Array([115, 109, 111, 107, 101]), sessionId: "smoke-session" });
      let unsubscribe = () => undefined;
      const completed = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { unsubscribe(); reject(new Error("SMOKE_CHAT_TIMEOUT")); }, 10000);
        unsubscribe = subscribe((event) => {
          if (event?.sessionId === "smoke-session" && event?.event?.type === "agent.completed") {
            clearTimeout(timer);
            unsubscribe();
            resolve(true);
          }
        }, "smoke-session");
      });
      const chat = await invoke(envelope("smoke-chat", { type: "agent.prompt", prompt: "smoke" }, "smoke-session"));
      await completed;
      return {
        probe: probe?.response?.type,
        config: config?.response?.type,
        artifact: artifact?.relative_path,
        chat: chat?.response?.type,
      };
    })()
  `);
  if (!isRecord(result)
    || result.probe !== "runtime.probe.result"
    || result.config !== "config.get.result"
    || result.artifact !== "smoke-renderer.txt"
    || result.chat !== "agent.prompt.accepted") {
    throw new Error(`SMOKE_RENDERER_SELF_TEST_FAILED: ${JSON.stringify(result)}`);
  }
}

export interface ElectronHostHandle {
  runtime: unknown;
  dispose(): Promise<void>;
}

export async function startElectronHost(deps: MainDeps, overrides: Partial<ElectronMainRuntimePaths> = {}): Promise<ElectronHostHandle> {
  deps.protocol?.registerSchemesAsPrivileged?.([{
    scheme: "data-agent",
    privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true },
  }]);
  const {
    DataAgentRuntime,
    MetadataStore,
    PiJsonlSessionStore,
    KnowledgeIndex,
    WorkspaceStore,
    createAgentHarnessResolver,
    createDataAgentHarness,
  } = await import("@data-agent/runtime");
  const { registerElectronRuntimeIpc } = await import("./index.js");

  const paths = resolveRuntimePaths({ userDataDir: deps.app.getPath("userData") });
  if (overrides.userDataDir) paths.userDataDir = overrides.userDataDir;
  if (overrides.rendererDist) paths.rendererDist = overrides.rendererDist;

  // Bundled Python runtime pack ships under extraResources; never fall back to
  // development paths inside the packaged application.
  const effectiveResources = overrides.resourcesPath ?? deps.resourcesPath;
  const bundledPython = path.join(effectiveResources ?? "", "python-runtime", "Scripts", "python.exe");
  const bundledPythonExecutable = effectiveResources && existsSync(bundledPython) ? bundledPython : undefined;
  let pythonExecutable = bundledPythonExecutable;

  for (const dir of ["metadata", "sessions", "workspace", "knowledge"]) {
    mkdirSync(path.join(paths.userDataDir, dir), { recursive: true });
  }

  const metadata = new MetadataStore(path.join(paths.userDataDir, "metadata", "app.db"));
  const sessions = new PiJsonlSessionStore(path.join(paths.userDataDir, "sessions"));
  const knowledgeRoot = path.join(paths.userDataDir, "knowledge");
  const workspace = new WorkspaceStore(path.join(paths.userDataDir, "workspace"), { userId: "local" });
  let knowledge: InstanceType<typeof KnowledgeIndex> | undefined;
  try {
    knowledge = new (KnowledgeIndex as unknown as new (root?: string) => InstanceType<typeof KnowledgeIndex>)(knowledgeRoot);
  } catch {
    knowledge = undefined;
  }

  const savedConfig = await metadata.getConfig("ui.settings");
  if (isRecord(savedConfig)) {
    const pythonConfig = savedConfig.python_runtime;
    if (isRecord(pythonConfig) && pythonConfig.mode === "external" && typeof pythonConfig.executable === "string" && pythonConfig.executable.trim()) {
      pythonExecutable = pythonConfig.executable;
    }
  }

  // Semantic sources live in a KTX project under the user data dir; the
  // runtime scans business-semantic/ and semantic-layer/ layouts there.
  // DATA_AGENT_SEMANTIC_PROJECT_DIR overrides (e.g. to reuse an existing project).
  const semanticProjectDir = process.env.DATA_AGENT_SEMANTIC_PROJECT_DIR
    ? path.resolve(process.env.DATA_AGENT_SEMANTIC_PROJECT_DIR)
    : path.join(paths.userDataDir, "semantic-context");
  const applicationRoot = path.dirname(paths.rendererDist);
  const developmentRoot = applicationRoot.includes(`${path.sep}app.asar`) ? applicationRoot : path.resolve(applicationRoot, "..");
  const packagedRoot = effectiveResources ?? applicationRoot;
  const runtime = new DataAgentRuntime({
    metadata,
    sessions,
    workspace,
    knowledgeRoot,
    knowledge,
    pythonExecutable,
    bundledPythonExecutable,
    semanticProjectDir,
    skillRoots: [path.join(developmentRoot, ".agents", "skills"), path.join(packagedRoot, ".agents", "skills")],
  });
  runtime.ingestJob = {
    async getStatus() {
      const { readdir } = await import("node:fs/promises");
      let count = 0;
      for (const segment of ["semantic-layer", "business-semantic"]) {
        try {
          const entries = await readdir(path.join(semanticProjectDir, segment), { recursive: true });
          count += entries.filter((entry) => entry.endsWith(".yaml") || entry.endsWith(".yml")).length;
        } catch {
          // A missing semantic project is a valid not-yet-configured state.
        }
      }
      return {
        status: count > 0 ? "ready" : "skipped",
        jobId: null,
        summary: { updated: 0, unchanged: count, failed: 0, skipped: 0 },
        errorCode: null,
      };
    },
    async retry() { return { accepted: true }; },
  };

  const mcpProcess = {
    command: process.execPath,
    args: [path.join(__dirname, "mcp-mysql.cjs")],
    baseEnv: { ELECTRON_RUN_AS_NODE: "1" },
  };
  const testers = createElectronHostTesters(mcpProcess);
  runtime.dbTester = testers.dbTester;
  runtime.llmTester = testers.llmTester;
  const queryExecutor = createElectronQueryExecutor(metadata, mcpProcess);
  runtime.queryExecutor = queryExecutor;
  const unregisterDesktopCapabilities = registerDesktopCapabilities(deps.ipcMain as DesktopIpcLike, {
    userDataDir: paths.userDataDir,
    safeStorage: deps.safeStorage,
    dialog: deps.dialog,
    autoUpdater: deps.autoUpdater,
    workspace,
  });
  const unregisterRuntimeIpc = registerElectronRuntimeIpc(deps.ipcMain as never, runtime);

  // Keep the Electron host composition identical to the Web Host: the
  // Runtime owns the protocol while a lazily refreshed native Pi Harness owns
  // model/tool execution. Missing onboarding config only affects the request,
  // not host startup.
  type HarnessLike = {
    prompt(text: string): Promise<unknown>;
    steer?(text: string): void;
    followUp?(text: string): void;
    abort(): void;
    subscribe?(listener: (event: unknown) => void): () => void;
    getResources?(): { skills?: unknown[]; promptTemplates?: unknown[] };
    setResources?(resources: { skills?: unknown[]; promptTemplates?: unknown[] }): Promise<void>;
  };
  let agentHarness: HarnessLike | undefined;
  const agentListeners = new Set<(event: unknown) => void>();
  const secretPath = path.join(paths.userDataDir, "secrets.json");
  const agentHarnessResolver = createAgentHarnessResolver({
    getProfile: async () => {
      const config = (await metadata.getConfig("ui.settings")) ?? {};
      const cfg = isRecord(config) ? config : {};
      const stored = readStoredSecrets(secretPath, deps.safeStorage);
      const provider = typeof cfg.provider === "string" && cfg.provider ? cfg.provider : (stored.anthropic_api_key ? "anthropic" : "openai");
      const apiKey = firstString(
        cfg.api_key,
        provider === "anthropic" ? cfg.anthropic_api_key : cfg.openai_api_key,
        stored.anthropic_api_key && provider === "anthropic" ? stored.anthropic_api_key : undefined,
        stored.openai_api_key && provider !== "anthropic" ? stored.openai_api_key : undefined,
      );
      const model = firstString(cfg.model, stored.default_model);
      const baseUrl = firstString(cfg.base_url, stored.openai_base_url);
      if (cfg.llm_enabled === false || !apiKey || !model) throw new Error("LLM_NOT_CONFIGURED: complete onboarding first");
      return { provider, model, apiKey, ...(baseUrl ? { baseUrl } : {}) };
    },
    create: async (profile, sessionId) => {
      const persistentSession = sessionId ? await sessions.openByAppSessionId(sessionId) : undefined;
      const harness = await createDataAgentHarness({
        workspace,
        knowledge,
        knowledgeRoot,
        pythonExecutable: () => runtime.pythonExecutablePath,
        queryExecutor,
        clarifications: runtime.clarificationManager,
        session: persistentSession,
        systemPromptRoots: [knowledgeRoot, developmentRoot, packagedRoot],
        projectRoot: developmentRoot,
        packagedRoot,
        toolContext: { sessionId },
      }, profile);
      for (const listener of agentListeners) harness.subscribe?.(listener);
      agentHarness = harness as unknown as HarnessLike;
      return harness;
    },
  });
  const resolveAgentHarness = (sessionId?: string) => agentHarnessResolver.resolve(sessionId);
  runtime.attachAgent({
    prompt: async (text, context) => (await resolveAgentHarness(context?.sessionId)).prompt(text),
    steer: (text, context) => { void resolveAgentHarness(context?.sessionId).then((agent) => agent.steer?.(text)); },
    followUp: (text, context) => { void resolveAgentHarness(context?.sessionId).then((agent) => agent.followUp?.(text)); },
    abort: () => { agentHarness?.abort(); },
    getResources: () => agentHarness?.getResources?.() ?? {},
    setResources: async (resources) => { if (agentHarness?.setResources) await agentHarness.setResources(resources); },
    subscribe: (listener) => {
      const forward = (event: unknown): void => { if (isRuntimeAgentEvent(event)) listener(event); };
      agentListeners.add(forward);
      return () => agentListeners.delete(forward);
    },
  });
  agentHarnessResolver.warmup((error) => console.warn("[data-agent-electron] agent warm-up unavailable:", error instanceof Error ? error.message : error));

  await deps.app.whenReady();
  const unregisterWorkspaceProtocol = await registerWorkspaceProtocol(deps.protocol, workspace);
  let disposed = false;
  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    agentHarness?.abort();
    unregisterWorkspaceProtocol();
    unregisterDesktopCapabilities();
    unregisterRuntimeIpc();
    await queryExecutor.close();
    await metadata.close();
  };
  const window = new deps.BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "..", "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const devServerUrl = process.env.DATA_AGENT_DEV_URL?.trim() || "http://localhost:5173";
  if (process.env.DATA_AGENT_DEV === "1" || process.argv.includes("--dev")) {
    await window.loadURL(devServerUrl);
  } else {
    await window.loadFile(path.join(paths.rendererDist, "index.html"));
  }
  if (process.env.DATA_AGENT_SMOKE === "1") {
    await runPackagedRendererSmoke(window);
    writeFileSync(path.join(paths.userDataDir, "smoke.ok"), "renderer-runtime-config-upload-chat");
  }
  return { runtime, dispose };
}

// This module is only loaded as an Electron main entry (tests import
// ./index.js directly), so starting unconditionally here is safe.
// Vitest imports this file for unit tests; never boot electron there.
if (process.env.VITEST !== "true" && process.env.NODE_ENV !== "test") void (async () => {
  try {
    const electronModule = "electron";
    const electron = (await import(/* @vite-ignore */ electronModule)) as never as MainDeps;
    if (electron.app.requestSingleInstanceLock?.() === false) {
      electron.app.quit();
      return;
    }
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    const smokeUserData = process.env.DATA_AGENT_SMOKE_DIR?.trim();
    const host = await startElectronHost(electron, { resourcesPath, ...(smokeUserData ? { userDataDir: smokeUserData } : {}) });
    if (process.env.DATA_AGENT_SMOKE === "1") {
      await host.dispose();
      electron.app.quit();
      return;
    }
    let quitting = false;
    electron.app.on?.("before-quit", (event) => {
      if (quitting) return;
      quitting = true;
      (event as { preventDefault?: () => void } | undefined)?.preventDefault?.();
      void host.dispose().finally(() => electron.app.quit());
    });
  } catch (error) {
    // GUI-subsystem processes have no console; persist the failure for diagnostics.
    try {
      const { appendFileSync } = await import("node:fs");
      appendFileSync(path.join(process.env.TEMP ?? process.cwd(), "data-agent-main-error.log"),
        `[${new Date().toISOString()}] electron host failed to start:\n${(error instanceof Error ? error.stack : String(error))}\n`);
    } catch {
      /* ignore */
    }
    console.error("electron host failed to start:", error);
    const electronModule2 = "electron";
    try {
      const { app: crashedApp } = (await import(/* @vite-ignore */ electronModule2)) as never;
      (crashedApp as { exit?: (code: number) => void }).exit?.(1);
    } catch { /* not in electron */ }
    process.exitCode = 1;
  }
})();
