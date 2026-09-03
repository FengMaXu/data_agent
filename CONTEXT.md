# Data Agent Query Assurance

This context defines the language used to assess whether a freely generated database query is consistent with a user's request before its result is delivered.

## Language

**Evidence Authority**:
The precedence order used when semantic evidence conflicts: user clarification, reviewed business definitions or semantic models, task-supplied business documents, explicit request wording, formal schema constraints, observed data evidence, and finally model inference. Evaluation Gold is never runtime evidence.
_Avoid_: Source priority, truth ranking

**Query Task**:
One database-answering request with its own identity, Answer Spec version chain, candidate queries, review history, and final Publication Status. A chat session may contain multiple Query Tasks.
_Avoid_: Session, tool call

**Query Assurance**:
The process that prepares semantic evidence, detects and informs about candidate anomalies, records interpretation choices, and publishes results under integrity rules.
_Avoid_: SQL validation, export gate

**Answer Spec**:
A versioned interpretation of the requested answer containing Hard Constraints, Hypotheses, and Ambiguities. It is evidence-scoped rather than an assertion of absolute correctness.
_Avoid_: Frozen contract, planner answer

**Hard Constraint**:
A requirement supported by authoritative evidence and eligible to block delivery when violated.
_Avoid_: Assumption, guess

**Structural Fact**:
An unambiguous property established by formal schema evidence or the observed result shape, without requiring a business interpretation.
_Avoid_: Business rule, inferred grain

**Hypothesis**:
A provisional semantic interpretation with stated evidence and confidence that requires validation before it can become a Hard Constraint.
_Avoid_: Rule, fact

**Ambiguity**:
An unresolved choice between plausible interpretations for which current evidence does not establish one authoritative answer.
_Avoid_: Error, model uncertainty

**Anomaly Record**:
A task-scoped record of a deterministic observation that may affect interpretation, bound to one Answer Spec slot and one or more candidate artifacts. It reports evidence and status; it does not by itself decide delivery.
_Avoid_: Gate verdict, semantic error

**Interpretation**:
One explicit, auditable way to read an ambiguous Answer Spec slot. Multiple interpretations may remain visible until the delivered candidate records which one it implements.
_Avoid_: Correct answer, reviewer decision

**Disclosure**:
The publication record of unresolved observations, alternatives, or unavailable review that remain visible when a result is delivered.
_Avoid_: Approval, waiver

**Query Digest**:
A structured account of what a query expresses, including its sources, filters, measures, grouping, ranking, windows, and output lineage, together with explicit coverage and unsupported areas.
_Avoid_: SQL summary, query explanation

**Conversation-Blind Reviewer**:
A reviewer that can see the request, Answer Spec, schema evidence, query, and Query Digest but cannot see the solver's conversation, reasoning, self-description, or self-validation claims.
_Avoid_: Blind translator, question-blind reviewer

**Review Decision**:
An evidence-scoped judgment with one of four outcomes: Approved, Rejected, Needs Clarification, or Abstained.
_Avoid_: Proof, correctness certificate

**Approved**:
A Review Decision meaning that no blocking disagreement was found within the current Answer Spec, schema evidence, Query Digest, Review Coverage, and reviewer capability. It does not mean that semantic correctness has been proven.
_Avoid_: Proven correct, guaranteed correct

**Review Coverage**:
The versioned, structured set of semantic and structural aspects that a Review Decision checked, found inapplicable, could not support, or lacked evidence to assess.
_Avoid_: Confidence

**Calibrated Confidence**:
An empirical estimate derived from Review Calibration for decisions with comparable evidence and coverage. It is distinct from a reviewer's uncalibrated self-reported score.
_Avoid_: Reviewer confidence, model certainty

**Semantic Disagreement**:
A structured difference between the requested semantics and the semantics expressed by a submitted query.
_Avoid_: Validation error, SQL error

**Spec Authority**:
The authority that versions an Answer Spec and decides whether new evidence promotes, preserves, or weakens a Hypothesis. A solver can propose evidence but cannot mutate the Answer Spec directly.
_Avoid_: Planner, spec editor

