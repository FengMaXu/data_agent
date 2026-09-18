export interface HypothesisChoiceOption {
  readonly id: string;
  readonly statement: string;
}

export interface HypothesisChoiceEvidence {
  readonly id: string;
  readonly kind: string;
  readonly authority: string;
  readonly authorityRank: number;
  readonly sourceRef: string;
  readonly content: string;
}

export interface CompareHypothesesInput {
  readonly originalQuestion: string;
  readonly hypotheses: readonly HypothesisChoiceOption[];
  readonly evidence: readonly HypothesisChoiceEvidence[];
}

export type HypothesisChoiceRecommendation =
  | { readonly kind: "hypothesis"; readonly hypothesisId: string }
  | { readonly kind: "insufficient_evidence" }
  | { readonly kind: "multiple_plausible" }
  | { readonly kind: "none_supported" };

export interface HypothesisChoiceAssessment {
  readonly model: string;
  readonly recommendation: HypothesisChoiceRecommendation;
  readonly probabilities: readonly { readonly hypothesisId: string; readonly probability: number }[];
  readonly abstentionProbabilities: {
    readonly insufficientEvidence: number;
    readonly multiplePlausible: number;
    readonly noneSupported: number;
  };
  readonly confidence: number;
}

/**
 * A narrow, advisory judgment seam. Implementations compare already-declared
 * alternatives against already-collected evidence. They do not mutate an
 * Answer Spec, qualify evidence, or authorize publication.
 */
export interface HypothesisChoiceAdvisor {
  compare(input: CompareHypothesesInput, options?: { readonly signal?: AbortSignal }): Promise<HypothesisChoiceAssessment>;
}
