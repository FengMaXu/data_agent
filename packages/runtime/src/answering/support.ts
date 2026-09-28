import { AnsweringError } from "./errors.js";

/** Small shared helpers for the Answering use-case modules. */
export function now(): string { return new Date().toISOString(); }

export function localId(value: string, prefix: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new AnsweringError("INVALID_REQUEST", `${prefix} must not be empty`);
  return normalized;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
