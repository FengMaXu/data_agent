import { randomUUID } from "node:crypto";

/** Runtime modes are explicit so Review Off cannot be confused with Shadow Review. */
export type QueryAssuranceMode = "off" | "shadow" | "enforce";

/**
 * Evidence available while preparing a free-SQL Query Task.
 *
 * The open record keeps this first seam extensible; later slices add the
 * concrete reviewed-model, task-document, clarification and schema evidence
 * types without making AgentAssembly know about those collaborators.
 */
export interface TaskEvidence {
  readonly question: string;
  readonly [key: string]: unknown;
}

/** The task identity returned by Query Assurance before a query is executed. */
export interface PreparedQueryTask {
  readonly taskId: string;
  readonly mode: QueryAssuranceMode;
}

/** Opaque publication input; candidate details belong to later assurance slices. */
export interface PublicationReviewRequest {
  readonly task: PreparedQueryTask;
  readonly candidate: unknown;
}

export type ReviewDecisionStatus = "approved" | "rejected" | "needs_clarification" | "abstained";

/** The available decision envelope, intentionally without reviewer internals. */
export interface ReviewDecision {
  readonly status: ReviewDecisionStatus;
}

export interface ReviewFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

/** Separates a successful reviewer decision from a reviewer that could not run. */
export type ReviewOutcome =
  | { readonly availability: "available"; readonly decision: ReviewDecision }
  | { readonly availability: "unavailable"; readonly failure: ReviewFailure };

export interface QueryAssurance {
  readonly mode: QueryAssuranceMode;
  prepareTask(input: TaskEvidence, signal: AbortSignal): Promise<PreparedQueryTask>;
  reviewForPublication(input: PublicationReviewRequest, signal: AbortSignal): Promise<ReviewOutcome>;
}

export class QueryAssuranceAbortError extends Error {
  readonly code = "QUERY_ASSURANCE_ABORTED";

  constructor() {
    super("Query Assurance operation was aborted");
    this.name = "AbortError";
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new QueryAssuranceAbortError();
}

/**
 * The default implementation preserves the existing delivery behavior while
 * making the absence of review explicit. It never fabricates an Approved
 * decision from Review Off.
 */
export function createReviewOffQueryAssurance(): QueryAssurance {
  return {
    mode: "off",
    async prepareTask(_input, signal) {
      throwIfAborted(signal);
      return { taskId: randomUUID(), mode: "off" };
    },
    async reviewForPublication(_input, signal) {
      throwIfAborted(signal);
      return {
        availability: "unavailable",
        failure: {
          code: "REVIEW_OFF",
          message: "Query Assurance review is disabled",
          retryable: false,
        },
      };
    },
  };
}
