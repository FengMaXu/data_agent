import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { parseDataAgentCommandEnvelope, type DataAgentCommandEnvelope, type DataAgentEventEnvelope, type RequestContext } from "@data-agent/contracts";
import { DataAgentRuntime, DataAgentRuntimeError, LocalAuthService, WorkspaceStore } from "@data-agent/runtime";

export interface RuntimeServerOptions {
  contextFactory?: (request: FastifyRequest) => RequestContext | Promise<RequestContext>;
  authService?: LocalAuthService;
  workspace?: WorkspaceStore;
  /** Injected MCP-backed executor for dashboard.evaluate; Runtime never touches business DBs directly. */
  queryExecutor?: { run(sql: string, rowLimit: number): Promise<{ columns: string[]; rows: unknown[][]; truncated: boolean }> };
}

export async function createRuntimeServer(
  runtime: DataAgentRuntime,
  options: RuntimeServerOptions = {},
): Promise<FastifyInstance> {
  if (options.queryExecutor) runtime.queryExecutor = options.queryExecutor;
  const app = Fastify({ logger: false });
  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } });
  const auth = options.authService ?? new LocalAuthService(runtime.metadataStore);
  const publicUser = (user: { id: string; username: string; displayName: string }) => ({ id: user.id, username: user.username, display_name: user.displayName });
  app.post("/auth/register", async (request, reply) => {
    const body = request.body as { username?: string; password?: string; displayName?: string; display_name?: string };
    try {
      await auth.register(body.username ?? "", body.password ?? "", body.displayName ?? body.display_name);
      const result = await auth.login(body.username ?? "", body.password ?? "");
      return { token: result.token, expires_at: 0, user: publicUser(result.user) };
    } catch (error) {
      const code = error instanceof Error && error.message === "AUTH_REGISTRATION_CLOSED" ? "AUTH_REGISTRATION_CLOSED" : "AUTH_REGISTRATION_FAILED";
      return reply.code(400).send({ error: { code } });
    }
  });
  app.post("/auth/login", async (request, reply) => {
    const body = request.body as { username?: string; password?: string };
    try {
      const result = await auth.login(body.username ?? "", body.password ?? "");
      return { token: result.token, expires_at: 0, user: publicUser(result.user) };
    } catch {
      return reply.code(401).send({ error: { code: "AUTH_INVALID_CREDENTIALS" } });
    }
  });
  app.get("/auth/status", async (request) => {
    const user = await auth.authenticate(requestToken(request));
    const registrationOpen = (await auth.userCount()) === 0;
    return { authenticated: Boolean(user), user: user ? publicUser(user) : null, registration_open: registrationOpen };
  });
  app.post("/auth/logout", async (request) => { await auth.logout(requestToken(request) ?? ""); return { ok: true }; });
  const contextFactory = options.contextFactory ?? (async (request: FastifyRequest): Promise<RequestContext> => {
    const user = await auth.authenticate(requestToken(request));
    if (!user) throw new Error("AUTH_REQUIRED");
    return { userId: user.id, host: "web" };
  });
  const resolveContext = async (request: FastifyRequest, reply: { code(statusCode: number): { send(payload: unknown): unknown } }): Promise<RequestContext | undefined> => {
    try {
      return await contextFactory(request);
    } catch {
      reply.code(401).send({ error: { code: "AUTH_REQUIRED" } });
      return undefined;
    }
  };
  if (options.workspace) {
    app.get("/api/workspace/download", async (request, reply) => {
      const context = await resolveContext(request, reply);
      if (!context) return;
      const query = request.query as { path?: string };
      try {
        options.workspace!.assertAccess(context);
        const workspacePath = query.path ?? "";
        const bytes = await options.workspace!.readBytesWithLegacyFallback(workspacePath);
        return reply.type(workspaceContentType(workspacePath)).send(Buffer.from(bytes));
      } catch {
        return reply.code(403).send({ error: { code: "WORKSPACE_ACCESS_DENIED" } });
      }
    });
    app.post("/api/workspace/upload", async (request, reply) => {
      const context = await resolveContext(request, reply);
      if (!context) return;
      try {
        options.workspace!.assertAccess(context);
        const part = await request.file();
        if (!part) return reply.code(400).send({ error: { code: "WORKSPACE_FILE_REQUIRED" } });
        const query = request.query as { session_id?: string };
        const targetWorkspace = query.session_id ? await options.workspace!.scoped(query.session_id) : options.workspace!;
        const tempDir = await mkdtemp(path.join(tmpdir(), "data-agent-upload-"));
        const tempPath = path.join(tempDir, "upload");
        try {
          await pipeline(part.file, createWriteStream(tempPath));
          const relativePath = safeUploadFileName(part.filename);
          const artifact = await targetWorkspace.upload(tempPath, relativePath);
          return { filename: relativePath, session_id: query.session_id ?? "", relative_path: relativePath, size: artifact.size };
        } finally {
          await rm(tempDir, { recursive: true, force: true });
        }
      } catch {
        return reply.code(400).send({ error: { code: "WORKSPACE_UPLOAD_FAILED" } });
      }
    });
  }

  app.get("/api/runtime/events", async (request, reply) => {
    const context = await resolveContext(request, reply);
    if (!context) return;
    const query = request.query as { session_id?: string; after_sequence?: string };
    const headerCursor = request.headers["last-event-id"];
    const rawCursor = query.after_sequence ?? (Array.isArray(headerCursor) ? headerCursor[0] : headerCursor);
    const hasCursor = typeof rawCursor === "string" && /^\d+$/.test(rawCursor);
    const afterSequence = parseEventCursor(rawCursor);
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    let replaying = true;
    let closed = false;
    const pending: DataAgentEventEnvelope[] = [];
    let unsubscribe: () => void = () => undefined;
    const send = (envelope: DataAgentEventEnvelope): void => {
      if (closed || (query.session_id && envelope.sessionId !== query.session_id)) return;
      try {
        reply.raw.write(`id: ${envelope.sequence}\ndata: ${JSON.stringify(envelope)}\n\n`);
      } catch {
        closed = true;
        unsubscribe();
      }
    };
    unsubscribe = runtime.subscribe((envelope) => {
      if (replaying) pending.push(envelope);
      else send(envelope);
    });
    if (hasCursor) {
      for (const envelope of runtime.eventsAfter(afterSequence)) send(envelope);
    }
    replaying = false;
    for (const envelope of pending) send(envelope);
    request.raw.on("close", () => { closed = true; unsubscribe(); });
  });

  app.post("/api/runtime/command", async (request, reply) => {
    const context = await resolveContext(request, reply);
    if (!context) return;
    try {
      const command: DataAgentCommandEnvelope = parseDataAgentCommandEnvelope(request.body);
      const effectiveContext = context.sessionId || !command.sessionId
        ? context
        : { ...context, sessionId: command.sessionId };
      return await runtime.dispatch(command, effectiveContext);
    } catch (error) {
      const runtimeError = toRuntimeError(error);
      return reply.code(400).send({
        error: {
          code: runtimeError.code,
          message: runtimeError.message,
        },
      });
    }
  });

  return app;
}

function safeUploadFileName(fileName: string): string {
  const name = path.posix.basename(fileName.replaceAll("\\", "/"));
  if (!name || name === "." || name === "..") throw new Error("WORKSPACE_FILE_REQUIRED");
  return name;
}

function workspaceContentType(relativePath: string): string {
  const extension = path.extname(relativePath).toLowerCase();
  return ({
    ".csv": "text/csv; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".log": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
  } as Record<string, string>)[extension] ?? "application/octet-stream";
}

function requestToken(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization;
  const value = Array.isArray(authorization) ? authorization[0] : authorization;
  const match = typeof value === "string" ? /^Bearer\s+(.+)$/i.exec(value.trim()) : null;
  return match?.[1];
}

function parseEventCursor(value: unknown): number {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : 0;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function toRuntimeError(error: unknown): DataAgentRuntimeError {
  if (error instanceof DataAgentRuntimeError) return error;
  if (error instanceof TypeError) {
    return new DataAgentRuntimeError("INVALID_COMMAND", error.message);
  }
  if (process.env.DATA_AGENT_DEBUG_ERRORS === "1") console.error("[data-agent] command failed:", error);
  return new DataAgentRuntimeError("INVALID_COMMAND", "DataAgent command failed");
}
