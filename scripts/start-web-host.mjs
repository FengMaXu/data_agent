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
const runtime = new DataAgentRuntime({ metadata, sessions, knowledgeRoot, knowledge, workspace, semanticProjectDir });

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
