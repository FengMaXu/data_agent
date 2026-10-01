import { setValue, value, type Session } from "@earendil-works/pi-agent-core/harness/session";
import { TODO_CONTEXT, type Context } from "@earendil-works/pi-agent-core/harness/context";
import type { JsonValue } from "@earendil-works/chord";
import type { AnsweredClarification, ClarificationLedger } from "../facets/clarification-dialogs.js";

const NAMESPACE = "data-agent.clarifications";

function isAnswered(stored: unknown): stored is AnsweredClarification {
  if (!stored || typeof stored !== "object") return false;
  const record = stored as Record<string, unknown>;
  return typeof record.clarificationId === "string" && typeof record.question === "string"
    && Array.isArray(record.options) && typeof record.answer === "string" && typeof record.answeredAt === "string";
}

/**
 * Answered clarifications stored in the Session that asked them, one value per
 * clarificationId. Only the Host writes here, from the user's answer; the model
 * sees answers through the tool result and cites them by id.
 */
export class PiSessionClarificationLedger implements ClarificationLedger {
  constructor(
    private readonly session: Session<any>,
    private readonly piContext: Context = TODO_CONTEXT,
  ) {}

  async record(answered: AnsweredClarification): Promise<void> {
    const address = value<JsonValue>(NAMESPACE, answered.clarificationId);
    await this.session.mutate(async (mutator) => {
      await mutator.commit([setValue(address, { ...answered, options: [...answered.options] } as unknown as JsonValue)], this.piContext);
    }, this.piContext);
  }

  async read(clarificationId: string): Promise<AnsweredClarification | undefined> {
    const stored = await this.session.getValue(value<JsonValue>(NAMESPACE, clarificationId), this.piContext);
    return isAnswered(stored?.value) ? stored.value : undefined;
  }
}
