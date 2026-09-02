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

const { DataAgentRuntime, MetadataStore, PiJsonlSessionStore, KnowledgeIndex, WorkspaceStore, createAgentHarnessResolver, createProfileConversationBlindReviewer, createProfileAnswerSpecGenerator, createQueryAssurance, createSqlglotQueryDigestCompiler, resolveQueryDigestParserVersion, CONVERSATION_BLIND_REVIEWER_PROMPT_VERSION, REVIEW_COVERAGE_SCHEMA_VERSION, QUERY_DIGEST_VERSION, DETERMINISTIC_GATE_NAMES, calibrationRecordFromReports, ReviewModeController } = await import(toUrl(path.join(root, "packages/runtime/dist/index.js")));
const { createRuntimeServer } = await import(toUrl(path.join(root, "apps/server/dist/index.js")));

const fsPromises = await import("node:fs/promises");
await fsPromises.mkdir(dataDir, { recursive: true });
await fsPromises.mkdir(path.join(dataDir, "metadata"), { recursive: true });
await fsPromises.mkdir(path.join(dataDir, "sessions"), { recursive: true });
await fsPromises.mkdir(path.join(dataDir, "workspace"), { recursive: true });
const metadata = new MetadataStore(path.join(dataDir, "metadata", "app.db"));
const initialSettings = await metadata.getConfig("ui.settings");
const initialConfig = initialSettings && typeof initialSettings === "object" && !Array.isArray(initialSettings) ? initialSettings : {};
const configuredReviewerModel = typeof initialConfig.model === "string" && initialConfig.model.trim() ? initialConfig.model.trim() : "unconfigured";
const reviewerAvailableForConfig = (config) => {
  const model = typeof config?.model === "string" ? config.model.trim() : "";
  const apiKey = String(config?.api_key ?? config?.openai_api_key ?? config?.anthropic_api_key ?? "").trim();
  return config?.llm_enabled !== false && Boolean(apiKey) && Boolean(model);
};
const configuredReviewerAvailable = reviewerAvailableForConfig(initialConfig);
const sessions = new PiJsonlSessionStore(path.join(dataDir, "sessions"));
const knowledgeRoot = path.join(dataDir, "knowledge");
await fsPromises.mkdir(knowledgeRoot, { recursive: true });
let knowledge;
try {
  knowledge = new KnowledgeIndex(knowledgeRoot);
  await knowledge.loadDirectory(knowledgeRoot);
} catch { knowledge = undefined; }

// Semantic sources: KTX project dir (business-semantic/ + semantic-layer/ layouts).
const semanticProjectDir = process.env.DATA_AGENT_SEMANTIC_PROJECT_DIR
  ? path.resolve(process.env.DATA_AGENT_SEMANTIC_PROJECT_DIR)
  : path.resolve(dataDir, "..", "semantic-context");

const workspace = new WorkspaceStore(path.join(dataDir, "workspace"));
const runtime = new DataAgentRuntime({ metadata, sessions, knowledgeRoot, knowledge, workspace, semanticProjectDir, skillRoots: [path.join(root, ".agents", "skills"), path.join(process.resourcesPath ?? root, ".agents", "skills")] });
const requestedAssuranceMode = process.env.DATA_AGENT_QUERY_ASSURANCE_MODE;
const reviewer = {
  review: async (input, signal) => {
    const profile = await configuredProfile();
    const key = JSON.stringify([profile.provider, profile.model, profile.baseUrl, profile.apiFormat]);
    if (!reviewer.cache || reviewer.cache.key !== key) reviewer.cache = { key, instance: createProfileConversationBlindReviewer(profile) };
    return reviewer.cache.instance.review(input, signal);
  },
  cache: undefined,
};
async function configuredProfile() {
  const saved = (await metadata.getConfig("ui.settings")) ?? {};
  const cfg = saved && typeof saved === "object" ? saved : {};
  const profile = {
    provider: String(cfg.provider ?? "openai"),
    model: String(cfg.model ?? ""),
    apiKey: String(cfg.api_key ?? cfg.openai_api_key ?? cfg.anthropic_api_key ?? ""),
    ...(cfg.base_url ? { baseUrl: String(cfg.base_url) } : {}),
    apiFormat: cfg.api_format === "chat" || cfg.apiFormat === "chat" ? "chat" : "responses",
  };
  if (cfg.llm_enabled === false || !profile.apiKey || !profile.model) throw new Error("LLM_NOT_CONFIGURED: complete onboarding first");
  return profile;
}
let plannerCache;
const planner = {
  generate: async (input, signal) => {
    const profile = await configuredProfile();
    const key = JSON.stringify([profile.provider, profile.model, profile.baseUrl, profile.apiFormat]);
    if (!plannerCache || plannerCache.key !== key) plannerCache = { key, instance: createProfileAnswerSpecGenerator(profile) };
    return plannerCache.instance.generate(input, signal);
  },
};
// Raw categorical rows are opt-in because they may contain personal data. The
// same policy is passed to preview and export paths so review behavior is
// consistent; default remains numeric-only evidence.
const reviewEvidence = { includeRows: process.env.DATA_AGENT_QUERY_ASSURANCE_INCLUDE_ROWS === "1" };
// Use the same managed Python capability for strict Query Digest parsing and
// plotting. An absent or incomplete package fails closed in the coordinator.
const pythonExecutable = process.env.DATA_AGENT_PYTHON
  ?? (existsSync(path.join(root, "dist", "python-runtime", "Scripts", "python.exe")) ? path.join(root, "dist", "python-runtime", "Scripts", "python.exe") : undefined);
