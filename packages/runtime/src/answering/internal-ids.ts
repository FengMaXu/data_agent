import { randomUUID } from "node:crypto";
import type {
  AlternativeId,
  CandidateId,
  ChoiceId,
  EvidenceId,
  HypothesisId,
  Id,
  PrivateResultRef,
  PublicationId,
  ReadyRevisionId,
  RevisionId,
  TaskId,
} from "./model.js";

/** Runtime-only identity factory; no public barrel exports this module. */
export function makeInternalId(prefix: "task"): TaskId;
export function makeInternalId(prefix: "revision"): RevisionId;
export function makeInternalId(prefix: "ready"): ReadyRevisionId;
export function makeInternalId(prefix: "hypothesis" | "choice-proof"): HypothesisId;
export function makeInternalId(prefix: "evidence"): EvidenceId;
export function makeInternalId(prefix: "attempt"): string;
export function makeInternalId(prefix: "choice"): ChoiceId;
export function makeInternalId(prefix: "alternative"): AlternativeId;
export function makeInternalId(prefix: "candidate"): CandidateId;
export function makeInternalId(prefix: "result"): PrivateResultRef;
export function makeInternalId(prefix: "publication"): PublicationId;
export function makeInternalId(prefix: string): Id<string> {
  return `${prefix}_${randomUUID()}` as Id<string>;
}
