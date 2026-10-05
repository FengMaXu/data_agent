import path from "node:path";
import type { DataAgentCommandEnvelope, DataAgentEventEnvelope, DataAgentResponseEnvelope, RequestContext } from "@data-agent/contracts";
import { ClarificationManager } from "../clarification.js";
import { KnowledgeIndex } from "../knowledge.js";
import { MetadataStore } from "../metadata.js";
import { ChannelHub, type ChannelHubOptions } from "../channels/hub.js";
import { MetadataChannelStore } from "../channels/store.js";
import { DataAgentRuntime } from "../protocol.js";
import { WorkspaceStore } from "../workspace.js";
import type { DataAgentModelProfile, SessionQueryExecutor } from "./session-runtime.js";
import {
  DataAgentSessionApplication,
  type ApplicationAgentAdapter,
  type ApplicationAgentEvent,
  type ApplicationResources,
  type HostRequestContext,
} from "./host.js";
import type { ApplicationAuthService, ApplicationCommandHost, ApplicationEventFilter, EventReplay } from "./protocol-host.js";
import { JevHypothesisChoiceAdvisor } from "../adapters/jev-hypothesis-choice-advisor.js";
import { JevSpecAlignmentAssessor } from "../adapters/jev-spec-alignment-assessor.js";

export interface DataAgentApplicationOptions {
  readonly dataRoot: string;
  readonly host: "electron" | "web";
  readonly defaultUserId?: string;
  readonly knowledgeRoot?: string;
  readonly semanticProjectDir?: string;
  readonly pythonExecutable?: string | (() => string | undefined);
  readonly bundledPythonExecutable?: string;
  readonly queryExecutor?: SessionQueryExecutor | (() => SessionQueryExecutor | Promise<SessionQueryExecutor>);
  readonly resolveProfile: (context: HostRequestContext, application: DataAgentApplication) => DataAgentModelProfile | Promise<DataAgentModelProfile>;
  readonly systemPrompt?: string;
  readonly systemPromptRoots?: readonly string[];
  readonly projectRoot?: string;
  readonly packagedRoot?: string;
  readonly skillRoots?: readonly string[];
  readonly enableDashboards?: boolean;
  readonly enableWidgets?: boolean;
  /** Opt in to bounded AgentHarness-native explorer/reviewer delegation. */
  readonly enableSubagents?: boolean | ((context: HostRequestContext, application: DataAgentApplication) => boolean | Promise<boolean>);
  /** Exact relative Markdown paths delegated children may inspect. */
  readonly delegationKnowledgePaths?: readonly string[];
  /** Opt-in Jev advisor; the key stays in the trusted host composition path. */
  readonly jevHypothesisComparison?: {
    readonly apiKey: string;
    readonly model?: string;
    readonly endpoint?: string;
    readonly timeoutMs?: number;
  };
  /** Explicit opt-in; this does not follow jevHypothesisComparison implicitly. */
  readonly jevSpecAlignment?: {
    readonly apiKey: string;
    readonly model?: string;
    readonly endpoint?: string;
    readonly timeoutMs?: number;
  };
}

export interface IngestJobPort {
  getStatus(): Promise<{ status: string; jobId: string | null; summary: { updated: number; unchanged: number; failed: number; skipped: number }; errorCode: string | null }>;
  retry(): Promise<{ accepted: boolean }>;
}

export interface HostTestPorts {
  readonly dbTester?: { test(connection: Record<string, unknown>): Promise<{ success: boolean; message: string; details?: unknown }> };
  readonly llmTester?: { test(profile: Record<string, unknown>): Promise<{ success: boolean; message: string; details?: unknown }> };
}

/**
 * The product-level Application surface used by Electron and Web Hosts.
 * It routes transport commands to Session applications while keeping Pi and
 * concrete Answering stores behind this boundary.
 */
export class DataAgentApplication implements ApplicationCommandHost {
  private queryExecutorPort: DataAgentApplicationOptions["queryExecutor"];
  private closed = false;

  private constructor(
    private readonly runtime: DataAgentRuntime,
    private readonly sessions: DataAgentSessionApplication,
    private readonly metadata: MetadataStore,
    readonly workspace: WorkspaceStore,
    readonly knowledge: KnowledgeIndex,
    private readonly agent: ApplicationAgentAdapter,
    queryExecutor: DataAgentApplicationOptions["queryExecutor"],
  ) {
    this.queryExecutorPort = queryExecutor;
  }

