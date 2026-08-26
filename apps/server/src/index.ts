import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { parseDataAgentCommandEnvelope, type DataAgentCommandEnvelope, type RequestContext } from "@data-agent/contracts";
import { DataAgentRuntime, DataAgentRuntimeError, LocalAuthService, WorkspaceStore } from "@data-agent/runtime";

export interface RuntimeServerOptions {
  contextFactory?: (request: FastifyRequest) => RequestContext;
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
  const auth = new LocalAuthService(runtime.metadataStore);
  app.post("/auth/register", async (request, reply) => { const body = request.body as { username?: string; password?: string; displayName?: string }; try { return { user: await auth.register(body.username ?? "", body.password ?? "", body.displayName) }; } catch (error) { const code = error instanceof Error && error.message === "AUTH_REGISTRATION_CLOSED" ? "AUTH_REGISTRATION_CLOSED" : "AUTH_REGISTRATION_FAILED"; return reply.code(400).send({ error: { code } }); } });
  app.post("/auth/login", async (request, reply) => { const body = request.body as { username?: string; password?: string }; try { return await auth.login(body.username ?? "", body.password ?? ""); } catch { return reply.code(401).send({ error: { code: "AUTH_INVALID_CREDENTIALS" } }); } });
  app.get("/auth/status", async (request) => { const user = await auth.authenticate(String(request.headers.authorization ?? "").replace(/^Bearer /i, "")); const registrationOpen = (await auth.userCount()) === 0; return { authenticated: Boolean(user), user: user ?? null, registration_open: registrationOpen }; });
  app.post("/auth/logout", async (request) => { const token = String(request.headers.authorization ?? "").replace(/^Bearer /i, ""); await auth.logout(token); return { ok: true }; });
  const contextFactory = options.contextFactory ?? (() => ({ userId: "web-dev", host: "web" as const }));
  if (options.workspace) {
    app.get("/api/workspace/download", async (request, reply) => { const query = request.query as { path?: string }; try { const context = contextFactory(request); options.workspace!.assertAccess(context); return reply.type("text/plain").send(await options.workspace!.read(query.path ?? "")); } catch { return reply.code(403).send({ error: { code: "WORKSPACE_ACCESS_DENIED" } }); } });
    app.post("/api/workspace/upload", async (request, reply) => { const context = contextFactory(request); try { options.workspace!.assertAccess(context); const part = await request.file(); if (!part) return reply.code(400).send({ error: { code: "WORKSPACE_FILE_REQUIRED" } }); const tempDir = await mkdtemp(path.join(tmpdir(), "data-agent-upload-")); const tempPath = path.join(tempDir, "upload"); await pipeline(part.file, createWriteStream(tempPath)); const artifact = await options.workspace!.upload(tempPath, part.filename); await rm(tempDir, { recursive: true, force: true }); return { artifact }; } catch { return reply.code(400).send({ error: { code: "WORKSPACE_UPLOAD_FAILED" } }); } });
  }

  app.get("/api/runtime/events", async (request, reply) => {
    const query = request.query as { session_id?: string };
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const unsubscribe = runtime.subscribe((envelope) => {
      if (query.session_id && envelope.sessionId !== query.session_id) return;
      try { reply.raw.write(`data: ${JSON.stringify(envelope)}

`); } catch { unsubscribe(); }
    });
    request.raw.on("close", () => { unsubscribe(); });
  });

  app.post("/api/runtime/command", async (request, reply) => {
    try {
      const command: DataAgentCommandEnvelope = parseDataAgentCommandEnvelope(request.body);
      const context: RequestContext = contextFactory(request);
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

function toRuntimeError(error: unknown): DataAgentRuntimeError {
  if (error instanceof DataAgentRuntimeError) return error;
  if (error instanceof TypeError) {
    return new DataAgentRuntimeError("INVALID_COMMAND", error.message);
  }
  if (process.env.DATA_AGENT_DEBUG_ERRORS === "1") console.error("[data-agent] command failed:", error);
  return new DataAgentRuntimeError("INVALID_COMMAND", "DataAgent command failed");
}
