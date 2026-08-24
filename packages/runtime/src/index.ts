import {
  DataAgentEventEnvelopeSchema,
  DataAgentResponseEnvelopeSchema,
  ProtocolVersion,
  RequestContextSchema,
  type DataAgentCommandEnvelope,
  type DataAgentEventEnvelope,
  type DataAgentResponseEnvelope,
  type RequestContext,
} from "@data-agent/contracts";
import { Value } from "typebox/value";
import { MetadataStore } from "./metadata.js";
import { randomUUID } from "node:crypto";
import { PiJsonlSessionStore } from "./session-store.js";
import { WorkspaceStore } from "./workspace.js";
import { runPythonJob } from "./python-job.js";
import { KnowledgeIndex } from "./knowledge.js";
import { ClarificationManager } from "./clarification.js";
import { renderStandaloneDashboardHtml, validateDashboardV3Spec } from "./dashboard-v3.js";
import { renderSemanticDashboardHtml, validateDashboardV4Spec } from "./dashboard-v4.js";

export class DataAgentRuntimeError extends Error {
  readonly code: "INVALID_COMMAND" | "UNSUPPORTED_PROTOCOL_VERSION" | "INVALID_CONTEXT";
  readonly details?: unknown;

  constructor(
    code: DataAgentRuntimeError["code"],
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "DataAgentRuntimeError";
    this.code = code;
    this.details = details;
  }
}

export type DataAgentEventListener = (event: DataAgentEventEnvelope) => void;

export class DataAgentRuntime {
  private readonly listeners = new Set<DataAgentEventListener>();
  private readonly eventBuffer: DataAgentEventEnvelope[] = [];
  private readonly metadata?: MetadataStore;
  private readonly sessions?: PiJsonlSessionStore;
  private readonly workspace?: WorkspaceStore;
  private pythonExecutable?: string;
  private readonly knowledge?: KnowledgeIndex;
  private readonly knowledgeRoot?: string;
  private readonly semanticProjectDir?: string;
  queryExecutor?: { run(sql: string, rowLimit: number): Promise<{ columns: string[]; rows: unknown[][]; truncated: boolean }> };
  dbTester?: { test(connection: Record<string, unknown>): Promise<{ success: boolean; message: string; details?: unknown }> };
  llmTester?: { test(profile: Record<string, unknown>): Promise<{ success: boolean; message: string; details?: unknown }> };
  providerRegistry?: { list(): Array<Record<string, unknown>>; save(profile: Record<string, unknown>): Promise<unknown> };
  mcpSupervisor?: { status(): Promise<Array<{ name: string; enabled: boolean; connected: boolean; toolCount: number; hostManaged: boolean }>>; test(name: string): Promise<{ ok: boolean; message: string }>; restart(name: string): Promise<{ ok: boolean }> };
  ingestJob?: { getStatus(): Promise<{ status: string; jobId: string | null; summary: { updated: number; unchanged: number; failed: number; skipped: number }; errorCode: string | null }>; retry(): Promise<{ accepted: boolean }> };
  private readonly clarifications: ClarificationManager;
  private activeRun?: { requestId: string; runId: string; sessionId?: string };
  private readonly agent?: { prompt(text: string): Promise<unknown>; steer?(text: string): void; followUp?(text: string): void; abort(): void; subscribe?(listener: (event: any) => void): () => void };