const sqlglotExecutable = process.env.DATA_AGENT_SQLGLOT_EXECUTABLE ?? pythonExecutable;
const digestCompiler = sqlglotExecutable ? createSqlglotQueryDigestCompiler({ executable: sqlglotExecutable }) : undefined;
const digestParserVersion = resolveQueryDigestParserVersion(digestCompiler, "mysql");
const effectiveRequestedAssuranceMode = requestedAssuranceMode === "off" || requestedAssuranceMode === "enforce" || requestedAssuranceMode === "shadow" ? requestedAssuranceMode : "shadow";
const calibrationIdentity = {
  reviewerModel: configuredReviewerModel,
  reviewerPromptVersion: CONVERSATION_BLIND_REVIEWER_PROMPT_VERSION,
  queryDigestVersion: QUERY_DIGEST_VERSION,
  parserVersion: digestParserVersion,
  reviewCoverageSchemaVersion: REVIEW_COVERAGE_SCHEMA_VERSION,
  reviewPolicyVersion: "2",
  hardConstraintAdmissionPolicy: "2",
  gatePolicyVersion: "1",
  gateApplicabilityVersion: "1",
  probeTemplateVersion: "1",
  evidenceAdmissionPolicyVersion: "1",
  dialect: "mysql",
};
let trustedCalibration;
try {
  trustedCalibration = Array.isArray(initialConfig.query_assurance_calibration?.reports)
    ? calibrationRecordFromReports(calibrationIdentity, initialConfig.query_assurance_calibration.reports, initialConfig.query_assurance_calibration.reviewerCalibration)
    : undefined;
} catch {
  trustedCalibration = undefined;
}
const modeController = new ReviewModeController({
  requestedMode: effectiveRequestedAssuranceMode,
  // The reviewer is lazy and reports provider/configuration failures as
  // Review Unavailable. Calibration is the separate gate for Enforce.
  reviewerAvailable: configuredReviewerAvailable,
  requiredGateNames: DETERMINISTIC_GATE_NAMES,
  ...(trustedCalibration ? { calibration: trustedCalibration } : {}),
});
// The web UI completes onboarding through runtime config.save after this
// controller is constructed. Keep the capability state synchronized so a
// startup Off state does not survive successful onboarding.
runtime.onConfigSaved = (config) => {
  modeController.setReviewerAvailable(reviewerAvailableForConfig(config));
};
const queryAssurance = createQueryAssurance({
  mode: effectiveRequestedAssuranceMode,
  modeController,
  reviewer,
  ...(digestCompiler ? { digestCompiler } : {}),
  ...(effectiveRequestedAssuranceMode !== "off" && process.env.DATA_AGENT_QUERY_ASSURANCE_PLANNER !== "0" ? { specGenerator: planner } : {}),
  reviewerModel: configuredReviewerModel,
  reviewerPromptVersion: CONVERSATION_BLIND_REVIEWER_PROMPT_VERSION,
  reviewCoverageSchemaVersion: REVIEW_COVERAGE_SCHEMA_VERSION,
  gatePolicyVersion: "1",
  gateApplicabilityVersion: "1",
  probeTemplateVersion: "1",
  evidenceAdmissionPolicyVersion: "1",
  parserVersion: digestParserVersion,
  dialect: "mysql",
  statePath: path.join(dataDir, "metadata", "query-assurance-state.json"),
  reviewEvidence,
  shadowDelivery: process.env.DATA_AGENT_QUERY_ASSURANCE_SHADOW_DELIVERY === "record_only" ? "record_only" : "publish_with_disagreement",
  allowUnavailablePublication: false,
});

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
const mysqlMcpProcess = {
  command: process.execPath,
  args: [path.join(root, "packages", "mcp-mysql", "dist", "cli.js")],
};
const { createHostTesters } = await import(toUrl(path.join(root, "apps/server/dist/host-testers.js")));
Object.assign(runtime, createHostTesters({ dbMcp: mysqlMcpProcess }));
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
    queryExecutor = createMcpQueryExecutor({ ...mysqlMcpProcess, env: Object.keys(env).length ? env : undefined });
    runtime.queryExecutor = queryExecutor;
    queryExecutorEnvKey = key;
  }
  return queryExecutor;
}
resolveQueryExecutor().catch((error) => console.warn("[data-agent-web] mcp query executor unavailable:", error.message));


