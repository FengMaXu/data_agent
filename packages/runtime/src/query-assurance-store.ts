import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type { AnswerSpec } from "./answer-spec.js";
import type { AssuranceAuditRecord } from "./assurance-audit.js";
import type { QueryTaskLifecycleStatus, TaskEvidence, ValidatedQueryArtifact } from "./query-assurance.js";
import type { PublicationRegistryState } from "./publication.js";

export interface PersistedFailedCandidate {
  readonly specVersion: string;
  readonly candidateId?: string;
  readonly queryArtifactId?: string;
  readonly digestPaths?: readonly string[];
  readonly gatePolicyVersion?: string;
  readonly gateApplicabilityVersion?: string;
  /** Hash of the full semantic fingerprint, retained for exact identity. */
  readonly fingerprint: string;
  readonly claimIds: readonly string[];
  /** Hashes of the semantic regions associated with each failed claim. */
  readonly claimFingerprints?: readonly (readonly [string, string])[];
}

export interface QueryAssuranceStateIdentity {
  readonly reviewerModel: string;
  readonly reviewerPromptVersion: string;
  readonly queryDigestVersion: string;
  readonly parserVersion: string;
  readonly reviewCoverageSchemaVersion: string;
  readonly reviewPolicyVersion: string;
  readonly hardConstraintAdmissionPolicy: string;
  readonly gatePolicyVersion: string;
  readonly gateApplicabilityVersion: string;
  readonly probeTemplateVersion: string;
  readonly evidenceAdmissionPolicyVersion: string;
  readonly dialect: string;
  readonly deliveryMode: "off" | "shadow" | "enforce";
  readonly shadowDelivery: "publish_with_disagreement" | "record_only";
  readonly allowUnavailablePublication: boolean;
}

export interface QueryAssurancePersistedState {
  readonly version: 1;
  readonly identity?: QueryAssuranceStateIdentity;
  readonly previousHash?: string;
  readonly recordHash?: string;
  readonly specs: readonly AnswerSpec[];
  readonly tasks: readonly { readonly taskId: string; readonly evidence: TaskEvidence }[];
  readonly artifacts: readonly ValidatedQueryArtifact[];
  readonly repairAttempts: readonly (readonly [string, number])[];
  readonly failedCandidates: readonly { readonly taskId: string; readonly candidates: readonly PersistedFailedCandidate[] }[];
  readonly taskStatuses?: readonly { readonly taskId: string; readonly status: QueryTaskLifecycleStatus }[];
  readonly publication?: PublicationRegistryState;
  readonly auditRecords?: readonly AssuranceAuditRecord[];
}

export interface QueryAssuranceStateStore {
  load(): QueryAssurancePersistedState | undefined;
  save(state: QueryAssurancePersistedState): void;
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? { __type: "bigint", value: value.toString() } : value;
}

function jsonReviver(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && (value as { __type?: unknown }).__type === "bigint") return BigInt((value as { value: string }).value);
  return value;
}

/**
 * Small append-only persistence seam for the trusted coordinator. Each save is
 * one complete versioned snapshot, so an Enforce process can resume from the
 * last durable state without rewriting the task history in place.
 */
export class JsonFileQueryAssuranceStateStore implements QueryAssuranceStateStore {
  constructor(private readonly filePath: string) {}

  load(): QueryAssurancePersistedState | undefined {
    if (!existsSync(this.filePath)) return undefined;
    const content = readFileSync(this.filePath, "utf8").trim();
    if (!content) return undefined;
    let records: unknown[];
    try {
      // Accept the pre-journal single-object form as a read-only migration
      // path. New writes are always appended as compact JSONL records.
      try {
        records = [JSON.parse(content, jsonReviver)];
      } catch {
        records = content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line, jsonReviver));
      }
    } catch (error) {
      throw new Error(`QUERY_ASSURANCE_STATE_INVALID:${error instanceof Error ? error.message : String(error)}`);
    }
    let previousHash: string | undefined;
    for (const record of records) {
      if (!record || typeof record !== "object" || (record as { version?: unknown }).version !== 1) throw new Error("QUERY_ASSURANCE_STATE_VERSION_UNSUPPORTED");
      const journal = record as QueryAssurancePersistedState;
      if (journal.recordHash) {
        if (journal.previousHash !== previousHash) throw new Error("QUERY_ASSURANCE_STATE_CHAIN_INVALID");
        const { recordHash: _recordHash, ...payload } = journal;
        const expected = createHash("sha256").update(JSON.stringify(payload, jsonReplacer), "utf8").digest("hex");
        if (expected !== journal.recordHash) throw new Error("QUERY_ASSURANCE_STATE_INTEGRITY_INVALID");
        previousHash = journal.recordHash;
      } else if (previousHash) {
        throw new Error("QUERY_ASSURANCE_STATE_CHAIN_INVALID");
      }
    }
    return records.at(-1) as QueryAssurancePersistedState | undefined;
  }

  save(state: QueryAssurancePersistedState): void {
    if (state.version !== 1) throw new Error("QUERY_ASSURANCE_STATE_VERSION_UNSUPPORTED");
    const target = path.resolve(this.filePath);
    mkdirSync(path.dirname(target), { recursive: true });
    try {
      const previous = this.load();
      const { recordHash: _oldHash, ...payload } = state;
      const journal = { ...payload, ...(previous?.recordHash ? { previousHash: previous.recordHash } : {}) };
      const recordHash = createHash("sha256").update(JSON.stringify(journal, jsonReplacer), "utf8").digest("hex");
      appendFileSync(target, `${JSON.stringify({ ...journal, recordHash }, jsonReplacer)}\n`, { encoding: "utf8", flag: "a" });
      chmodSync(target, 0o600);
    } catch (error) {
      throw new Error(`QUERY_ASSURANCE_STATE_SAVE_FAILED:${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export class InMemoryQueryAssuranceStateStore implements QueryAssuranceStateStore {
  private state?: QueryAssurancePersistedState;
  load(): QueryAssurancePersistedState | undefined { return this.state ? structuredClone(this.state) : undefined; }
  save(state: QueryAssurancePersistedState): void { this.state = structuredClone(state); }
}