**Spec Change Proposal**:
A solver-submitted claim and its evidence requesting a versioned change to an Answer Spec.
_Avoid_: Spec update, contract rewrite

**Business Definition Proposal**:
A candidate cross-task business rule produced from user correction or task evidence that requires business review before becoming authoritative.
_Avoid_: Saved learning, global rule

**Internal Evidence**:
Query data and metadata available to the solver for analysis but not yet authorized for user-visible delivery.
_Avoid_: Preview result, draft answer

**Validated Query Artifact**:
An immutable identity for a successfully previewed query and its Internal Evidence, used to ensure that review and delivery refer to the same query.
_Avoid_: Last SQL, validated SQL string

**Export Candidate**:
A private, unpublished query result held for review and promoted unchanged only when Delivery Policy permits publication.
_Avoid_: Temporary export, draft CSV

**Schema Evidence Fingerprint**:
The stable identity of the schema slice and reviewed structural evidence used to compile and review one query.
_Avoid_: Schema version, database version

**Review Token**:
A review result bound to one Validated Query Artifact, one Answer Spec version, and one Schema Evidence Fingerprint. It cannot authorize a different query or interpretation.
_Avoid_: Approval flag, validation boolean

**Review Outcome**:
The envelope that distinguishes whether review was available from the Review Decision produced when it was available.
_Avoid_: Review Decision, verdict

**Review Unavailable**:
A Review Outcome meaning that required review evidence could not be produced because the review capability failed or lacked coverage. It is distinct from Approved, Rejected, and Abstained.
_Avoid_: Approved with warning, reviewer rejection

**Semantic Diff**:
A structured statement of one requested-versus-observed semantic difference with references to the supporting Answer Spec and Query Digest evidence. It describes the mismatch without supplying replacement query logic.
_Avoid_: Reviewer explanation, suggested fix

**Invariant Probe**:
A conditional query property check whose applicability and blocking authority depend on explicitly satisfied evidence requirements.
_Avoid_: Sanity check, universal invariant

**Publication Authorization**:
A user's one-time permission to publish one exact Export Candidate with disclosed Semantic Diffs. It does not authorize later query or specification changes.
_Avoid_: Review override, permanent exception

**Automatic Semantic Repair**:
One solver attempt to revise a rejected candidate using only returned Semantic Diffs. It creates a new Validated Query Artifact and requires a new review.
_Avoid_: Retry loop, reviewer fix

**Publication Receipt**:
The evidence that one exact query result was published under a specific Review Outcome, Delivery Policy, and Publication Authorization when required.
_Avoid_: Export result, task-complete flag

**Publication Status**:
The delivery record distinguishing approved publication, publication with known disagreement, rejection without publication, and review unavailability without publication.
_Avoid_: Task complete, export success

**Assurance Audit Record**:
The non-sensitive provenance of a candidate's specification, query identity, review versions, coverage, differences, repair attempt, publication outcome, latency, and cost.
_Avoid_: Trace, conversation log

**Review Off**:
A declared mode in which Query Assurance review is unavailable and no Review Decision is produced. It must not be represented as Shadow Review or Approved.
_Avoid_: Disabled warning, implicit fallback

**Shadow Review**:
A review mode that records Review Decisions without affecting delivery.
_Avoid_: Optional validation, dry run

**Enforced Review**:
A review mode in which Delivery Policy acts on the Review Decision before results can be published. It is enabled only after Review Calibration meets the pre-registered enforcement thresholds.
_Avoid_: Hard validation, production review

**Review Calibration**:
The measured error-detection, false-rejection, stability, latency, and cost profile used to decide whether a review capability may gain blocking authority.
_Avoid_: Benchmark score, prompt tuning

**Assurance Circuit Breaker**:
The control that removes blocking authority and returns Enforced Review to Shadow Review when calibration assumptions, availability, latency, cost, or observed precision degrade.
_Avoid_: Reviewer retry, automatic approval

**Delivery Policy**:
The environment-specific rule applied after a Review Decision. Product delivery requires confirmation for unresolved disagreement and otherwise fails closed; Spider2 may submit with disagreement but must not label the submission Approved.
_Avoid_: Reviewer verdict, retry policy