// Pi agent initialization is shared by startup warm-up and request-time use.
// A missing or temporarily invalid LLM configuration must not prevent the host
// from listening; the next request will retry after a failed warm-up.
let agentHarness;
const agentListeners = new Set();
const agentHarnessResolver = createAgentHarnessResolver({
  getProfile: async () => {
    const cfg = (await metadata.getConfig("ui.settings")) ?? {};
    const profile = {
      provider: String(cfg.provider ?? "openai"),
      model: String(cfg.model ?? ""),
      apiKey: String(cfg.api_key ?? cfg.openai_api_key ?? cfg.anthropic_api_key ?? ""),
      baseUrl: cfg.base_url ? String(cfg.base_url) : undefined,
    };
    if (cfg.llm_enabled === false || !profile.apiKey || !profile.model) throw new Error("LLM_NOT_CONFIGURED: complete onboarding first");
    return profile;
  },
  create: async (profile, sessionId) => {
    const { createDataAgentHarness } = await import(toUrl(path.join(root, "packages/runtime/dist/index.js")));
    const persistentSession = sessionId ? await sessions.openByAppSessionId(sessionId) : undefined;
    const currentQueryExecutor = await resolveQueryExecutor();
    const schemaEvidence = await currentQueryExecutor.getSchema().catch((error) => {
      console.warn("[data-agent-web] schema evidence unavailable:", error?.message ?? error);
      return undefined;
    });
    const harness = await createDataAgentHarness({ workspace, knowledge, knowledgeRoot, pythonExecutable, databaseDialect: "mysql", schemaEvidence, queryExecutor: currentQueryExecutor, queryAssurance, reviewEvidence, enforceDeliveryReceipt: true, clarifications: runtime.clarifications, session: persistentSession, systemPromptRoots: [knowledgeRoot, root], projectRoot: root, packagedRoot: process.resourcesPath ?? root, toolContext: { sessionId } }, profile);
    for (const listener of agentListeners) harness.subscribe(listener);
    agentHarness = harness;
    console.log(`[data-agent-web] agent ready: ${profile.provider}/${profile.model}`);
    return harness;
  },
});
const resolveAgentHarness = (sessionId) => agentHarnessResolver.resolve(sessionId);
runtime.attachAgent({
  prompt: async (text, context) => (await resolveAgentHarness(context?.sessionId)).prompt(text),
  steer: async (text, context) => (await resolveAgentHarness(context?.sessionId))?.steer(text),
  followUp: async (text, context) => (await resolveAgentHarness(context?.sessionId))?.followUp(text),
  abort: async () => agentHarness?.abort(),
  getResources: () => agentHarness?.getResources() ?? {},
  setResources: async (resources) => { if (agentHarness) await agentHarness.setResources(resources); },
  subscribe: (listener) => { agentListeners.add(listener); return () => agentListeners.delete(listener); },
});
// Start in the background so normal web routes remain available during a cold
// start, or when onboarding has not configured an LLM yet.
agentHarnessResolver.warmup((error) => console.warn("[data-agent-web] agent warm-up unavailable:", error?.message ?? error));

const app = await createRuntimeServer(runtime, { workspace });

// Serve the built renderer when available so one process fronts the whole app.
const webDist = process.env.DATA_AGENT_WEB_DIST ? path.resolve(process.env.DATA_AGENT_WEB_DIST) : path.join(root, "frontend", "dist");
// Production Electron builds intentionally use Vite's relative asset paths.
// Canonicalize the web app route without a trailing slash so `./assets/*`
// resolves to `/assets/*` rather than `/app/assets/*` (the latter falls back
// to index.html and leaves the React root blank).
app.get("/app/", async (_request, reply) => reply.redirect("/app"));
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
