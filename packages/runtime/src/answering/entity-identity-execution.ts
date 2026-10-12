import { clone, contentHash, type AnswerRevisionView, type BusinessContext, type RevisionId, type TaskId } from "./model.js";
import { assertTaskAccess } from "./answering-store.js";
import type { AnsweringDeps } from "./deps.js";
import {
  ENTITY_IDENTITY_MAX_ROWS,
  evaluateEntityIdentity,
  identityQueries,
  identityTargets,
  type EntityIdentityReport,
  type IdentityTarget,
  type TableIdentityObservation,
} from "./entity-identity.js";

function sameTarget(observation: TableIdentityObservation, target: IdentityTarget): boolean {
  return observation.table === target.table && JSON.stringify(observation.keyColumns ?? []) === JSON.stringify(target.keyColumns ?? []);
}

async function count(deps: AnsweringDeps, sql: string, context: BusinessContext): Promise<number> {
  const result = await deps.sqlExecutor.run(sql, 1, {
    kind: "exploration",
    idempotencyKey: `entity-identity:${contentHash({ sql })}`,
    ...(context.signal ? { signal: context.signal } : {}),
    ...(context.deadlineAt ? { deadlineAt: context.deadlineAt } : {}),
    ...(context.queryScope ? { scope: context.queryScope } : {}),
  });
  const value = Number(result.rows[0]?.[0]);
  if (!Number.isFinite(value)) throw new Error("count was not a number");
  return value;
}

async function observe(deps: AnsweringDeps, target: IdentityTarget, context: BusinessContext): Promise<TableIdentityObservation> {
  const queries = identityQueries(target);
  const base = { table: target.table, ...(target.keyColumns ? { keyColumns: target.keyColumns } : {}) };
  let rows: number;
  try {
    rows = await count(deps, queries.rows, context);
  } catch (error) {
    if (context.signal?.aborted) throw error;
    return { ...base, limitation: "the table could not be counted" };
  }
  if (rows > ENTITY_IDENTITY_MAX_ROWS) return { ...base, rows, limitation: `more than ${ENTITY_IDENTITY_MAX_ROWS} rows; distinct counts skipped` };
  let distinctRows: number | undefined;
  let distinctKeys: number | undefined;
  const limitations: string[] = [];
  try {
    distinctRows = await count(deps, queries.distinctRows, context);
  } catch (error) {
    if (context.signal?.aborted) throw error;
    limitations.push("distinct rows could not be counted");
  }
  if (queries.distinctKeys) {
    try {
      distinctKeys = await count(deps, queries.distinctKeys, context);
    } catch (error) {
      if (context.signal?.aborted) throw error;
      // A key the table does not have is normal for a multi-table source.
    }
  }
  return {
    ...base,
    rows,
    ...(distinctRows !== undefined ? { distinctRows } : {}),
    ...(distinctKeys !== undefined ? { distinctKeys } : {}),
    ...(limitations.length > 0 ? { limitation: limitations.join("; ") } : {}),
  };
}

/**
 * Post-commit entity identity counts for one Revision. Observations of the
 * same table and key are carried from the parent Revision, so a Revision that
 * does not change the entity or source runs no query. A failed count is a
 * limitation; it never fails the set call or changes qualification.
 */
export async function attachEntityIdentity(
  deps: AnsweringDeps,
  view: AnswerRevisionView,
  context: BusinessContext,
): Promise<AnswerRevisionView> {
  // Nothing to count without a settled entity and source; skip without touching the store.
  const settledPath = (path: string) => view.fields.some((field) => field.path === path && field.value !== undefined && field.status !== "open" && field.status !== "not_applicable");
  if (!settledPath("population.entity") || !settledPath("population.source")) return view;
  const taskId = view.taskId as TaskId;
  const revisionId = view.revisionId as RevisionId;
  const snapshot = await deps.store.transact((tx) => {
    assertTaskAccess(tx.getTask(taskId), context);
    const revision = tx.getRevision(revisionId);
    const parent = revision?.parentRevisionId ? tx.getRevision(revision.parentRevisionId) : undefined;
    return { revision, carried: parent?.entityIdentity?.observations ?? [] };
  }, context);
  if (!snapshot.revision || snapshot.revision.entityIdentity) return view;
  const { targets, limitations } = identityTargets(snapshot.revision.fields);
  const observations: TableIdentityObservation[] = [];
  for (const target of targets) {
    observations.push(snapshot.carried.find((item) => sameTarget(item, target)) ?? await observe(deps, target, context));
  }
  const report: EntityIdentityReport = evaluateEntityIdentity(snapshot.revision.fields, observations, limitations);
  try {
    await deps.store.transact((tx) => {
      const revision = tx.getRevision(revisionId);
      if (!revision || revision.entityIdentity) return;
      tx.putRevision({ ...revision, entityIdentity: report });
    }, context);
  } catch (error) {
    if (context.signal?.aborted) throw error;
    return view;
  }
  return { ...view, entityIdentity: clone(report) };
}
