import { randomUUID } from "node:crypto";

export interface PendingClarification {
  clarificationId: string;
  sessionId: string;
  question: string;
  options: string[];
  resolve: (answer: string) => void;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * One pending clarification per session. Waits live in the runtime (surviving
 * renderer disconnects), expires on timeout, and is cancelled by stop/abort.
 * Application restart drops pending waits — they are marked interrupted rather
 * than pretending to resume an in-flight tool call.
 */
export class ClarificationManager {
  private readonly pending = new Map<string, PendingClarification>();

  constructor(private readonly defaultTimeoutMs = 10 * 60 * 1000) {}

  ask(sessionId: string, question: string, options: string[], timeoutMs?: number): { clarificationId: string; promise: Promise<string> } {
    this.cancel(sessionId, "cancelled");
    const clarificationId = randomUUID();
    let resolve!: (answer: string) => void;
    const promise = new Promise<string>((res) => { resolve = res; });
    const entry: PendingClarification = { clarificationId, sessionId, question, options, resolve };
    entry.timer = setTimeout(() => {
      if (this.pending.get(clarificationId) !== entry) return;
      this.pending.delete(clarificationId);
      resolve("");
      this.onSettled?.(clarificationId, "expired");
    }, timeoutMs ?? this.defaultTimeoutMs);
    this.pending.set(clarificationId, entry);
    this.onAsked?.({ clarificationId, sessionId, question, options });
    return { clarificationId, promise };
  }

  onSettled?: (clarificationId: string, outcome: "answered" | "expired" | "cancelled") => void;
  onAsked?: (request: { clarificationId: string; sessionId: string; question: string; options: string[] }) => void;

  answer(clarificationId: string, answer: string): boolean {
    const entry = this.pending.get(clarificationId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(clarificationId);
    entry.resolve(answer);
    this.onSettled?.(clarificationId, "answered");
    return true;
  }

  cancel(sessionId: string, outcome: "cancelled" | "expired" = "cancelled"): void {
    for (const [id, entry] of [...this.pending.entries()]) {
      if (entry.sessionId === sessionId) {
        clearTimeout(entry.timer);
        this.pending.delete(id);
        entry.resolve("");
        this.onSettled?.(id, outcome);
      }
    }
  }

  isPending(sessionId: string): boolean {
    for (const entry of this.pending.values()) if (entry.sessionId === sessionId) return true;
    return false;
  }

  /** Application restart: nothing survives process death. */
  dropAll(): void {
    for (const [id, entry] of [...this.pending.entries()]) {
      clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.resolve("");
      this.onSettled?.(id, "cancelled");
    }
  }
}
