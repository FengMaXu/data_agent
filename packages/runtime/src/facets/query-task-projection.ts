import type { AnswerTaskView, BusinessContext, QueryTaskRecord } from "../answering/model.js";

export interface QueryTaskProjectionTask {
  readonly taskId: string;
  readonly requestMessageId: string;
  readonly currentRevisionId: string;
  readonly phase: "spec" | "exploration" | "candidate" | "published" | "closed";
  readonly pendingClarifications: number;
  readonly latestCandidateId?: string;
  readonly publicationId?: string;
}

export interface QueryTaskProjectionState {
  readonly activeTaskId: string | null;
  readonly tasks: readonly QueryTaskProjectionTask[];
}

export interface QueryTaskReadModel {
  inspect(input: { readonly taskId: string }, context: BusinessContext): Promise<AnswerTaskView>;
  list?(context: BusinessContext): Promise<readonly QueryTaskRecord[]>;
}

function phaseOf(view: AnswerTaskView): QueryTaskProjectionTask["phase"] {
  if (view.task.lifecycle === "closed") return "closed";
  if (view.publication) return "published";
  if (view.candidate) return "candidate";
  return "spec";
}

function project(view: AnswerTaskView): QueryTaskProjectionTask {
  return {
    taskId: view.task.taskId,
    requestMessageId: view.task.requestMessageId,
    currentRevisionId: view.task.currentRevisionId,
    phase: phaseOf(view),
    pendingClarifications: 0,
    ...(view.candidate ? { latestCandidateId: view.candidate.candidateId } : {}),
    ...(view.publication ? { publicationId: view.publication.receiptId } : {}),
  };
}

/**
 * Read-only Session Facet. It can be discarded and rebuilt from Answering;
 * there is no writable phase field and no second task store here.
 */
export class QueryTaskProjection {
  private current: QueryTaskProjectionState = { activeTaskId: null, tasks: [] };

  constructor(private readonly source: QueryTaskReadModel) {}

  get state(): QueryTaskProjectionState { return this.current; }

  async refresh(taskIds: readonly string[], context: BusinessContext, activeTaskId: string | null = this.current.activeTaskId): Promise<QueryTaskProjectionState> {
    const views = await Promise.all(taskIds.map((taskId) => this.source.inspect({ taskId }, context).catch(() => undefined)));
    this.current = { activeTaskId, tasks: views.flatMap((view) => view ? [project(view)] : []) };
    return this.current;
  }

  async refreshFromIndex(context: BusinessContext, activeTaskId: string | null = this.current.activeTaskId): Promise<QueryTaskProjectionState> {
    if (!this.source.list) return this.current;
    const records = await this.source.list(context);
    return this.refresh(records.map((record) => record.taskId), context, activeTaskId);
  }

  async inspect(taskId: string, context: BusinessContext): Promise<AnswerTaskView> {
    return this.source.inspect({ taskId }, context);
  }
}

export function queryTaskReadModel(answering: QueryTaskReadModel, list?: QueryTaskReadModel["list"]): QueryTaskReadModel {
  return {
    inspect: (input, context) => answering.inspect(input, context),
    ...(list ? { list } : {}),
  };
}