  static async create(options: DataAgentApplicationOptions): Promise<DataAgentApplication> {
    const dataRoot = path.resolve(options.dataRoot);
    const workspaceUserId = options.defaultUserId ?? (options.host === "electron" ? "local" : undefined);
    const workspace = new WorkspaceStore(path.join(dataRoot, "workspace"), workspaceUserId ? { userId: workspaceUserId } : {});
    const knowledgeRoot = path.resolve(options.knowledgeRoot ?? path.join(dataRoot, "knowledge"));
    const knowledge = new KnowledgeIndex({ requireMetadata: true });
    await knowledge.loadDirectory(knowledgeRoot);
    for (const diagnostic of knowledge.diagnostics()) {
      console.warn(`[data-agent] Knowledge diagnostic (${diagnostic.code}) ${diagnostic.path}: ${diagnostic.message}`);
    }
    const metadata = new MetadataStore(path.join(dataRoot, "metadata", "app.db"));
    const clarifications = new ClarificationManager();
    const savedSettings = await metadata.getConfig("ui.settings");
    const pythonSettings = savedSettings && typeof savedSettings === "object" && !Array.isArray(savedSettings)
      ? (savedSettings as Record<string, unknown>).python_runtime
      : undefined;
    const configuredPython = pythonSettings && typeof pythonSettings === "object" && !Array.isArray(pythonSettings)
      && (pythonSettings as Record<string, unknown>).mode === "external"
      && typeof (pythonSettings as Record<string, unknown>).executable === "string"
      ? String((pythonSettings as Record<string, unknown>).executable).trim()
      : undefined;
    const initialPythonExecutable = configuredPython || (typeof options.pythonExecutable === "function" ? options.pythonExecutable() : options.pythonExecutable);
    let application!: DataAgentApplication;
    const subagentPolicy = options.enableSubagents;
    const hypothesisChoiceAdvisor = options.jevHypothesisComparison
      ? new JevHypothesisChoiceAdvisor(options.jevHypothesisComparison)
      : undefined;
    const specAlignmentAssessor = options.jevSpecAlignment
      ? new JevSpecAlignmentAssessor(options.jevSpecAlignment)
      : undefined;
    // A deployment fact, said once here rather than disclosed with every published result.
    if (!specAlignmentAssessor) console.info("[data-agent] Answer Spec feedback assessor is not configured; results are published without Spec feedback.");
    const sessions = new DataAgentSessionApplication({
      sessionRoot: path.join(dataRoot, "sessions"),
      workspace,
      knowledge,
      knowledgeRoot,
      pythonExecutable: () => application.pythonExecutablePath,
      queryExecutor: async () => {
        const port = application.queryExecutorPort;
        if (!port) throw new Error("QUERY_EXECUTOR_NOT_CONFIGURED");
        return typeof port === "function" ? port() : port;
      },
      resultRoot: path.join(dataRoot, "results"),
      // doc/business.md is a canonical, model-unwritable document; its id cannot be reused by drafts.
      answeringEvidenceDocuments: { "business-definitions": "reviewed_definition" },
      ...(hypothesisChoiceAdvisor ? { hypothesisChoiceAdvisor } : {}),
      ...(specAlignmentAssessor ? { specAlignmentAssessor } : {}),
      resolveProfile: (context) => options.resolveProfile(context, application),
      ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
      ...(options.systemPromptRoots ? { systemPromptRoots: options.systemPromptRoots } : {}),
      ...(options.projectRoot ? { projectRoot: options.projectRoot } : {}),
      ...(options.packagedRoot ? { packagedRoot: options.packagedRoot } : {}),
      ...(options.skillRoots ? { skillRoots: options.skillRoots } : {}),
      ...(options.enableDashboards !== undefined ? { enableDashboards: options.enableDashboards } : {}),
      ...(options.enableWidgets !== undefined ? { enableWidgets: options.enableWidgets } : {}),
      ...(subagentPolicy !== undefined ? {
        enableSubagents: typeof subagentPolicy === "function"
          ? (context: HostRequestContext) => subagentPolicy(context, application)
          : subagentPolicy,
      } : {}),
      delegationRoot: path.join(dataRoot, "subagents"),
      ...(options.delegationKnowledgePaths ? { delegationKnowledgePaths: options.delegationKnowledgePaths } : {}),
      clarifications,
      createMissingSessions: false,
      authorizeSession: async (request) => (await metadata.authorizeSession(request.userId, request.sessionId)) === "owned",
    });
    const runtime = new DataAgentRuntime({
      metadata,
      workspace,
      knowledge,
      knowledgeRoot,
      ...(initialPythonExecutable ? { pythonExecutable: initialPythonExecutable } : {}),
      ...(options.bundledPythonExecutable ? { bundledPythonExecutable: options.bundledPythonExecutable } : {}),
      ...(options.semanticProjectDir ? { semanticProjectDir: options.semanticProjectDir } : {}),
      ...(options.skillRoots ? { skillRoots: [...options.skillRoots] } : {}),
      ...(options.projectRoot ? { projectRoot: options.projectRoot } : {}),
      ...(options.packagedRoot ? { packagedRoot: options.packagedRoot } : {}),
      clarifications,
    });
    const agent = sessions.createAgentAdapter({ ...(options.defaultUserId ? { userId: options.defaultUserId } : {}), host: options.host });
    application = new DataAgentApplication(runtime, sessions, metadata, workspace, knowledge, agent, options.queryExecutor);
    if (sessions.sessionStore) runtime.attachSessionStore(sessions.sessionStore);
    runtime.attachAgent(agent);
    if (options.queryExecutor) application.setQueryExecutor(options.queryExecutor);
    return application;
  }

