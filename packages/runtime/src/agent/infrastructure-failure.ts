import { DATABASE_UNAVAILABLE } from "../answering/public.js";

/**
 * Finds a terminal infrastructure failure in a tool result. The database
 * executor reports an unrecoverable loss as `DATABASE_UNAVAILABLE: ...`; the
 * text survives tool errors and subagent failure reports, so both the main
 * Agent and a parent of a failed child can recognise it.
 */
export function infrastructureFailureOf(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const part of content) {
    const text = part && typeof part === "object" && (part as { type?: unknown }).type === "text" ? (part as { text?: unknown }).text : undefined;
    if (typeof text !== "string") continue;
    const start = text.indexOf(`${DATABASE_UNAVAILABLE}:`);
    if (start >= 0) return text.slice(start).split(/\r?\n/, 1)[0]!.slice(0, 500);
  }
  return undefined;
}
