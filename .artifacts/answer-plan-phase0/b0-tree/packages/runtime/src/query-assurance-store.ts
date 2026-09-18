import { appendFileSync, chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
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
  /** HMAC used when the journal crosses a trust boundary. */
  readonly recordMac?: string;
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
export interface JsonFileQueryAssuranceStateStoreOptions {
  /** Required for journals transported across a trust boundary. */
  readonly integrityKey?: string | Buffer;
}

export class JsonFileQueryAssuranceStateStore implements QueryAssuranceStateStore {
  private lastRecordIdentity?: string;
  private hasLoaded = false;

  constructor(private readonly filePath: string, private readonly options: JsonFileQueryAssuranceStateStoreOptions = {}) {}

  private authenticate(payload: unknown): string {
    const serialized = JSON.stringify(payload, jsonReplacer);
    return this.options.integrityKey
      ? createHmac("sha256", this.options.integrityKey).update(serialized, "utf8").digest("hex")
      : createHash("sha256").update(serialized, "utf8").digest("hex");
  }

  load(): QueryAssurancePersistedState | undefined {
    if (!existsSync(this.filePath)) {
      this.lastRecordIdentity = undefined;
      this.hasLoaded = true;
      return undefined;
    }
    const content = readFileSync(this.filePath, "utf8").trim();
    if (!content) {
      this.lastRecordIdentity = undefined;
      this.hasLoaded = true;
      return undefined;
    }
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
    let previousIdentity: string | undefined;
    for (const record of records) {
      if (!record || typeof record !== "object" || (record as { version?: unknown }).version !== 1) throw new Error("QUERY_ASSURANCE_STATE_VERSION_UNSUPPORTED");
      const journal = record as QueryAssurancePersistedState;
      const identity = journal.recordMac ?? journal.recordHash;
      if (identity) {
        if (journal.previousHash !== previousIdentity) throw new Error("QUERY_ASSURANCE_STATE_CHAIN_INVALID");
        if (journal.recordMac && !this.options.integrityKey) throw new Error("QUERY_ASSURANCE_STATE_AUTHENTICATION_REQUIRED");
        const { recordHash: _recordHash, recordMac: _recordMac, ...payload } = journal;
        const expected = this.authenticate(payload);
        if (expected !== identity) throw new Error(journal.recordMac ? "QUERY_ASSURANCE_STATE_AUTHENTICATION_INVALID" : "QUERY_ASSURANCE_STATE_INTEGRITY_INVALID");
        previousIdentity = identity;
      } else if (previousIdentity) {
        throw new Error("QUERY_ASSURANCE_STATE_CHAIN_INVALID");
      }
    }
    this.lastRecordIdentity = previousIdentity;
    this.hasLoaded = true;
    return records.at(-1) as QueryAssurancePersistedState | undefined;
  }

  save(state: QueryAssurancePersistedState): void {
    if (state.version !== 1) throw new Error("QUERY_ASSURANCE_STATE_VERSION_UNSUPPORTED");
    const target = path.resolve(this.filePath);
    const lockPath = `${target}.lock`;
    mkdirSync(path.dirname(target), { recursive: true });
    let lock: number | undefined;
    try {
      lock = openSync(lockPath, "wx", 0o600);
      const expectedPrevious = this.lastRecordIdentity;
      const hasExpectedSnapshot = this.hasLoaded;
      const previous = this.load();
      const currentPrevious = previous?.recordMac ?? previous?.recordHash;
      if (hasExpectedSnapshot && expectedPrevious !== currentPrevious) throw new Error("QUERY_ASSURANCE_STATE_CONCURRENT_WRITE");
      const { recordHash: _oldHash, recordMac: _oldMac, previousHash: _oldPrevious, ...payload } = state;
      const journal = { ...payload, ...(currentPrevious ? { previousHash: currentPrevious } : {}) };
      const identity = this.authenticate(journal);
      const authenticated = this.options.integrityKey ? { ...journal, recordMac: identity } : { ...journal, recordHash: identity };
      appendFileSync(target, `${JSON.stringify(authenticated, jsonReplacer)}\n`, { encoding: "utf8", flag: "a" });
      chmodSync(target, 0o600);
      this.lastRecordIdentity = identity;
    } catch (error) {
      throw new Error(`QUERY_ASSURANCE_STATE_SAVE_FAILED:${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (lock !== undefined) {
        closeSync(lock);
        if (existsSync(lockPath)) unlinkSync(lockPath);
      }
    }
  }
}

export class InMemoryQueryAssuranceStateStore implements QueryAssuranceStateStore {
  private state?: QueryAssurancePersistedState;
  load(): QueryAssurancePersistedState | undefined { return this.state ? structuredClone(this.state) : undefined; }
  save(state: QueryAssurancePersistedState): void { this.state = structuredClone(state); }
}