  constructor(options: { metadata?: MetadataStore; sessions?: PiJsonlSessionStore; workspace?: WorkspaceStore; pythonExecutable?: string; knowledge?: KnowledgeIndex; knowledgeRoot?: string; clarifications?: ClarificationManager; agent?: { prompt(text: string): Promise<unknown>; steer?(text: string): void; followUp?(text: string): void; abort(): void; subscribe?(listener: (event: any) => void): () => void } } = {}) {
    this.metadata = options.metadata;
    this.sessions = options.sessions;
    this.workspace = options.workspace;
    this.pythonExecutable = options.pythonExecutable;
    this.knowledge = options.knowledge;
    this.knowledgeRoot = options.knowledgeRoot;
    this.semanticProjectDir = (options as { semanticProjectDir?: string }).semanticProjectDir;
    this.clarifications = options.clarifications ?? new ClarificationManager();
    this.clarifications.onAsked = (request) => {
      this.emit({ protocolVersion: ProtocolVersion, sequence: this.nextSequence++, requestId: "clarification", timestamp: Date.now(), sessionId: request.sessionId, event: { type: "clarification.request", clarificationId: request.clarificationId, question: request.question, options: request.options } });
    };
    this.clarifications.onSettled = (clarificationId, outcome) => {
      this.emit({ protocolVersion: ProtocolVersion, sequence: this.nextSequence++, requestId: "clarification", timestamp: Date.now(), event: { type: "clarification.settled", clarificationId, outcome } });
    };
    this.agent = options.agent;
    this.agent?.subscribe?.((event) => this.mapPiEvent(event));
  }
  private nextSequence = 1;

  eventsAfter(sequence: number): DataAgentEventEnvelope[] {
    return this.eventBuffer.filter((event) => event.sequence > sequence);
  }

