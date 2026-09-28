import type { ClarificationManager } from "../clarification.js";

export interface ClarificationDialog {
  readonly clarificationId: string;
  readonly sessionId: string;
  readonly question: string;
  readonly options: readonly string[];
  readonly promise: Promise<string>;
  cancel(): boolean;
}

/**
 * Session-owned keyed clarification facade; UI connections are observers only.
 * Request/settled events reach clients from the Runtime, which subscribes to
 * the shared manager and tags each event with the asking Session.
 */
export class ClarificationDialogs {
  private readonly dialogs = new Map<string, ClarificationDialog>();

  constructor(private readonly manager: ClarificationManager) {}

  ask(sessionId: string, question: string, options: readonly string[] = [], timeoutMs?: number): ClarificationDialog {
    const request = this.manager.ask(sessionId, question, [...options], timeoutMs);
    const dialog: ClarificationDialog = {
      clarificationId: request.clarificationId,
      sessionId,
      question,
      options: [...options],
      promise: request.promise.finally(() => this.dialogs.delete(request.clarificationId)),
      cancel: () => this.manager.cancelById(request.clarificationId, "cancelled"),
    };
    this.dialogs.set(dialog.clarificationId, dialog);
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
}

