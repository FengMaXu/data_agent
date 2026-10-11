import { setValue, value, type Session } from "@earendil-works/pi-agent-core/harness/session";
import { TODO_CONTEXT, type Context } from "@earendil-works/pi-agent-core/harness/context";
import type { JsonValue } from "@earendil-works/chord";
import {
  ANSWERING_SNAPSHOT_VERSION,
  InMemoryAnsweringStore,
  type AnsweringStore,
  type AnsweringStoreSnapshot,
  type AnsweringTransaction,
} from "../answering/answering-store.js";
import type { AnswerTaskView, BusinessContext, TaskId, QueryTaskRecord } from "../answering/model.js";

const ANSWERING_STATE = value<JsonValue>("data-agent.answering", "state");

function encodeJson(valueToEncode: unknown): JsonValue {
  return JSON.parse(JSON.stringify(valueToEncode, (_key, valueToVisit) => typeof valueToVisit === "bigint" ? { __type: "bigint", value: valueToVisit.toString() } : valueToVisit)) as JsonValue;
}

function decodeJson(valueToDecode: unknown): unknown {
  return JSON.parse(JSON.stringify(valueToDecode), (_key, valueToVisit) => valueToVisit && typeof valueToVisit === "object" && valueToVisit.__type === "bigint" ? BigInt(valueToVisit.value) : valueToVisit);
}

function isSnapshot(valueToCheck: unknown): valueToCheck is AnsweringStoreSnapshot {
  if (!valueToCheck || typeof valueToCheck !== "object") return false;
  const record = valueToCheck as Record<string, unknown>;
  // Records of an earlier Answer Spec model are not read (ADR-0007).
  return record.version === ANSWERING_SNAPSHOT_VERSION && Array.isArray(record.tasks) && Array.isArray(record.revisions) && Array.isArray(record.evidence)
    && Array.isArray(record.candidates) && Array.isArray(record.receipts);
}

/**
 * Pi Session adapter for Answering. The domain module only sees AnsweringStore;
 * Pi namespaces and mutation contexts stop at this adapter boundary.
 *
 * Each write is a single native Session mutation. The in-memory delegate is
 * rebuilt from the Value inside that mutation, then replaced only after Pi
 * accepts the commit. It is therefore a cache, never a second write authority.
 */
export class PiSessionAnsweringStore implements AnsweringStore {
  private delegate = new InMemoryAnsweringStore();
  private loaded = false;
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly session: Session<any>,
    private readonly piContext: Context = TODO_CONTEXT,
  ) {}

  private async readSnapshot(): Promise<AnsweringStoreSnapshot | undefined> {
    const stored = await this.session.getValue(ANSWERING_STATE, this.piContext);
    const decoded = stored ? decodeJson(stored.value) : undefined;
    return isSnapshot(decoded) ? decoded : undefined;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    const stored = await this.readSnapshot();
    this.delegate = stored ? new InMemoryAnsweringStore(stored) : new InMemoryAnsweringStore();
    this.loaded = true;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.tail.then(operation, operation);
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  async transact<T>(command: (state: AnsweringTransaction) => T | Promise<T>, context: BusinessContext): Promise<T> {
    return this.enqueue(async () => {
      await this.load();
      let answer!: T;
      await this.session.mutate(async (mutator) => {
        // Read inside the mutation so a concurrent native Session writer cannot
        // silently overwrite the Answering Value between read and commit.
        const stored = await mutator.getValue(ANSWERING_STATE, this.piContext);
        const decoded = stored ? decodeJson(stored.value) : undefined;
        const current = isSnapshot(decoded) ? decoded : this.delegate.snapshot();
        const nextDelegate = new InMemoryAnsweringStore(current);
        answer = await nextDelegate.transact(command, context);
        await mutator.commit([setValue(ANSWERING_STATE, encodeJson(nextDelegate.snapshot()))], this.piContext);
        this.delegate = nextDelegate;
        this.loaded = true;
      }, this.piContext);
      return answer;
    });
  }

  async inspect(taskId: TaskId, context: BusinessContext): Promise<AnswerTaskView | undefined> {
    return this.enqueue(async () => {
      const stored = await this.readSnapshot();
      this.delegate = stored ? new InMemoryAnsweringStore(stored) : new InMemoryAnsweringStore();
      this.loaded = true;
      return this.delegate.inspect(taskId, context);
    });
  }

  async list(context: BusinessContext): Promise<readonly QueryTaskRecord[]> {
    return this.enqueue(async () => {
      const stored = await this.readSnapshot();
      this.delegate = stored ? new InMemoryAnsweringStore(stored) : new InMemoryAnsweringStore();
      this.loaded = true;
      return this.delegate.list(context);
    });
  }

  async listReferencedResultRefs(context: BusinessContext): Promise<readonly import("../answering/model.js").ResultCandidateRecord[]> {
    return this.enqueue(async () => {
      const stored = await this.readSnapshot();
      this.delegate = stored ? new InMemoryAnsweringStore(stored) : new InMemoryAnsweringStore();
      this.loaded = true;
      const tasks = await this.delegate.list(context);
      const visible = new Set(tasks.map((task) => task.taskId));
      return this.delegate.snapshot().candidates.filter((candidate) => visible.has(candidate.taskId));
    });
  }
}
