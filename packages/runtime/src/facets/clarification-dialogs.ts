import type { ClarificationManager } from "../clarification.js";

export interface ClarificationDialog {
  readonly clarificationId: string;
  readonly sessionId: string;
  readonly question: string;
  readonly options: readonly string[];
  /** The user's answer, already recorded in the ledger; empty when the question expired or was cancelled. */
  readonly promise: Promise<string>;
  cancel(): boolean;
}

/** A question the user answered: what they were asked and what they said. */
export interface AnsweredClarification {
  readonly clarificationId: string;
  readonly question: string;
  readonly options: readonly string[];
  readonly answer: string;
  readonly answeredAt: string;
}

/**
 * Durable record of the user's answers in the asking Session. An answer is
 * something the user said, so Evidence Admission can verify a confirmation
 * against it the way it verifies one against a chat message.
 */
export interface ClarificationLedger {
  record(answered: AnsweredClarification): Promise<void>;
  read(clarificationId: string): Promise<AnsweredClarification | undefined>;
}

/**
 * Session-owned keyed clarification facade; UI connections are observers only.
 * Request/settled events reach clients from the Runtime, which subscribes to
 * the shared manager and tags each event with the asking Session.
 */
export class ClarificationDialogs {
  private readonly dialogs = new Map<string, ClarificationDialog>();

  constructor(
    private readonly manager: ClarificationManager,
    private readonly ledger?: ClarificationLedger,
  ) {}

  ask(sessionId: string, question: string, options: readonly string[] = [], timeoutMs?: number): ClarificationDialog {
    const request = this.manager.ask(sessionId, question, [...options], timeoutMs);
    const clarificationId = request.clarificationId;
    // Recorded before the asker sees the answer, so anything it cites already exists.
    const answered = request.promise.then(async (answer) => {
      if (answer && this.ledger) await this.ledger.record({ clarificationId, question, options: [...options], answer, answeredAt: new Date().toISOString() });
      return answer;
    });
    const dialog: ClarificationDialog = {
      clarificationId,
      sessionId,
      question,
      options: [...options],
      promise: answered.finally(() => this.dialogs.delete(clarificationId)),
      cancel: () => this.manager.cancelById(clarificationId, "cancelled"),
    };
    this.dialogs.set(clarificationId, dialog);
    return dialog;
  }

  answer(clarificationId: string, answer: string): boolean {
    return this.manager.answer(clarificationId, answer);
  }

  get(clarificationId: string): ClarificationDialog | undefined {
    return this.dialogs.get(clarificationId);
  }

  list(sessionId?: string): readonly ClarificationDialog[] {
    return [...this.dialogs.values()].filter((dialog) => !sessionId || dialog.sessionId === sessionId);
  }

  /** An answer this Session recorded; undefined for unknown, unanswered or foreign ids. */
  read(clarificationId: string): Promise<AnsweredClarification | undefined> {
    return this.ledger?.read(clarificationId) ?? Promise.resolve(undefined);
  }
}
