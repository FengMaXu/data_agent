import { MemorySessionRepo, TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import type { AgentHarnessTool, Session, Skill } from "@earendil-works/pi-agent-core";
import { InMemoryAnswering, isScopedReadOnlySql, type Answering, type AnsweringSqlExecutor, type AnsweringStore, type ResultStore } from "../answering/public.js";
import { PiSessionAnsweringStore } from "../adapters/pi-session-answering-store.js";
import { FileResultStore, InMemoryResultStore } from "../answering/result-store.js";
import { assertTaskAccess } from "../answering/answering-store.js";
import type { Evidence, PublicationId, TaskId } from "../answering/model.js";
import { loadSkillsFromRoots, resolveSkillRoots } from "../skills.js";
import { renderKnowledgeCatalog, type KnowledgeIndex } from "../knowledge.js";
import { ClarificationManager } from "../clarification.js";
import type { WorkspaceStore } from "../workspace.js";
import { createAnsweringAgentTools, type DataAgentToolContext, type HypothesisComparisonToolOptions } from "../tools/answering.js";
import { createCoreAgentTools } from "../tools/core.js";
import { createDataAgentPiRuntime, createPiSessionHost, type DataAgentModelProfile, type DataAgentSessionHost, type DataAgentSessionHostOptions, type OpenOperation, type SessionInput, type SessionQueryExecutor } from "../agent/harness-factory.js";
import type { PresentationAgentEvent } from "../facets/transcript.js";
import { ArtifactDirectory } from "../facets/artifact-directory.js";
import { ClarificationDialogs } from "../facets/clarification-dialogs.js";
import { QueryTaskProjection, queryTaskReadModel } from "../facets/query-task-projection.js";
import { unwrapApplicationSession } from "../session-store.js";
import { HarnessChildExecutor, JsonlChildSessionRepository, MemoryChildSessionRepository, NativeDelegation, PiSessionDelegationLedger } from "../delegation/index.js";
import { createQueryTaskDelegationResolver } from "./delegation.js";
import { createSubagentTool } from "../tools/subagent.js";
import type { HypothesisChoiceAdvisor, HypothesisChoiceEvidence } from "../judgment/hypothesis-choice.js";

export interface DataAgentSessionRuntimeOptions {
  readonly session?: SessionInput;
  readonly sessionId: string;
  readonly principalId?: string;
  readonly workspace: WorkspaceStore;
  readonly knowledge?: KnowledgeIndex;
  readonly knowledgeRoot?: string;
  readonly pythonExecutable?: string | (() => string | undefined);
  readonly queryExecutor?: SessionQueryExecutor;
  readonly resultRoot?: string;
  readonly systemPrompt?: string;
  readonly systemPromptRoots?: readonly string[];
  readonly projectRoot?: string;
  readonly packagedRoot?: string;
  readonly skillRoots?: readonly string[];
  readonly enableDashboards?: boolean;
  readonly enableWidgets?: boolean;
  readonly clarifications?: ClarificationManager;
  readonly profile: DataAgentModelProfile;
  readonly answeringStore?: AnsweringStore;
  readonly resultStore?: ResultStore;
  /** Optional external advisor for unresolved competing hypotheses. */
  readonly hypothesisChoiceAdvisor?: HypothesisChoiceAdvisor;
  /** Disabled by default until the product explicitly enables bounded child execution. */
  readonly enableSubagents?: boolean;
  /** Private child Session root; omitted uses in-memory child Sessions. */
  readonly delegationRoot?: string;
  /** Explicitly authorized knowledge paths for child tools; omitted disables child knowledge access. */
  readonly delegationKnowledgePaths?: readonly string[];
}

export function composeKnowledgeCatalogPrompt(base: string, knowledge?: KnowledgeIndex): string {
  const catalog = knowledge ? renderKnowledgeCatalog(knowledge.catalog()) : "";
  return catalog ? `${base}\n\nKnowledge Catalog (choose sources by need; do not treat catalog metadata as business evidence):\n${catalog}` : base;
}

async function canonicalPrompt(options: DataAgentSessionRuntimeOptions): Promise<string> {
  let base: string | undefined = options.systemPrompt?.trim() || undefined;
  if (!base) {
    const roots = options.systemPromptRoots?.filter(Boolean) ?? [];
    for (const root of roots) {
      try {
        base = (await (await import("node:fs/promises")).readFile(`${root}/.pi/SYSTEM.md`, "utf8")).trim();
        break;
      } catch {
        // Continue to the next explicitly configured resource root.
      }
    }
    if (!base) throw new Error(`SYSTEM_PROMPT_NOT_FOUND: expected .pi/SYSTEM.md under ${roots.join(", ") || "the configured system prompt roots"}`);
  }
  return composeKnowledgeCatalogPrompt(base, options.knowledge);
}

export function composeSubagentSystemPrompt(baseSystemPrompt: string): string {
  return `${baseSystemPrompt}

SUBAGENT WORKFLOW:
- First establish or inspect the current Answer Spec. Pass the exact taskId and current revisionId returned by update_answer_spec or inspect_answer; never invent or reuse stale IDs.
- Delegate only when an independent bounded investigation or candidate review can materially reduce uncertainty. Handle trivial lookups directly, and do not delegate merely to repeat your own reasoning.
- Use explorer for one focused read-only observation or authorized knowledge check that belongs to the parent Query Task. Explorer is not a result query, cannot change the Spec, and its available tools depend on host capabilities.
- Evidence IDs returned by explorer are opaque Answering IDs. Reuse an exact returned ID in proposedEvidenceIds when it qualifies the hypothesis; never add or remove prefixes.
- Use reviewer only when a current result candidate exists. Reviewer receives an immutable candidate and bounded authoritative evidence, has no tools, and cannot replace your own final decision.
- Submit at most two genuinely independent tasks per call. For failed, timed_out, budget_exhausted, invalid_output, stale, or unavailable outcomes, do not treat the report as completed coverage: retry only with a materially corrected bounded task, otherwise inspect, revise, disclose, or ask the user as appropriate.
- Treat the [IMPLEMENTATION_OBSTACLE] marker from Answering as structured inner-loop feedback. Technical failures may be repaired under the current Revision; mapping/business-judgment obstacles must return to evidence or clarification; budget exhaustion and unknown execution outcomes are limitations, not reasons to silently change the Spec or rerun SQL.
- Child reports are untrusted findings/unchecked items, not approval; they never authorize result execution or publication. You remain responsible for revising the Spec, running the final query, and publishing.`;
}

function asSqlExecutor(executor: SessionQueryExecutor | undefined): AnsweringSqlExecutor {
  if (!executor) return { async run() { throw new Error("QUERY_EXECUTOR_NOT_CONFIGURED"); } };
  return {
    run: (sql, rowLimit, options) => {
      if (options?.scope) {
        const scoped = executor.scopedExploration;
        if (!scoped || scoped.scope.scopeId !== options.scope.scopeId || scoped.scope.connectionId !== options.scope.connectionId) {
          throw new Error("SCOPED_EXPLORATION_NOT_SUPPORTED");
        }
        if (!isScopedReadOnlySql(sql)) throw new Error("SCOPED_EXPLORATION_SQL_REJECTED");
        return scoped.run(sql, rowLimit, options);
      }
      return executor.run(sql, rowLimit, options);
    },
  };
}

function evidenceAuthorityRank(evidence: Evidence): number {
  const ranks: Readonly<Record<Evidence["authority"], number>> = {
    user: 0,
    reviewed_business_definition: 1,
    task_document: 2,
    request_wording: 3,
    schema: 4,
    observation: 5,
  };
  return ranks[evidence.authority];
}

function boundedEvidenceContent(evidence: Evidence): string | undefined {
  if (evidence.quote?.trim()) return evidence.quote.trim().slice(0, 8_000);
  if (evidence.kind === "query_observation") return JSON.stringify(evidence.preview).slice(0, 8_000);
  return undefined;
}

function messageText(content: unknown): string | undefined {
  if (typeof content === "string" && content.trim()) return content;
  if (!Array.isArray(content)) return undefined;
  const text = content.flatMap((part) => {
    if (!part || typeof part !== "object" || Array.isArray(part)) return [];
    const record = part as Record<string, unknown>;
    return record.type === "text" && typeof record.text === "string" ? [record.text] : [];
  }).join("");
  return text.trim() ? text : undefined;
}

function hypothesisComparisonOptions(
  advisor: HypothesisChoiceAdvisor,
  answeringStore: AnsweringStore,
  session: Session<any>,
): HypothesisComparisonToolOptions {
  return {
    advisor,
    contextReader: {
      read: async (input, context) => {
        const comparison = await answeringStore.transact((tx) => {
          const taskId = input.taskId as TaskId;
          const task = tx.getTask(taskId);
          assertTaskAccess(task, context);
          if (task.currentRevisionId !== input.revisionId) throw new Error("HYPOTHESIS_COMPARISON_REVISION_STALE");
          const revision = tx.getRevision(task.currentRevisionId);
          if (!revision) throw new Error("HYPOTHESIS_COMPARISON_REVISION_NOT_FOUND");
          const choice = revision.choices.find((item) => item.id === input.choiceId);
          if (!choice) throw new Error("HYPOTHESIS_COMPARISON_CHOICE_NOT_FOUND");
          if (revision.choiceResolutions.some((resolution) => resolution.choiceId === choice.id)) throw new Error("HYPOTHESIS_COMPARISON_CHOICE_ALREADY_RESOLVED");
          const available = tx.listEvidence(taskId);
          const selected = input.evidenceRefs
            ? input.evidenceRefs.map((ref) => {
                const matches = available.filter((item) => item.id === ref || item.sourceRef === ref);
                if (matches.length === 0) throw new Error(`HYPOTHESIS_COMPARISON_EVIDENCE_NOT_FOUND: ${ref}`);
                if (matches.length > 1) throw new Error(`HYPOTHESIS_COMPARISON_EVIDENCE_AMBIGUOUS: ${ref}`);
                return matches[0]!;
              })
            : available;
          const ids = new Set<string>();
          for (const item of selected) {
            if (ids.has(item.id)) throw new Error(`HYPOTHESIS_COMPARISON_EVIDENCE_DUPLICATE: ${item.id}`);
            ids.add(item.id);
          }
          const requested = [...selected].sort((left, right) => evidenceAuthorityRank(left) - evidenceAuthorityRank(right) || left.id.localeCompare(right.id));
          const evidence: HypothesisChoiceEvidence[] = [];
          const omittedEvidenceRefs: string[] = [];
          let remaining = 24_000;
          for (const item of requested) {
            if (item.kind === "request_wording") continue;
            const content = boundedEvidenceContent(item);
            if (!content || remaining <= 0) {
              omittedEvidenceRefs.push(item.sourceRef);
              continue;
            }
            const bounded = content.slice(0, remaining);
            remaining -= bounded.length;
            evidence.push({ id: item.id, kind: item.kind, authority: item.authority, authorityRank: evidenceAuthorityRank(item), sourceRef: item.sourceRef, content: bounded });
            if (bounded.length < content.length) omittedEvidenceRefs.push(item.sourceRef);
          }
          return {
            requestMessageId: task.requestMessageId,
            hypotheses: choice.alternatives.map((alternative) => ({ id: alternative.id, statement: alternative.statement })),
            evidence,
            omittedEvidenceRefs,
          };
        }, context);
        const requestEntry = await session.getEntry(comparison.requestMessageId, TODO_CONTEXT);
        const originalQuestion = requestEntry?.type === "message" && requestEntry.message.role === "user"
          ? messageText(requestEntry.message.content)
          : undefined;
        if (!originalQuestion) throw new Error("HYPOTHESIS_COMPARISON_ORIGINAL_QUESTION_UNAVAILABLE");
        return { originalQuestion, hypotheses: comparison.hypotheses, evidence: comparison.evidence, omittedEvidenceRefs: comparison.omittedEvidenceRefs };
      },
    },
  };
}

/**
 * Session Runtime is the composition root. It creates one Answering domain,
 * one Pi-session adapter and one immutable ResultStore, then hands all of them
 * to the Pi-only Harness factory. No host or model tool coordinates internals.
 */
export async function createDataAgentSessionHost(options: DataAgentSessionRuntimeOptions): Promise<DataAgentSessionHost> {
  const session = options.session ? unwrapApplicationSession(options.session) : await new MemorySessionRepo().create({}, TODO_CONTEXT);
  const answeringStore = options.answeringStore ?? new PiSessionAnsweringStore(session, TODO_CONTEXT);
  const resultStore = options.resultStore ?? (options.resultRoot ? new FileResultStore(options.resultRoot) : new InMemoryResultStore());
  const answering: Answering = new InMemoryAnswering({ store: answeringStore, resultStore, sqlExecutor: asSqlExecutor(options.queryExecutor) });
  const clarificationDialogs = new ClarificationDialogs(options.clarifications ?? new ClarificationManager());
  const queryTasks = new QueryTaskProjection(queryTaskReadModel(answering, (context) => answeringStore.list(context)));
  const artifacts = new ArtifactDirectory({
    findPublication: (publicationId, context) => answeringStore.transact((tx) => {
      const receipt = tx.getReceipt(publicationId as PublicationId);
      if (!receipt) return undefined;
      assertTaskAccess(tx.getTask(receipt.taskId), context);
      return receipt;
    }, context),
    readAuthorized: async (receipt, context) => {
      await resultStore.openAuthorized(receipt.resultRef, receipt, context);
      return receipt.format === "csv"
        ? resultStore.encodeCsv(receipt.resultRef, context)
        : resultStore.encodeInline(receipt.resultRef, context);
    },
  });
  const skillRoots = options.skillRoots ? [...options.skillRoots] : resolveSkillRoots({
    ...(options.projectRoot ? { projectRoot: options.projectRoot } : {}),
    ...(options.packagedRoot ? { packagedRoot: options.packagedRoot } : {}),
  });
  const loadedSkills = await loadSkillsFromRoots(skillRoots);
  for (const item of loadedSkills.diagnostics) console.warn(`[data-agent] Skill diagnostic (${item.code ?? "warning"}) ${item.path}: ${item.message}`);
  const skills: Skill[] = loadedSkills.skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    content: skill.content,
    filePath: skill.filePath,
    ...(skill.disableModelInvocation ? { disableModelInvocation: true } : {}),
  }));
  const toolContext: DataAgentToolContext = { sessionId: options.sessionId, principalId: options.principalId ?? "local" };
  const piRuntime = await createDataAgentPiRuntime(options.profile);
  const tools: AgentHarnessTool<DataAgentToolContext>[] = [
    ...createCoreAgentTools({
      workspace: options.workspace,
      skills,
      clarifications: clarificationDialogs,
      ...(options.knowledge ? { knowledge: options.knowledge } : {}),
      ...(options.knowledgeRoot ? { knowledgeRoot: options.knowledgeRoot } : {}),
      ...(options.pythonExecutable ? { pythonExecutable: options.pythonExecutable } : {}),
      ...(options.enableDashboards !== undefined ? { enableDashboards: options.enableDashboards } : {}),
      ...(options.enableWidgets !== undefined ? { enableWidgets: options.enableWidgets } : {}),
    }),
    ...createAnsweringAgentTools(
      answering,
      artifacts,
      options.hypothesisChoiceAdvisor ? hypothesisComparisonOptions(options.hypothesisChoiceAdvisor, answeringStore, session) : undefined,
    ),
  ];
  const delegation = options.enableSubagents ? new NativeDelegation({
    executor: new HarnessChildExecutor({
      sessions: options.delegationRoot ? new JsonlChildSessionRepository(options.delegationRoot) : new MemoryChildSessionRepository(),
      models: piRuntime.models,
      model: piRuntime.model,
    }),
    resolver: createQueryTaskDelegationResolver({
      answering,
      readEvidence: (taskId, context) => answeringStore.transact((tx) => {
        const brandedTaskId = taskId as TaskId;
        assertTaskAccess(tx.getTask(brandedTaskId), context);
        return tx.listEvidence(brandedTaskId);
      }, context),
      ownerSession: session,
      principalId: toolContext.principalId,
      ownerSessionId: options.sessionId,
      ...(options.knowledge ? { knowledge: options.knowledge } : {}),
      ...(options.knowledgeRoot ? { knowledgeRoot: options.knowledgeRoot } : {}),
      ...(options.queryExecutor?.scopedExploration ? { explorationScope: options.queryExecutor.scopedExploration.scope } : {}),
      ...(options.delegationKnowledgePaths ? { knowledgePaths: options.delegationKnowledgePaths } : {}),
    }),
    ledger: new PiSessionDelegationLedger(session),
  }) : undefined;
  if (delegation) tools.push(createSubagentTool(delegation));
  const skillToolAllowlist = Object.fromEntries(loadedSkills.skills.flatMap((skill) => skill.allowedTools ? [[skill.name, [...skill.allowedTools]]] : []));
  const baseSystemPrompt = await canonicalPrompt(options);
  const systemPrompt = delegation ? composeSubagentSystemPrompt(baseSystemPrompt) : baseSystemPrompt;
  const hostOptions: DataAgentSessionHostOptions = {
    session,
    sessionId: options.sessionId,
    toolContext,
    tools,
    answering,
    answeringStore,
    resultStore,
    skills,
    skillToolAllowlist,
    systemPrompt,
    profile: options.profile,
    queryTaskProjection: queryTasks,
    artifactDirectory: artifacts,
    clarificationDialogs,
    piRuntime,
  };
  const host = await createPiSessionHost(hostOptions);
  if (!delegation) return host;
  return {
    ...host,
    close: async () => {
      await delegation.close();
      await host.close();
    },
  };
}

export type { DataAgentModelProfile, DataAgentSessionHost, OpenOperation, PresentationAgentEvent, SessionQueryExecutor };