  subscribe(listener: DataAgentEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async dispatch(
    command: DataAgentCommandEnvelope,
    context: RequestContext,
  ): Promise<DataAgentResponseEnvelope> {
    this.assertContext(context);

    if (command.protocolVersion !== ProtocolVersion) {
      throw new DataAgentRuntimeError(
        "UNSUPPORTED_PROTOCOL_VERSION",
        `Unsupported protocol version: ${command.protocolVersion}`,
        { supported: ProtocolVersion },
      );
    }

    if (command.command.type === "workspace.list" || command.command.type === "workspace.read" || command.command.type === "workspace.write" || command.command.type === "workspace.delete") {
      if (!this.workspace) throw new DataAgentRuntimeError("INVALID_COMMAND", "Workspace is not configured");
      this.workspace.assertAccess(context);
      if (command.command.type === "workspace.list") return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "workspace.result", operation: "list", files: await this.workspace.list() } };
      if (command.command.type === "workspace.read") return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "workspace.result", operation: "read", path: command.command.path, content: await this.workspace.read(command.command.path) } };
      if (command.command.type === "workspace.delete") { await this.workspace.delete(command.command.path); return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "workspace.result", operation: "write", path: command.command.path } }; }
      await this.workspace.write(command.command.path, command.command.content);
      this.emit({ protocolVersion: ProtocolVersion, sequence: this.nextSequence++, requestId: command.requestId, sessionId: context.sessionId, timestamp: Date.now(), event: { type: "workspace.artifact.created", path: command.command.path, kind: "file" } });
      return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "workspace.result", operation: "write", path: command.command.path } };
    }

    if (command.command.type === "dashboard.generate") {
      if (!this.workspace) throw new DataAgentRuntimeError("INVALID_COMMAND", "Workspace is not configured");
      this.workspace.assertAccess(context);
      const c = command.command;
      if (c.version === "v3" && c.mode === "static") {
        const validated = validateDashboardV3Spec(c.spec);
        if (!validated.ok || c.operation === "validate") {
          return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "dashboard.result", valid: validated.ok, errors: validated.ok ? [] : validated.errors } };
        }
        const target = c.editPath ?? `dashboards/${Date.now()}.html`;
        const html = await renderStandaloneDashboardHtml(validated.spec);
        await this.workspace.write(target, html);
        this.emit({ protocolVersion: ProtocolVersion, sequence: this.nextSequence++, requestId: command.requestId, sessionId: context.sessionId, timestamp: Date.now(), event: { type: "workspace.artifact.created", path: target, kind: "file" } });
        return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "dashboard.result", valid: true, errors: [], path: target, bytes: html.length } };
      }
      if (c.version === "v4" && c.mode === "semantic") {
        const validated = validateDashboardV4Spec(c.spec);
        if (!validated.ok || c.operation === "validate") {
          return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "dashboard.result", valid: validated.ok, errors: validated.ok ? [] : validated.errors } };
        }
        const target = c.editPath ?? `dashboards/${Date.now()}-semantic.html`;
        const nonce = randomUUID();
        const html = renderSemanticDashboardHtml(validated.spec, { nonce, expectedOrigin: "https://data-agent.local" });
        await this.workspace.write(target, html);
        this.emit({ protocolVersion: ProtocolVersion, sequence: this.nextSequence++, requestId: command.requestId, sessionId: context.sessionId, timestamp: Date.now(), event: { type: "workspace.artifact.created", path: target, kind: "file" } });
        return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "dashboard.result", valid: true, errors: [], path: target, bytes: html.length } };
      }
      throw new DataAgentRuntimeError("INVALID_COMMAND", "Unsupported dashboard mode/version combination");
    }

    if (command.command.type === "clarification.answer") {
      const answered = this.clarifications.answer(command.command.clarificationId, command.command.answer);
      if (!answered) throw new DataAgentRuntimeError("INVALID_COMMAND", "Unknown or already settled clarification");
      return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "runtime.probe.result", service: "data-agent-runtime", runtimeVersion: "0.1.0" } };
    }

    if (command.command.type === "semantic.sources.list" && this.semanticProjectDir) {
      const { resolve: resolvePath2 } = await import("node:path");
      const fs = await import("node:fs/promises");
      const base = resolvePath2(this.semanticProjectDir);
      const sources: Array<{ connectionId: string; sourceName: string; definition: unknown; updatedAt: number }> = [];
      let connections: string[] = [];
      try { connections = await fs.readdir(resolvePath2(base, "business-semantic")); } catch { connections = []; }
      for (const connectionId of connections) {
        const connDir = resolvePath2(base, "business-semantic", connectionId);
        let entries: any[] = [];
        try { entries = await fs.readdir(connDir, { withFileTypes: true }); } catch { continue; }
        for (const entry of entries) {
          if (!entry.isFile() || !(entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))) continue;
          const full = resolvePath2(connDir, entry.name);
          const info = await fs.stat(full);
          sources.push({ connectionId, sourceName: entry.name.replace(/\.ya?ml$/i, ""), definition: {}, updatedAt: info.mtimeMs });
        }
      }
      return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "semantic.sources.result", sources } };
    }
    if (command.command.type === "semantic.sources.get" && this.semanticProjectDir) {
      const { resolve: resolvePath2 } = await import("node:path");
      const fs = await import("node:fs/promises");
      const getCmd = command.command as { connectionId: string; sourceName: string };
      const candidates = [".yaml", ".yml"].map((ext) => resolvePath2(this.semanticProjectDir as string, "business-semantic", getCmd.connectionId, getCmd.sourceName + ext));
      let rawYaml: string | null = null;
      for (const candidate of candidates) { try { rawYaml = await fs.readFile(candidate, "utf8"); break; } catch { /* next */ } }
      if (rawYaml === null) throw new DataAgentRuntimeError("INVALID_COMMAND", "SEMANTIC_SOURCE_NOT_FOUND");
      return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "semantic.source.result", source: { connectionId: getCmd.connectionId, sourceName: getCmd.sourceName, definition: { rawYaml }, updatedAt: Date.now() } } };
    }
    if (command.command.type === "semantic.sources.list") {
      const rows = (await this.metadata!.listSemanticSources()) ?? [];
      return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "semantic.sources.result", sources: rows.map((r: any) => ({ connectionId: String(r.connectionId), sourceName: String(r.sourceName), definition: JSON.parse(String(r.definitionJson)), updatedAt: r.updatedAt })) } };
    }
    if (command.command.type === "semantic.sources.get") {
      const row = await this.metadata!.getSemanticSource(command.command.connectionId, command.command.sourceName);
      if (!row) throw new DataAgentRuntimeError("INVALID_COMMAND", "SEMANTIC_SOURCE_NOT_FOUND");
      return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "semantic.source.result", source: { connectionId: String(row.connectionId), sourceName: String(row.sourceName), definition: JSON.parse(String(row.definitionJson)), updatedAt: row.updatedAt } } };
    }
    if (command.command.type === "mcp.config.get" || command.command.type === "mcp.config.save") {
      if (command.command.type === "mcp.config.save") await this.metadata!.setConfig("mcp.config", (command.command as { config: unknown }).config);
      const config = (await this.metadata!.getConfig("mcp.config")) ?? null;
      return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "mcp.config.result", config } };
    }
    if (command.command.type === "skills.list") {
      const { resolve: resolvePath2 } = await import("node:path");
      const { loadSkillsFromDir } = await import("./skills.js");
      const skillsRoot = resolvePath2(this.knowledgeRoot as string, "..", "skills");
      const { skills: loaded } = await loadSkillsFromDir(skillsRoot);
      const skills: Array<{ name: string; description: string; tools: string[] }> = [];
      for (const sk of loaded) skills.push({ name: String((sk as any).name ?? ""), description: String((sk as any).description ?? ""), tools: Array.isArray((sk as any).tools) ? (sk as any).tools.map(String) : [] });
      return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "skills.list.result", skills } };
    }
    if (command.command.type === "dashboard.evaluate") {
      if (!this.queryExecutor) throw new DataAgentRuntimeError("INVALID_COMMAND", "QUERY_EXECUTOR_NOT_CONFIGURED");
      const limit = Math.min(command.command.rowLimit ?? 1000, 10000);
      const guarded = /\b(drop|delete|insert|update|alter|create|truncate)\b/i.test(command.command.sql);
      if (guarded) throw new DataAgentRuntimeError("INVALID_COMMAND", "FORBIDDEN_SQL_IN_EVALUATE");
      const result = await this.queryExecutor.run(command.command.sql, limit);
      return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "dashboard.evaluate.result", columns: result.columns, rows: result.rows, rowCount: result.rows.length, truncated: result.truncated } };
    }
    if (command.command.type === "semantic.ingest.status") {
      if (!this.ingestJob) throw new DataAgentRuntimeError("INVALID_COMMAND", "INGEST_JOB_NOT_CONFIGURED");
      const status = await this.ingestJob.getStatus();
      return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "semantic.ingest.status.result", ...status } };
    }
    if (command.command.type === "semantic.ingest.retry") {
      if (!this.ingestJob) throw new DataAgentRuntimeError("INVALID_COMMAND", "INGEST_JOB_NOT_CONFIGURED");
      const result = await this.ingestJob.retry();
      return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "semantic.ingest.retry.result", accepted: result.accepted } };
    }
    if (command.command.type === "dashboard.v3.data") {
      if (!this.workspace) throw new DataAgentRuntimeError("INVALID_COMMAND", "WORKSPACE_NOT_CONFIGURED");
      const html = await this.workspace.read(command.command.path);
      const match = /window\.__DASHBOARD__=(\{[\s\S]*?\});<\/script>/.exec(html);
      if (!match) throw new DataAgentRuntimeError("INVALID_COMMAND", "LEGACY_DASHBOARD_REQUIRES_REGENERATION");
      return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "dashboard.v3.data.result", payload: JSON.parse(match[1]) } };
    }
    if (command.command.type === "config.get" || command.command.type === "config.save") {
      if (command.command.type === "config.save") { const current = (await this.metadata!.getConfig("ui.settings")) ?? {}; await this.metadata!.setConfig("ui.settings", { ...(current as Record<string, unknown>), ...((command.command as { patch: Record<string, unknown> }).patch) }); }
      const config = (await this.metadata!.getConfig("ui.settings")) ?? {};
      return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "config.get.result", config } };
    }
    if (command.command.type === "python.runtime.test") {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      const executable = (command.command as { executable?: string }).executable || this.pythonExecutable || "python";
      try {
        const { stdout } = await execFileAsync(executable, ["--version"], { timeout: 15000 });
        return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "test.result", success: true, message: stdout.trim() } };
      } catch (error) {
        return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "test.result", success: false, message: error instanceof Error ? error.message : String(error) } };
      }
    }
    if (command.command.type === "db.test") {
      if (!this.dbTester) throw new DataAgentRuntimeError("INVALID_COMMAND", "DB_TESTER_NOT_CONFIGURED");
      const result = await this.dbTester.test((command.command as { connection: Record<string, unknown> }).connection);
      return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "test.result", success: result.success, message: result.message } };
    }
    if (command.command.type === "llm.test") {
      if (!this.llmTester) throw new DataAgentRuntimeError("INVALID_COMMAND", "LLM_TESTER_NOT_CONFIGURED");
      const result = await this.llmTester.test((command.command as { profile: Record<string, unknown> }).profile);
      return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "test.result", success: result.success, message: result.message, details: result.details } };
    }
    if (command.command.type === "config.llm.list") {
      const profiles = this.providerRegistry ? this.providerRegistry.list() : [];
      return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "config.llm.list.result", profiles } };
    }
    if (command.command.type === "config.llm.save") {
      if (!this.providerRegistry) throw new DataAgentRuntimeError("INVALID_COMMAND", "PROVIDER_REGISTRY_NOT_CONFIGURED");
      const saved = await this.providerRegistry.save(command.command.profile as never);
      return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "config.llm.save.result", profile: saved as never } };
    }
    if (command.command.type === "mcp.servers.status") {
      if (!this.mcpSupervisor) throw new DataAgentRuntimeError("INVALID_COMMAND", "MCP_SUPERVISOR_NOT_CONFIGURED");
      const servers = await this.mcpSupervisor.status();
      return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "mcp.servers.status.result", servers } };
    }
    if (command.command.type === "mcp.server.test" || command.command.type === "mcp.server.restart") {
      if (!this.mcpSupervisor) throw new DataAgentRuntimeError("INVALID_COMMAND", "MCP_SUPERVISOR_NOT_CONFIGURED");
      if (command.command.type === "mcp.server.test") {
        const result = await this.mcpSupervisor.test((command.command as { name: string }).name);
        return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "mcp.server.test.result", ok: result.ok, message: result.message } };
      }
      const result = await this.mcpSupervisor.restart((command.command as { name: string }).name);
      return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "mcp.server.restart.result", ok: result.ok } };
    }
    if (command.command.type === "session.transcript") {
      if (!this.sessions) throw new DataAgentRuntimeError("INVALID_COMMAND", "SESSION_STORE_NOT_CONFIGURED");
      const listed = (await this.sessions.list()) as Array<Record<string, unknown>>;
      const transcriptCmd = command.command as { sessionId: string };
      const match = listed.find((meta) => (((meta.metadata ?? {}) as Record<string, unknown>).sessionId === transcriptCmd.sessionId || String(meta.id ?? "") === transcriptCmd.sessionId));
      const messages: Array<{ id: string; role: string; content: string; timestamp: number }> = [];
      if (match) {
        const session = await this.sessions.open(match as never);
        const entries = await session.getEntries();
        for (const entry of entries) {
          if (entry.type !== "message") continue;
          const message = entry.message as unknown as Record<string, unknown>;
          const role = message.role === "assistant" ? "agent" : String(message.role ?? "user");
          let text = "";
          for (const part of (Array.isArray(message.content) ? message.content : []) as Array<Record<string, unknown>>) {
            if (part.type === "text" && typeof part.text === "string") text += part.text;
          }
          if (!text) continue;
          messages.push({ id: entry.id, role, content: text, timestamp: Date.parse(entry.timestamp) || 0 });
        }
      }
      return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "session.transcript.result", messages } };
    }
    if (command.command.type === "session.prepare") {
      return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "runtime.probe.result", service: "data-agent-runtime", runtimeVersion: "0.1.0" } };
    }
    if (command.command.type === "python.run") {
      if (!this.pythonExecutable) throw new DataAgentRuntimeError("INVALID_COMMAND", "Python runtime is not configured");
      if (!context.sessionId) throw new DataAgentRuntimeError("INVALID_CONTEXT", "Python jobs require a session workspace");
      const result = await runPythonJob(command.command.code, { workspace: context.sessionId, executable: this.pythonExecutable });
      return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "python.result", jobId: result.jobId, status: result.status, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, scriptPath: result.scriptPath, durationMs: result.durationMs } };
    }

    if (command.command.type === "knowledge.search" || command.command.type === "knowledge.read" || command.command.type === "knowledge.list" || command.command.type === "knowledge.save") {
      if (command.command.type === "knowledge.save" && !this.knowledgeRoot) throw new DataAgentRuntimeError("INVALID_COMMAND", "Knowledge root is not configured");
      if (!this.knowledgeRoot && command.command.type !== "knowledge.save") throw new DataAgentRuntimeError("INVALID_COMMAND", "Knowledge index is not configured");
      const { resolve: resolvePath, join: joinPath } = await import("node:path");
      if (this.knowledge) await this.knowledge.loadDirectory(this.knowledgeRoot as string);
      if (command.command.type === "knowledge.search") return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "knowledge.search.result", hits: this.knowledge!.search(command.command.query) } };
      if (command.command.type === "knowledge.list") {
        const { readdir, stat } = await import("node:fs/promises");
        const files: Array<{ path: string; size: number; modifiedAt: number }> = [];
        const walk = async (dir: string): Promise<void> => {
          for (const entry of await readdir(dir, { withFileTypes: true })) {
            const full = dir + "/" + entry.name;
            if (entry.isDirectory()) await walk(full);
            else if (entry.name.endsWith(".md")) {
              const info = await stat(full);
              files.push({ path: full.slice((this.knowledgeRoot as string).length + 1), size: info.size, modifiedAt: info.mtimeMs });
            }
          }
        };
        await walk(this.knowledgeRoot as string);
        return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "knowledge.list.result", files } };
      }
      if (command.command.type === "knowledge.save") {
        if (command.command.path.startsWith(".pi/")) throw new DataAgentRuntimeError("INVALID_COMMAND", "SYSTEM_PROMPT_IMMUTABLE");
        const { writeFile, mkdir } = await import("node:fs/promises");
        const target = resolvePath(joinPath(this.knowledgeRoot as string, command.command.path));
        if (!target.startsWith(resolvePath(this.knowledgeRoot as string))) throw new DataAgentRuntimeError("INVALID_COMMAND", "Knowledge path escapes root");
        await mkdir(joinPath(target, ".."), { recursive: true });
        await writeFile(target, command.command.content, "utf8");
        return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "knowledge.save.result", path: command.command.path } };
      }
      const { readFile } = await import("node:fs/promises");
      const target = resolvePath(joinPath(this.knowledgeRoot as string, command.command.path));
      if (!target.startsWith(resolvePath(this.knowledgeRoot as string))) throw new DataAgentRuntimeError("INVALID_COMMAND", "Knowledge path escapes root");
      return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "knowledge.read.result", path: command.command.path, content: await readFile(target, "utf8") } };
    }

    if (command.command.type === "agent.steer" || command.command.type === "agent.follow_up") {
      if (!this.agent) throw new DataAgentRuntimeError("INVALID_COMMAND", "Pi Agent is not configured");
      const method = command.command.type === "agent.steer" ? this.agent.steer : this.agent.followUp;
      if (!method) throw new DataAgentRuntimeError("INVALID_COMMAND", "Agent queue operation is not configured");
      method.call(this.agent, command.command.prompt);
      return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "agent.prompt.accepted", runId: "queued" } };
    }
    if (command.command.type === "agent.stop") {
      if (!this.agent) throw new DataAgentRuntimeError("INVALID_COMMAND", "Pi Agent is not configured");
      this.agent.abort();
      return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "agent.prompt.accepted", runId: "stopped" } };
    }

    if (command.command.type === "agent.prompt") {
      if (!this.agent) throw new DataAgentRuntimeError("INVALID_COMMAND", "Pi Agent is not configured");
      const runId = randomUUID();
      this.activeRun = { requestId: command.requestId, runId, sessionId: context.sessionId };
      void this.agent.prompt(command.command.prompt).then(() => { this.emit({ protocolVersion: ProtocolVersion, sequence: this.nextSequence++, requestId: command.requestId, runId, timestamp: Date.now(), event: { type: "agent.completed" } }); this.activeRun = undefined; });
      return { protocolVersion: ProtocolVersion, requestId: command.requestId, response: { type: "agent.prompt.accepted", runId } };
    }

    if (command.command.type !== "runtime.probe") {
      if (!this.metadata) throw new DataAgentRuntimeError("INVALID_COMMAND", "Metadata store is not configured");
      const c = command.command;
      const userId = context.userId;
      if (c.type === "task.create") return this.mutation(command.requestId, "task", await this.metadata.call(c.type, userId, { idValue: MetadataStore.createId(), name: c.name }));
      if (c.type === "task.list") return this.list(command.requestId, "task", await this.metadata.call(c.type, userId));
      if (c.type === "task.rename" || c.type === "task.delete") return this.mutation(command.requestId, "task", await this.metadata.call(c.type, userId, c));
      if (c.type === "session.create") {
        const item = await this.metadata.call(c.type, userId, { ...c, idValue: MetadataStore.createId() });
        if (this.sessions) await this.sessions.create({ userId, taskId: c.taskId, sessionId: item.id });
        await this.metadata.call("outbox.enqueue", userId, { sessionId: item.id, sequence: 0 });
        return this.mutation(command.requestId, "session", item);
      }
      if (c.type === "session.list") return this.list(command.requestId, "session", await this.metadata.call(c.type, userId, c));
      if (c.type === "session.rename" || c.type === "session.delete") return this.mutation(command.requestId, "session", await this.metadata.call(c.type, userId, c));
      throw new DataAgentRuntimeError("INVALID_COMMAND", "Unsupported DataAgent command");
    }

    const response: DataAgentResponseEnvelope = {
      protocolVersion: ProtocolVersion,
      requestId: command.requestId,
      response: {
        type: "runtime.probe.result",
        service: "data-agent-runtime",
        runtimeVersion: "0.1.0",
      },
    };

    if (!Value.Check(DataAgentResponseEnvelopeSchema, response)) {
      throw new DataAgentRuntimeError("INVALID_COMMAND", "Runtime produced an invalid response");
    }

    this.emit({
      protocolVersion: ProtocolVersion,
      sequence: this.nextSequence++,
      requestId: command.requestId,
      timestamp: Date.now(),
      event: {
        type: "runtime.probe.completed",
        service: "data-agent-runtime",
      },
    });

    return response;
  }

  /** Tools call this to suspend the run until the user answers or timeout hits. */
  askClarification(sessionId: string, question: string, options: string[], timeoutMs?: number): { clarificationId: string; promise: Promise<string> } {
    const asked = this.clarifications.ask(sessionId, question, options, timeoutMs);
    this.emit({ protocolVersion: ProtocolVersion, sequence: this.nextSequence++, requestId: "clarification", sessionId, timestamp: Date.now(), event: { type: "clarification.request", clarificationId: asked.clarificationId, question, options } });
    return asked;
  }

  cancelSessionClarifications(sessionId: string): void { this.clarifications.cancel(sessionId, "cancelled"); }

  private mapPiEvent(event: any): void {
    const run = this.activeRun;
    if (!run || !event?.type) return;
    const base = () => ({ protocolVersion: ProtocolVersion, sequence: this.nextSequence++, requestId: run.requestId, runId: run.runId, sessionId: run.sessionId, timestamp: Date.now() });
    if (event.type === "message_start") {
      this.emit({ ...base(), event: { type: "agent.message_started", messageId: String(event.message?.id ?? "") } });
      return;
    }
    if (event.type === "message_update") {
      const update = event.assistantMessageEvent;
      if (update?.type !== "text_delta" && update?.type !== "thinking_delta") return;
      this.emit({ ...base(), event: { type: update.type === "text_delta" ? "agent.text_delta" : "agent.thinking_delta", delta: update.delta } });
      return;
    }
    if (event.type === "tool_execution_start") {
      this.emit({ ...base(), event: { type: "agent.tool_started", toolCallId: String(event.toolCallId), toolName: String(event.toolName), args: event.args ?? null } });
      return;
    }
    if (event.type === "tool_execution_end") {
      this.emit({ ...base(), event: { type: "agent.tool_finished", toolCallId: String(event.toolCallId), toolName: String(event.toolName), result: event.result ?? null, isError: Boolean(event.isError) } });
      return;
    }
  }

  private mutation(requestId: string, entity: "task" | "session", item: unknown): DataAgentResponseEnvelope { return { protocolVersion: ProtocolVersion, requestId, response: { type: "mutation.result", entity, item: item as never } }; }
  private list(requestId: string, entity: "task" | "session", items: unknown): DataAgentResponseEnvelope { return { protocolVersion: ProtocolVersion, requestId, response: { type: "list.result", entity, items: items as never[] } }; }

  private assertContext(context: RequestContext): void {
    if (!Value.Check(RequestContextSchema, context)) {
      throw new DataAgentRuntimeError("INVALID_CONTEXT", "Invalid request context");
    }
  }

  private emit(event: DataAgentEventEnvelope): void {
    if (!Value.Check(DataAgentEventEnvelopeSchema, event)) {
      throw new DataAgentRuntimeError("INVALID_COMMAND", "Runtime produced an invalid event");
    }
    this.eventBuffer.push(event);
    if (this.eventBuffer.length > 256) this.eventBuffer.shift();
    for (const listener of this.listeners) listener(event);
  }
}

