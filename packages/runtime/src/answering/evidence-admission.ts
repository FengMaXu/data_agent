import {
  CLARIFICATION_SOURCE_PREFIX,
  contentHash,
  type EvidenceKind,
  type EvidenceVerification,
  type UntrustedEvidenceInput,
} from "./model.js";

/**
 * Trusted text sources for Evidence Admission. Implementations are supplied by
 * the composition root; a model never chooses which text a source returns or
 * which authority a document carries.
 */
export interface EvidenceSource {
  /** Text of a user-authored message in this Session; undefined when absent or not user-authored. */
  readUserMessage(sessionId: string, messageId: string, signal?: AbortSignal): Promise<string | undefined>;
  /** The user's recorded answer to a clarification this Session asked; undefined when absent or unanswered. */
  readClarificationAnswer?(sessionId: string, clarificationId: string, signal?: AbortSignal): Promise<string | undefined>;
  /** Only documents explicitly authorized by the composition root resolve here. */
  readDocument?(sourceRef: string, signal?: AbortSignal): Promise<AuthorizedEvidenceDocument | undefined>;
}

export interface AuthorizedEvidenceDocument {
  readonly kind: "task_document" | "reviewed_definition";
  readonly content: string;
}

export class EvidenceAdmissionError extends Error {
  readonly code = "EVIDENCE_REJECTED" as const;

  constructor(message: string) {
    super(message);
    this.name = "EvidenceAdmissionError";
  }
}

/** Evidence input that passed admission; Answering assigns the Evidence id inside its transaction. */
export interface AdmittedEvidence {
  readonly localId?: string;
  readonly kind: EvidenceKind;
  readonly sourceRef: string;
  readonly quote?: string;
  readonly contentHash?: string;
  readonly verification?: EvidenceVerification;
}

export interface AdmissionScope {
  readonly sessionId: string;
  /** The Query Task's original request message; request_wording is always bound here. */
  readonly taskRequestMessageId: string;
  readonly source?: EvidenceSource;
  readonly signal?: AbortSignal;
}

const MIN_QUOTE_LENGTH = 2;

