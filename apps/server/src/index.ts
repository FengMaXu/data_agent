import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { parseDataAgentCommandEnvelope, type RequestContext } from "@data-agent/contracts";
import { DataAgentRuntime, DataAgentRuntimeError } from "@data-agent/runtime";

export interface RuntimeServerOptions {
  contextFactory?: (request: FastifyRequest) => RequestContext;
}

export async function createRuntimeServer(
  runtime: DataAgentRuntime,
  options: RuntimeServerOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const contextFactory = options.contextFactory ?? (() => ({ userId: "web-dev", host: "web" as const }));

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
