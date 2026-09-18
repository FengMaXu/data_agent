import type { ClarificationManager } from "../clarification.js";

export type ClarificationDialogEvent =
  | { readonly type: "request"; readonly clarificationId: string; readonly sessionId: string; readonly question: string; readonly options: readonly string[] }
  | { readonly type: "settled"; readonly clarificationId: string; readonly outcome: "answered" | "expired" | "cancelled" };

export interface ClarificationDialog {
  readonly clarificationId: string;
  readonly sessionId: string;
  readonly question: string;
  readonly options: readonly string[];
  readonly promise: Promise<string>;
  cancel(): boolean;
}

/** Session-owned keyed clarification facade; UI connections are observers only. */
export class ClarificationDialogs {
  private readonly dialogs = new Map<string, ClarificationDialog>();
  private readonly listeners = new Set<(event: ClarificationDialogEvent) => void>();

  constructor(private readonly manager: ClarificationManager) {
    manager.onAsked = (request) => this.emit({ type: "request", clarificationId: request.clarificationId, sessionId: request.sessionId, question: request.question, options: request.options });
    manager.onSettled = (clarificationId, outcome) => this.emit({ type: "settled", clarificationId, outcome });
  }

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

  subscribe(listener: (event: ClarificationDialogEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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

  private emit(event: ClarificationDialogEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

