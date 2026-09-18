import { randomUUID } from "node:crypto";

export interface ClarificationContext {
  taskId?: string;
  baseRevisionId?: string;
  hypothesisId?: string;
  decisionId?: string;
  alternativeId?: string;
}

export interface AnsweredClarificationEvent extends ClarificationContext {
  clarificationId: string;
  sessionId: string;
  question: string;
  answer: string;
  outcome: "answered";
  settledAt: string;
}

export interface PendingClarification {
  clarificationId: string;
  sessionId: string;
  question: string;
  options: string[];
  resolve: (answer: string) => void;
  timer?: ReturnType<typeof setTimeout>;
  context?: ClarificationContext;
}

/**
 * One pending clarification per session. Waits live in the runtime (surviving
 * renderer disconnects), expires on timeout, and is cancelled by stop/abort.
 * Application restart drops pending waits — they are marked interrupted rather
 * than pretending to resume an in-flight tool call.
 */
export class ClarificationManager {
  private readonly pending = new Map<string, PendingClarification>();
  private readonly answered = new Map<string, AnsweredClarificationEvent>();

  constructor(private readonly defaultTimeoutMs = 10 * 60 * 1000) {}

  ask(sessionId: string, question: string, options: string[], timeoutMs?: number, context?: ClarificationContext): { clarificationId: string; promise: Promise<string> } {
    this.cancel(sessionId, "cancelled");
    const clarificationId = randomUUID();
    let resolve!: (answer: string) => void;
    const promise = new Promise<string>((res) => { resolve = res; });
    const entry: PendingClarification = { clarificationId, sessionId, question, options, resolve, ...(context ? { context: { ...context } } : {}) };
    entry.timer = setTimeout(() => {
      if (this.pending.get(clarificationId) !== entry) return;
      this.pending.delete(clarificationId);
      resolve("");
      this.onSettled?.(clarificationId, "expired", { sessionId: entry.sessionId });
    }, timeoutMs ?? this.defaultTimeoutMs);
    this.pending.set(clarificationId, entry);
    this.onAsked?.({ clarificationId, sessionId, question, options });
    return { clarificationId, promise };
  }

  onSettled?: (clarificationId: string, outcome: "answered" | "expired" | "cancelled", context?: { sessionId: string }) => void;
  onAsked?: (request: { clarificationId: string; sessionId: string; question: string; options: string[] }) => void;

  answer(clarificationId: string, answer: string): boolean {
    const entry = this.pending.get(clarificationId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(clarificationId);
    this.answered.set(clarificationId, { clarificationId, sessionId: entry.sessionId, question: entry.question, answer, outcome: "answered", settledAt: new Date().toISOString(), ...entry.context });
    entry.resolve(answer);
    this.onSettled?.(clarificationId, "answered", { sessionId: entry.sessionId });
    return true;
  }

  getAnswered(clarificationId: string): AnsweredClarificationEvent | undefined {
    const event = this.answered.get(clarificationId);
    return event ? { ...event } : undefined;
  }

  consumeForTask(clarificationId: string, expected: ClarificationContext): AnsweredClarificationEvent | undefined {
    const event = this.answered.get(clarificationId);
    if (!event || event.taskId !== expected.taskId || event.baseRevisionId !== expected.baseRevisionId || event.hypothesisId !== expected.hypothesisId || event.decisionId !== expected.decisionId || event.alternativeId !== expected.alternativeId) return undefined;
    this.answered.delete(clarificationId);
    return { ...event };
  }

  consumeAnswered(clarificationId: string): AnsweredClarificationEvent | undefined {
    const event = this.answered.get(clarificationId);
    if (!event) return undefined;
    this.answered.delete(clarificationId);
    return { ...event };
  }

  cancelById(clarificationId: string, outcome: "cancelled" | "expired" = "cancelled"): boolean {
    const entry = this.pending.get(clarificationId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(clarificationId);
    entry.resolve("");
    this.onSettled?.(clarificationId, outcome, { sessionId: entry.sessionId });
    return true;
  }

  cancel(sessionId: string, outcome: "cancelled" | "expired" = "cancelled"): void {
    for (const [id, entry] of [...this.pending.entries()]) {
      if (entry.sessionId === sessionId) this.cancelById(id, outcome);
    }
  }

  isPending(sessionId: string): boolean {
    for (const entry of this.pending.values()) if (entry.sessionId === sessionId) return true;
    return false;
  }

  /** Application restart: nothing survives process death. */
  dropAll(): void {
    this.answered.clear();
    for (const [id, entry] of [...this.pending.entries()]) {
      clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.resolve("");
      this.onSettled?.(id, "cancelled", { sessionId: entry.sessionId });
    }
  }
}