export { LocalAuthService } from "./auth.js";
export { migrateLegacyData, type MigrationReport } from "./legacy-migration.js";
export { runPythonJob, type PythonJobResult } from "./python-job.js";
export { effectiveTools, loadSkillsFromDir, moveSystemPrompt, type SkillDefinition, type SkillDiagnostic } from "./skills.js";
export { KnowledgeIndex, type KnowledgeHit } from "./knowledge.js";
export { KnowledgeWriter, KnowledgeWriteDeniedError, readAuditLog, type KnowledgeWriteOperation, type KnowledgeWriteResult } from "./knowledge-write.js";
export { createExportQueryAdapter, ExportCapabilityError } from "./export-adapter.js";
export { ProcessSupervisor, semanticToolIdentity, type SupervisorState } from "./process-supervisor.js";
export { ClarificationManager } from "./clarification.js";
export { InMemorySecretVault, ProviderRegistry, type LLMProfile, type SecretVault } from "./providers.js";
export { assertNoLegacyTools, canonicalLocalTools, type CanonicalTool } from "./tools-catalog.js";
export { WorkspaceStore } from "./workspace.js";
export { loadRuntimeManifest, probePython, resolvePythonRuntime, type PythonRuntimeConfig, type PythonRuntimeManifest } from "./python-runtime.js";
export { writePythonPackManifest } from "./python-pack-builder.js";
export type { RequestContext } from "@data-agent/contracts";
export { MetadataStore } from "./metadata.js";
export { SqlGuard, DANGEROUS_KEYWORDS, INJECTION_PATTERNS, type SqlGuardResult } from "./sql-guard.js";
export { PiJsonlSessionStore } from "./session-store.js";
