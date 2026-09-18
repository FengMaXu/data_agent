#!/usr/bin/env node
/** Production launcher for the Fastify Web Host. */
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const toUrl = (value) => { const normalized = value.split(path.sep).join("/"); return normalized.startsWith("/") ? `file://${normalized}` : `file:///${normalized}`; };
const dataDir = process.env.DATA_AGENT_DATA_DIR
  ? path.resolve(process.env.DATA_AGENT_DATA_DIR)
  : path.join(root, ".data_agent", "runtime-web");
const knowledgeRoot = path.join(dataDir, "knowledge");
const semanticProjectDir = process.env.DATA_AGENT_SEMANTIC_PROJECT_DIR
  ? path.resolve(process.env.DATA_AGENT_SEMANTIC_PROJECT_DIR)
  : path.resolve(dataDir, "..", "semantic-context");
const packagedRoot = process.resourcesPath ?? root;
const skillRoots = [path.join(root, ".agents", "skills"), path.join(packagedRoot, ".agents", "skills")];
const pythonExecutable = process.env.DATA_AGENT_PYTHON
  ?? (existsSync(path.join(root, "dist", "python-runtime", "Scripts", "python.exe")) ? path.join(root, "dist", "python-runtime", "Scripts", "python.exe") : undefined);

const { createDataAgentApplication } = await import(toUrl(path.join(root, "packages/runtime/dist/index.js")));
const { createRuntimeServer } = await import(toUrl(path.join(root, "apps/server/dist/index.js")));
const { createMcpQueryExecutor } = await import(toUrl(path.join(root, "apps/server/dist/mcp-query-executor.js")));
const { createHostTesters } = await import(toUrl(path.join(root, "apps/server/dist/host-testers.js")));

const mysqlMcpProcess = {
  command: process.execPath,
  args: [path.join(root, "packages", "mcp-mysql", "dist", "cli.js")],
};
function mysqlEnvFromConfig(config) {
  const env = {};
  if (!config) return env;
  if (config.host) env.DATA_AGENT_MYSQL_HOST = String(config.host);
  if (config.port) env.DATA_AGENT_MYSQL_PORT = String(config.port);
  if (config.user) env.DATA_AGENT_MYSQL_USER = String(config.user);
  if (config.password) env.DATA_AGENT_MYSQL_PASSWORD = String(config.password);
  if (config.database) env.DATA_AGENT_MYSQL_DATABASE = String(config.database);
  return env;
}

let application;
let queryExecutor;
let queryExecutorEnvKey = "";
async function resolveQueryExecutor() {
  const saved = (await application.getConfig("ui.settings")) ?? {};
  const env = mysqlEnvFromConfig(saved);
  const key = JSON.stringify(env);
  if (!queryExecutor || key !== queryExecutorEnvKey) {
    await queryExecutor?.close?.();
    queryExecutor = createMcpQueryExecutor({
      ...mysqlMcpProcess,
      env: Object.keys(env).length ? env : undefined,
    });
    queryExecutorEnvKey = key;
  }
  return queryExecutor;
}

application = await createDataAgentApplication({
  dataRoot: dataDir,
  host: "web",
  knowledgeRoot,
  semanticProjectDir,
  pythonExecutable,
  queryExecutor: resolveQueryExecutor,
  ...(process.env.TYPESAFE_API_KEY?.trim() ? {
    jevHypothesisComparison: {
      apiKey: process.env.TYPESAFE_API_KEY.trim(),
      model: process.env.TYPESAFE_MODEL?.trim() || "jev-1.13.0",
      ...(process.env.TYPESAFE_ENDPOINT?.trim() ? { endpoint: process.env.TYPESAFE_ENDPOINT.trim() } : {}),
    },
  } : {}),
  // Enable bounded reviewer and authorized knowledge exploration. SQL exploration
  // remains unavailable until the host supplies a database-enforced scoped executor.
  enableSubagents: true,
  delegationKnowledgePaths: ["doc/semantic_guide.md", "doc/rules.md", "doc/business.md", "doc/learning.md"],
  resolveProfile: async (_context, app) => {
    const saved = (await app.getConfig("ui.settings")) ?? {};
    const config = saved && typeof saved === "object" ? saved : {};
    const profile = {
      provider: String(config.provider ?? "openai"),
      model: String(config.model ?? ""),
      apiKey: String(config.api_key ?? config.openai_api_key ?? config.anthropic_api_key ?? ""),
      ...(config.base_url ? { baseUrl: String(config.base_url) } : {}),
      apiFormat: config.api_format === "chat" || config.apiFormat === "chat" ? "chat" : "responses",
    };
    if (config.llm_enabled === false || !profile.apiKey || !profile.model) throw new Error("LLM_NOT_CONFIGURED: complete onboarding first");
    return profile;
  },
  systemPromptRoots: [knowledgeRoot, root],
  projectRoot: root,
  packagedRoot,
  skillRoots,
});
application.setHostTesters(createHostTesters({ dbMcp: mysqlMcpProcess }));
application.setIngestJob({
  async getStatus() {
    let count = 0;
    try {
      const fsPromises = await import("node:fs/promises");
      for (const segment of ["semantic-layer", "business-semantic"]) {
        const directory = path.join(semanticProjectDir, segment);
        if (!existsSync(directory)) continue;
        const entries = await fsPromises.readdir(directory, { recursive: true });
        count += entries.filter((entry) => String(entry).endsWith(".yaml") || String(entry).endsWith(".yml")).length;
      }
    } catch { count = 0; }
    return { status: count > 0 ? "ready" : "skipped", jobId: null, summary: { updated: 0, unchanged: count, failed: 0, skipped: 0 }, errorCode: null };
  },
  async retry() { return { accepted: true }; },
});
resolveQueryExecutor().catch((error) => console.warn("[data-agent-web] mcp query executor unavailable:", error.message));

const app = await createRuntimeServer(application, {
  workspace: application.workspace,
  publicationReader: application,
  authorizeSession: async (userId, sessionId) => (await application.authorizeSession(userId, sessionId)) === "owned",
});

const webDist = process.env.DATA_AGENT_WEB_DIST ? path.resolve(process.env.DATA_AGENT_WEB_DIST) : path.join(root, "frontend", "dist");
app.get("/app/", async (_request, reply) => reply.redirect("/app"));
if (existsSync(path.join(webDist, "index.html"))) {
  const fastifyStatic = await import("@fastify/static").then((module) => module.default).catch(() => null);
  if (fastifyStatic) {
    await app.register(fastifyStatic, { root: webDist, prefix: "/" });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/") || request.method !== "GET") return reply.code(404).send({ error: { code: "NOT_FOUND" } });
      return reply.sendFile("index.html");
    });
  } else console.warn("[data-agent-web] @fastify/static not installed; renderer not served");
}

const port = Number(process.env.DATA_AGENT_PORT ?? 8787);
const host = process.env.DATA_AGENT_HOST ?? "127.0.0.1";
await app.listen({ port, host });
console.log(`[data-agent-web] listening on http://${host}:${port}`);
console.log(`[data-agent-web] data dir: ${dataDir}`);
console.log(`[data-agent-web] semantic project dir: ${semanticProjectDir}${existsSync(semanticProjectDir) ? "" : " (not created yet)"}`);
