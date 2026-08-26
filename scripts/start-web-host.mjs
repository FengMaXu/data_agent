#!/usr/bin/env node
/**
 * Production launcher for the Fastify Web Host.
 *
 * Composes the shared DataAgentRuntime with per-instance directories and
 * starts listening. Configuration via environment variables:
 *
 *   DATA_AGENT_PORT              HTTP port                (default 8787)
 *   DATA_AGENT_HOST              bind address             (default 127.0.0.1)
 *   DATA_AGENT_DATA_DIR          per-user data root       (default ./.data_agent/runtime)
 *   DATA_AGENT_SEMANTIC_PROJECT_DIR  KTX project dir      (default <data dir>/../semantic-context)
 *   DATA_AGENT_WEB_DIST          renderer static root     (default frontend/dist, served at /)
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const root = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const toUrl = (p) => { const u = p.split(path.sep).join("/"); return u.startsWith("/") ? `file://${u}` : `file:///${u}`; };

// Stable default so accounts, config and knowledge survive restarts.
const dataDir = process.env.DATA_AGENT_DATA_DIR
  ? path.resolve(process.env.DATA_AGENT_DATA_DIR)
  : path.join(root, ".data_agent", "runtime-web");

const { DataAgentRuntime, MetadataStore, PiJsonlSessionStore, KnowledgeIndex, WorkspaceStore } = await import(toUrl(path.join(root, "packages/runtime/dist/index.js")));
const { createRuntimeServer } = await import(toUrl(path.join(root, "apps/server/dist/index.js")));

const fsPromises = await import("node:fs/promises");
await fsPromises.mkdir(dataDir, { recursive: true });
await fsPromises.mkdir(path.join(dataDir, "metadata"), { recursive: true });
await fsPromises.mkdir(path.join(dataDir, "sessions"), { recursive: true });
await fsPromises.mkdir(path.join(dataDir, "workspace"), { recursive: true });
const metadata = new MetadataStore(path.join(dataDir, "metadata", "app.db"));
const sessions = new PiJsonlSessionStore(path.join(dataDir, "sessions"));
const knowledgeRoot = path.join(dataDir, "knowledge");
await fsPromises.mkdir(knowledgeRoot, { recursive: true });
let knowledge;
try { knowledge = new KnowledgeIndex(knowledgeRoot); } catch { knowledge = undefined; }

// Semantic sources: KTX project dir (business-semantic/ + semantic-layer/ layouts).
const semanticProjectDir = process.env.DATA_AGENT_SEMANTIC_PROJECT_DIR
  ? path.resolve(process.env.DATA_AGENT_SEMANTIC_PROJECT_DIR)
  : path.resolve(dataDir, "..", "semantic-context");

const workspace = new WorkspaceStore(path.join(dataDir, "workspace"), { userId: "local", sessionId: undefined });
const runtime = new DataAgentRuntime({ metadata, sessions, knowledgeRoot, knowledge, workspace, semanticProjectDir, skillRoots: [path.join(root, ".agents", "skills"), path.join(process.resourcesPath ?? root, ".agents", "skills")] });

// Real db/llm probes so onboarding and the settings testers work over HTTP.
const { createHostTesters } = await import(toUrl(path.join(root, "apps/server/dist/host-testers.js")));
Object.assign(runtime, createHostTesters());

// Ingest status port for semantic context readiness
runtime.ingestJob = {
  async getStatus() {
    let count = 0;
    try {
      const candidates = ["semantic-layer", "business-semantic"];
      for (const seg of candidates) {
        const segDir = path.join(semanticProjectDir, seg);
        if (existsSync(segDir)) {
          const entries = await fsPromises.readdir(segDir, { recursive: true });
          count += entries.filter((f) => String(f).endsWith(".yaml") || String(f).endsWith(".yml")).length;
        }
      }
    } catch {
      count = 0;
    }
    return {
      status: count > 0 ? "ready" : "skipped",
      jobId: null,
      summary: { updated: 0, unchanged: count, failed: 0, skipped: 0 },
      errorCode: null,
    };
  },
  async retry() {
    return { accepted: true };
  },
};

// Dashboard evaluate and agent query_database flow through the contract MCP
// database server; connection details come from the saved db config.
const { createMcpQueryExecutor } = await import(toUrl(path.join(root, "apps/server/dist/mcp-query-executor.js")));
function mysqlEnvFromConfig(cfg) {
  const env = {};
  if (!cfg) return env;
  if (cfg.host) env.DATA_AGENT_MYSQL_HOST = String(cfg.host);
  if (cfg.port) env.DATA_AGENT_MYSQL_PORT = String(cfg.port);
  if (cfg.user) env.DATA_AGENT_MYSQL_USER = String(cfg.user);
  if (cfg.password) env.DATA_AGENT_MYSQL_PASSWORD = String(cfg.password);
  if (cfg.database) env.DATA_AGENT_MYSQL_DATABASE = String(cfg.database);
  return env;
}
let queryExecutor; let queryExecutorEnvKey = "";
async function resolveQueryExecutor() {
  const cfg = (await metadata.getConfig("ui.settings")) ?? {};
  const env = mysqlEnvFromConfig(cfg);
  const key = JSON.stringify(env);
  if (!queryExecutor || key !== queryExecutorEnvKey) {
    queryExecutor = createMcpQueryExecutor({ command: process.execPath, args: [path.join(root, "packages", "mcp-mysql", "dist", "cli.js")], env: Object.keys(env).length ? env : undefined });
    runtime.queryExecutor = queryExecutor;
    queryExecutorEnvKey = key;
  }
  return queryExecutor;
}
resolveQueryExecutor().catch((error) => console.warn("[data-agent-web] mcp query executor unavailable:", error.message));


// Lazy Pi agent: (re)built from the latest saved LLM config on first chat use.
const pythonExecutable = process.env.DATA_AGENT_PYTHON
  ?? (existsSync(path.join(root, "dist", "python-runtime", "Scripts", "python.exe")) ? path.join(root, "dist", "python-runtime", "Scripts", "python.exe") : undefined);
let agentHarness; let agentProfileKey = "";
const agentListeners = new Set();
async function resolveAgentHarness() {
  const cfg = (await metadata.getConfig("ui.settings")) ?? {};
  const profile = {
    provider: String(cfg.provider ?? "openai"),
    model: String(cfg.model ?? ""),
    apiKey: String(cfg.api_key ?? cfg.openai_api_key ?? cfg.anthropic_api_key ?? ""),
    baseUrl: cfg.base_url ? String(cfg.base_url) : undefined,
  };
  if (!profile.apiKey || !profile.model) throw new Error("LLM_NOT_CONFIGURED: complete onboarding first");
  const key = JSON.stringify(profile);
  if (!agentHarness || key !== agentProfileKey) {
    const { createDataAgentHarness } = await import(toUrl(path.join(root, "packages/runtime/dist/index.js")));
    agentHarness = await createDataAgentHarness({ workspace, knowledge, knowledgeRoot, pythonExecutable, queryExecutor: await resolveQueryExecutor(), clarifications: runtime.clarifications, systemPromptRoots: [knowledgeRoot, root], projectRoot: root, packagedRoot: process.resourcesPath ?? root }, profile);
    for (const listener of agentListeners) agentHarness.subscribe(listener);
    agentProfileKey = key;
    console.log(`[data-agent-web] agent ready: ${profile.provider}/${profile.model}`);
  }
  return agentHarness;
}
runtime.attachAgent({
  prompt: async (text) => (await resolveAgentHarness()).prompt(text),
  steer: async (text) => (await resolveAgentHarness())?.steer(text),
  followUp: async (text) => (await resolveAgentHarness())?.followUp(text),
  abort: async () => agentHarness?.abort(),
  getResources: () => agentHarness?.getResources() ?? {},
  setResources: async (resources) => { if (agentHarness) await agentHarness.setResources(resources); },
  subscribe: (listener) => { agentListeners.add(listener); return () => agentListeners.delete(listener); },
});

const app = await createRuntimeServer(runtime);

// Serve the built renderer when available so one process fronts the whole app.
const webDist = process.env.DATA_AGENT_WEB_DIST ? path.resolve(process.env.DATA_AGENT_WEB_DIST) : path.join(root, "frontend", "dist");
if (existsSync(path.join(webDist, "index.html"))) {
  const fastifyStatic = await import("@fastify/static").then((m) => m.default).catch(() => null);
  if (fastifyStatic) {
    // wildcard (default) so hashed /assets/* files are served as files; API
    // routes are registered before this and keep precedence.
    await app.register(fastifyStatic, { root: webDist, prefix: "/" });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/") || request.method !== "GET") {
        return reply.code(404).send({ error: { code: "NOT_FOUND" } });
      }
      return reply.sendFile("index.html");
    });
  } else {
    console.warn("[data-agent-web] @fastify/static not installed; renderer not served");
  }
}

const port = Number(process.env.DATA_AGENT_PORT ?? 8787);
const host = process.env.DATA_AGENT_HOST ?? "127.0.0.1";
await app.listen({ port, host });
console.log(`[data-agent-web] listening on http://${host}:${port}`);
console.log(`[data-agent-web] data dir: ${dataDir}`);
console.log(`[data-agent-web] semantic project dir: ${semanticProjectDir}${existsSync(semanticProjectDir) ? "" : " (not created yet)"}`);
