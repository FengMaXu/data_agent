export type SpecSlot = "measure" | "grain" | "population" | "filter" | "final_shape";
export type DetectorId =
  | "join_fanout"
  | "count_distinct_divergence"
  | "entity_population_mismatch"
  | "unauthorized_filter"
  | "null_like_member_in_filter"
  | "physical_bound_violation"
  | "shape_mismatch"
  | "intermediate_candidate"
  | "cross_period_set_mismatch"
  | "empty_after_filter"
  | "fingerprint_unchanged";
export type AnomalyStatus = "unresolved" | "acknowledged_with_choice" | "inconclusive";

export interface AnomalyObservation {
  readonly detector: DetectorId;
  readonly slot: SpecSlot;
  readonly observed: Record<string, unknown>;
  readonly note: string;
  readonly fingerprint?: string;
  readonly status?: AnomalyStatus;
}

export interface AnomalyRecord extends AnomalyObservation {
  readonly status: AnomalyStatus;
  readonly id: string;
  readonly taskId: string;
  readonly specVersion?: string;
  readonly queryArtifactId?: string;
  readonly boundCandidateIds: readonly string[];
  readonly registeredAt: string;
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class AnomalyRegistry {
  private readonly records = new Map<string, AnomalyRecord[]>();
  private readonly candidateFingerprints = new Map<string, Map<string, Partial<Record<SpecSlot, string>>>>();

  register(taskId: string, observations: readonly AnomalyObservation[], context: { specVersion?: string; queryArtifactId?: string; now?: () => number } = {}): readonly AnomalyRecord[] {
    const entries = this.records.get(taskId) ?? [];
    const fresh: AnomalyRecord[] = [];
    const registeredAt = new Date((context.now ?? Date.now)()).toISOString();
    for (const observation of observations) {
      const key = `${observation.detector}:${observation.slot}:${stable(observation.observed)}`;
      if (entries.some((entry) => `${entry.detector}:${entry.slot}:${stable(entry.observed)}` === key)) continue;
      const record: AnomalyRecord = {
        ...clone(observation),
        status: observation.status ?? "unresolved",
        id: `A-${entries.length + fresh.length + 1}`,
        taskId,
        ...(context.specVersion ? { specVersion: context.specVersion } : {}),
        ...(context.queryArtifactId ? { queryArtifactId: context.queryArtifactId } : {}),
        boundCandidateIds: [],
        registeredAt,
      };
      fresh.push(record);
    }
    if (fresh.length) this.records.set(taskId, [...entries, ...fresh]);
    return clone(fresh);
  }

  bindCandidate(taskId: string, queryArtifactId: string, fingerprints: Readonly<Partial<Record<SpecSlot, string>>>): readonly AnomalyRecord[] {
    const entries = this.records.get(taskId) ?? [];
    const candidates = this.candidateFingerprints.get(taskId) ?? new Map<string, Partial<Record<SpecSlot, string>>>();
    if (!candidates.has(queryArtifactId)) candidates.set(queryArtifactId, clone(fingerprints));
    this.candidateFingerprints.set(taskId, candidates);
    const fresh: AnomalyRecord[] = [];
    const updated = entries.map((entry) => entry.queryArtifactId !== queryArtifactId && entry.status === "unresolved" && !entry.boundCandidateIds.includes(queryArtifactId)
      ? { ...entry, boundCandidateIds: [...entry.boundCandidateIds, queryArtifactId] }
      : entry);
    for (const entry of entries) {
      if (entry.detector === "fingerprint_unchanged" || entry.status !== "unresolved" || entry.queryArtifactId === queryArtifactId) continue;
      const fingerprint = fingerprints[entry.slot];
      if (!fingerprint || !entry.fingerprint || fingerprint !== entry.fingerprint) continue;
      const observation: AnomalyObservation = {
        detector: "fingerprint_unchanged",
        slot: entry.slot,
        observed: { anomalyId: entry.id, fingerprint },
        note: `绑定槽位 ${entry.slot} 的语义指纹未发生变化。`,
        fingerprint,
      };
      const key = `${observation.detector}:${observation.slot}:${stable(observation.observed)}`;
      if (entries.some((candidate) => `${candidate.detector}:${candidate.slot}:${stable(candidate.observed)}` === key)) continue;
      fresh.push({
        ...observation,
        status: "unresolved",
        id: `A-${entries.length + fresh.length + 1}`,
        taskId,
        ...(entry.specVersion ? { specVersion: entry.specVersion } : {}),
        queryArtifactId,
        boundCandidateIds: [],
        registeredAt: new Date().toISOString(),
      });
    }
    if (fresh.length || updated.some((entry, index) => entry !== entries[index])) this.records.set(taskId, [...updated, ...fresh]);
    return clone(fresh);
  }

  distinctFingerprintCount(taskId: string, slot: SpecSlot): number {
    const values = [...(this.candidateFingerprints.get(taskId)?.values() ?? [])]
      .map((fingerprints) => fingerprints[slot]).filter((value): value is string => Boolean(value));
    return new Set(values).size;
  }

  list(taskId?: string): readonly AnomalyRecord[] {
    const values = taskId ? this.records.get(taskId) ?? [] : [...this.records.values()].flat();
    return clone(values);
  }

  unresolved(taskId: string): readonly AnomalyRecord[] {
    return this.list(taskId).filter((entry) => entry.status === "unresolved");
  }

  snapshot(): readonly AnomalyRecord[] { return this.list(); }

  restore(records: readonly AnomalyRecord[]): void {
    this.records.clear();
    this.candidateFingerprints.clear();
    for (const record of records) this.records.set(record.taskId, [...(this.records.get(record.taskId) ?? []), clone(record)]);
  }
}

export function formatAnomalies(records: readonly AnomalyRecord[]): string {
  return records.map((record) => [
    `[ANOMALY ${record.id} registered] ${record.detector}`,
    `  observed: ${Object.entries(record.observed).map(([key, value]) => `${key}=${String(value)}`).join(", ")}`,
    `  slot: ${record.slot}`,
    `  status: ${record.status}`,
    `  note: ${record.note}`,
  ].join("\n")).join("\n");
}