export function normalizeQuoteText(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** A quote is admissible only as a verbatim (whitespace/NFKC-normalized) span of the source text. */
export function quoteAppearsIn(quote: string, sourceText: string): boolean {
  const needle = normalizeQuoteText(quote);
  if (needle.length < MIN_QUOTE_LENGTH) return false;
  return normalizeQuoteText(sourceText).includes(needle);
}

function requireQuote(input: UntrustedEvidenceInput, label: string): string {
  const quote = input.quote?.trim();
  if (!quote) throw new EvidenceAdmissionError(`${label} evidence requires a verbatim quote from its source`);
  return quote;
}

async function admitOne(input: UntrustedEvidenceInput, scope: AdmissionScope): Promise<AdmittedEvidence> {
  const localId = input.localId?.trim() || undefined;
  const base = localId ? { localId } : {};
  switch (input.kind) {
    case "request_wording": {
      const quote = requireQuote(input, "request_wording");
      const text = scope.source ? await scope.source.readUserMessage(scope.sessionId, scope.taskRequestMessageId, scope.signal) : undefined;
      if (text === undefined) throw new EvidenceAdmissionError("request_wording cannot be verified: the original request text is unavailable");
      if (!quoteAppearsIn(quote, text)) throw new EvidenceAdmissionError(`request_wording quote was not found verbatim in the original request: ${JSON.stringify(quote)}`);
      return { ...base, kind: "request_wording", sourceRef: scope.taskRequestMessageId, quote, contentHash: contentHash(text), verification: { method: "user_message_quote", sourceContentHash: contentHash(text) } };
    }
    case "user_confirmation": {
      const quote = requireQuote(input, "user_confirmation");
      const messageId = input.sourceRef?.trim();
      if (!messageId) throw new EvidenceAdmissionError("user_confirmation requires the Host-supplied user message of the current operation");
      // The user's answer to a clarification is something they said, verified like a message.
      if (messageId.startsWith(CLARIFICATION_SOURCE_PREFIX)) {
        const clarificationId = messageId.slice(CLARIFICATION_SOURCE_PREFIX.length);
        const answer = scope.source?.readClarificationAnswer ? await scope.source.readClarificationAnswer(scope.sessionId, clarificationId, scope.signal) : undefined;
        if (answer === undefined) throw new EvidenceAdmissionError(`user_confirmation cannot be verified: clarification ${clarificationId} has no recorded answer in this Session`);
        if (!quoteAppearsIn(quote, answer)) throw new EvidenceAdmissionError(`user_confirmation quote was not found verbatim in the user's answer to clarification ${clarificationId}: ${JSON.stringify(quote)}`);
        return { ...base, kind: "user_confirmation", sourceRef: messageId, quote, contentHash: contentHash(answer), verification: { method: "clarification_answer_quote", sourceContentHash: contentHash(answer) } };
      }
      if (messageId === scope.taskRequestMessageId) throw new EvidenceAdmissionError("The original request is request_wording, not a later user confirmation");
      const text = scope.source ? await scope.source.readUserMessage(scope.sessionId, messageId, scope.signal) : undefined;
      if (text === undefined) throw new EvidenceAdmissionError("user_confirmation cannot be verified: the user message is unavailable");
      if (!quoteAppearsIn(quote, text)) throw new EvidenceAdmissionError(`user_confirmation quote was not found verbatim in the user's message: ${JSON.stringify(quote)}`);
      return { ...base, kind: "user_confirmation", sourceRef: messageId, quote, contentHash: contentHash(text), verification: { method: "user_message_quote", sourceContentHash: contentHash(text) } };
    }
    case "task_document":
    case "reviewed_definition":
    case "document": {
      const label = input.kind === "document" ? "document" : input.kind;
      const quote = requireQuote(input, label);
      const sourceRef = input.sourceRef?.trim();
      if (!sourceRef) throw new EvidenceAdmissionError(`${label} requires the knowledgeId of an authorized document`);
      const document = scope.source?.readDocument ? await scope.source.readDocument(sourceRef, scope.signal) : undefined;
      if (!document) throw new EvidenceAdmissionError(`${sourceRef} is not an authorized business evidence document`);
      // "document" takes the authority the composition root configured; a named kind must match it.
      if (input.kind !== "document" && document.kind !== input.kind) throw new EvidenceAdmissionError(`${sourceRef} is configured as ${document.kind}, not ${input.kind}`);
      if (!quoteAppearsIn(quote, document.content)) throw new EvidenceAdmissionError(`${label} quote was not found verbatim in ${sourceRef}: ${JSON.stringify(quote)}`);
      return { ...base, kind: document.kind, sourceRef, quote, contentHash: contentHash(document.content), verification: { method: "document_quote", sourceContentHash: contentHash(document.content) } };
    }
    case "schema_fact": {
      const sourceRef = input.sourceRef?.trim();
      if (!sourceRef) throw new EvidenceAdmissionError("schema_fact requires a sourceRef");
      return {
        ...base,
        kind: "schema_fact",
        sourceRef,
        ...(input.quote?.trim() ? { quote: input.quote.trim() } : {}),
        ...(input.contentHash ? { contentHash: input.contentHash } : {}),
      };
    }
    case "query_observation":
      throw new EvidenceAdmissionError("query_observation is registered only by exploration queries; reference its evidenceId instead");
    default:
      throw new EvidenceAdmissionError("Unsupported evidence kind");
  }
}

/**
 * Evidence Admission (ADR-0004). Runs before the Answering transaction so
 * trusted source reads never happen while the Store is locked. Any rejected
 * item rejects the whole begin/revise call.
 */
export async function admitEvidence(inputs: readonly UntrustedEvidenceInput[], scope: AdmissionScope): Promise<readonly AdmittedEvidence[]> {
  const localIds = new Set<string>();
  const admitted: AdmittedEvidence[] = [];
  for (const input of inputs) {
    const item = await admitOne(input, scope);
    if (item.localId) {
      if (localIds.has(item.localId)) throw new EvidenceAdmissionError(`Duplicate evidence localId ${item.localId}`);
      localIds.add(item.localId);
    }
    admitted.push(item);
  }
  return admitted;
}
