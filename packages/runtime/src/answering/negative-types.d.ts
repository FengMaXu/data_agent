import type { CandidateId, DraftRevision, EvidenceId, HypothesisId, QueryArtifact, ReadyRevision, Resolution, RevisionId, TaskId } from "./model.js";

declare const taskId: TaskId;
declare const revisionId: RevisionId;
declare const evidenceId: EvidenceId;
declare const candidateId: CandidateId;
declare const hypothesisId: HypothesisId;
declare const plainString: string;
declare const draftRevision: DraftRevision;
declare const observationArtifact: Extract<QueryArtifact, { kind: "exploration" }>;
declare function needsReadyRevision(revision: ReadyRevision): void;
declare function publishCandidate(candidate: Extract<QueryArtifact, { kind: "candidate" }>): void;

// @ts-expect-error Ordinary strings cannot become trusted branded IDs.
const badFromString: TaskId = plainString;
// @ts-expect-error Branded business identities must not be interchangeable.
const badRevision: RevisionId = taskId;
// @ts-expect-error Branded evidence identity must not be used as a candidate.
const badCandidate: CandidateId = evidenceId;
// @ts-expect-error Branded hypothesis identity must not be used as a task.
const badTask: TaskId = hypothesisId;
// @ts-expect-error Branded revision identity must not be used as evidence.
const badEvidence: EvidenceId = revisionId;
// @ts-expect-error Branded candidate identity must not be used as a hypothesis.
const badHypothesis: HypothesisId = candidateId;

// @ts-expect-error A Draft Revision cannot cross the result execution seam.
needsReadyRevision(draftRevision);
// @ts-expect-error Exploration artifacts cannot cross the publication seam.
publishCandidate(observationArtifact);

// @ts-expect-error Supported resolutions require a non-empty QualifiedEvidence proof.
const emptySupportedResolution: Resolution = { outcome: "supported", hypothesisId, proof: [] };

void [badFromString, badRevision, badCandidate, badTask, badEvidence, badHypothesis, emptySupportedResolution];
