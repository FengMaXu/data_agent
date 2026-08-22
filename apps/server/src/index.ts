import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { parseDataAgentCommandEnvelope, type RequestContext } from "@data-agent/contracts";
import { DataAgentRuntime, DataAgentRuntimeError, LocalAuthService, WorkspaceStore } from "@data-agent/runtime";

export interface RuntimeServerOptions {
  contextFactory?: (request: FastifyRequest) => RequestContext;
  workspace?: WorkspaceStore;
}

export async function createRuntimeServer(
  runtime: DataAgentRuntime,
  options: RuntimeServerOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const auth = new LocalAuthService();
  app.post("/auth/register", async (request, reply) => { const body = request.body as { username?: string; password?: string; displayName?: string }; try { return { user: auth.register(body.username ?? "", body.password ?? "", body.displayName) }; } catch { return reply.code(400).send({ error: { code: "AUTH_REGISTRATION_FAILED" } }); } });
  app.post("/auth/login", async (request, reply) => { const body = request.body as { username?: string; password?: string }; try { return auth.login(body.username ?? "", body.password ?? ""); } catch { return reply.code(401).send({ error: { code: "AUTH_INVALID_CREDENTIALS" } }); } });
  app.post("/auth/logout", async (request) => { const token = String(request.headers.authorization ?? "").replace(/^Bearer /i, ""); auth.logout(token); return { ok: true }; });
  const contextFactory = options.contextFactory ?? (() => ({ userId: "web-dev", host: "web" as const }));
  if (options.workspace) app.get("/api/workspace/download", async (request, reply) => { const query = request.query as { path?: string }; try { const context = contextFactory(request); options.workspace!.assertAccess(context); return reply.type("text/plain").send(await options.workspace!.read(query.path ?? "")); } catch { return reply.code(403).send({ error: { code: "WORKSPACE_ACCESS_DENIED" } }); } });

  app.post("/api/runtime/command", async (request, reply) => {
    try {
      const command = parseDataAgentCommandEnvelope(request.body);
      return await runtime.dispatch(command, contextFactory(request));
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
  return new DataAgentRuntimeError("INVALID_COMMAND", "DataAgent command failed");
}