  get authService(): ApplicationAuthService { return this.runtime.authService; }
  get pythonExecutablePath(): string | undefined { return this.runtime.pythonExecutablePath; }
  get clarificationManager(): ClarificationManager { return this.runtime.clarificationManager; }

  async dispatch(command: DataAgentCommandEnvelope, context: RequestContext): Promise<DataAgentResponseEnvelope> {
    const commandRecord = command.command as unknown as Record<string, unknown>;
    const sessionIds = [...new Set([
      command.sessionId,
      context.sessionId,
      typeof commandRecord.sessionId === "string" ? commandRecord.sessionId : undefined,
    ].filter((value): value is string => Boolean(value)))];
    for (const sessionId of sessionIds) {
      if (await this.metadata.authorizeSession(context.userId, sessionId) !== "owned") throw new Error("SESSION_ACCESS_DENIED");
    }
    return this.runtime.dispatch(command, context);
  }
  subscribe(listener: (event: DataAgentEventEnvelope) => void, filter?: ApplicationEventFilter): () => void { return this.runtime.subscribe(listener, filter); }
  replayAfter(sequence: number, filter?: ApplicationEventFilter): EventReplay { return this.runtime.replayAfter(sequence, filter); }

  getConfig(key: string): Promise<unknown> { return this.metadata.getConfig(key); }
  setConfig(key: string, value: unknown): Promise<void> { return this.metadata.setConfig(key, value); }
  authorizeSession(userId: string, sessionId: string): Promise<"owned" | "missing" | "forbidden"> { return this.metadata.authorizeSession(userId, sessionId); }
  /** The channel boundary over this Application's protocol seam and metadata (ADR-0011). */
  createChannelHub(options: Omit<ChannelHubOptions, "host" | "store"> = {}): ChannelHub { return new ChannelHub({ ...options, host: this, store: new MetadataChannelStore(this.metadata) }); }
  readPublication(publicationId: string, context: { readonly sessionId: string; readonly userId: string }) { return this.agent.readPublication(publicationId, context); }

  setQueryExecutor(executor: NonNullable<DataAgentApplicationOptions["queryExecutor"]>): void {
    this.queryExecutorPort = executor;
    this.runtime.queryExecutor = {
      run: async (sql, rowLimit, runOptions) => {
        const port = this.queryExecutorPort;
        if (!port) throw new Error("QUERY_EXECUTOR_NOT_CONFIGURED");
        const resolved = typeof port === "function" ? await port() : port;
        return resolved.run(sql, rowLimit, runOptions);
      },
    };
  }
  setHostTesters(ports: HostTestPorts): void {
    if (ports.dbTester) this.runtime.dbTester = ports.dbTester;
    if (ports.llmTester) this.runtime.llmTester = ports.llmTester;
  }
  setIngestJob(job: IngestJobPort): void { this.runtime.ingestJob = job; }
  getResources(): ApplicationResources { return this.agent.getResources(); }
  setResources(resources: ApplicationResources): Promise<void> { return this.agent.setResources(resources); }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.sessions.close();
    await this.metadata.close();
  }
}

export async function createDataAgentApplication(options: DataAgentApplicationOptions): Promise<DataAgentApplication> {
  return DataAgentApplication.create(options);
}

export type { ApplicationAgentAdapter, ApplicationAgentEvent, ApplicationResources, HostRequestContext };
