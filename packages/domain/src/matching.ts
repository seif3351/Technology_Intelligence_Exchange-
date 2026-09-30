import type { ClaimId, ConceptId, OfferingId, OrganizationId } from './ids';
import type { Confidence, TrustTier } from './provenance';
import type { ConstraintLevel, ConstraintPriority } from './requirement';

/**
 * Outcome of evaluating one constraint against one candidate.
 *  - met:     satisfied by an active claim at the required level
 *  - partial: related claims exist but at a weaker level (e.g. "designed for" vs "certified")
 *  - unmet:   the candidate's own data contradicts the constraint (e.g. maturity is below minimum)
 *  - unknown: no information either way — NOT the same as unmet
 */
export const ASSESSMENT_STATUSES = ['met', 'partial', 'unmet', 'unknown'] as const;
export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

export interface SupportingClaimRef {
  readonly claimId: ClaimId;
  readonly conceptId: ConceptId;
  readonly predicate: string;
  readonly trustTier: TrustTier;
  readonly statement: string;
}

export interface ConstraintAssessment {
  readonly constraintId: string;
  readonly description: string;
  readonly priority: ConstraintPriority;
  readonly level: ConstraintLevel | null;
  readonly conceptId: ConceptId | null;
  readonly status: AssessmentStatus;
  /** Strongest trust tier among supporting claims, if any. */
  readonly strongestTrustTier: TrustTier | null;
  readonly supportingClaims: readonly SupportingClaimRef[];
  readonly explanation: string;
}

export interface ScoreComponent {
  readonly name: 'hard_constraints' | 'preferences' | 'evidence_strength' | 'text_relevance';
  readonly weight: number;
  /** 0..1 */
  readonly value: number;
  readonly explanation: string;
}

export interface Gap {
  readonly constraintId: string;
  readonly description: string;
  readonly kind: 'missing_information' | 'weaker_than_required' | 'contradicted' | 'unverified';
  readonly suggestedQuestion: string;
}

export type HardConstraintStatus = 'all_met' | 'some_unknown' | 'some_unmet' | 'none_specified';

export interface MatchResult {
  readonly offeringId: OfferingId;
  readonly organizationId: OrganizationId;
  readonly hardConstraintStatus: HardConstraintStatus;
  readonly assessments: readonly ConstraintAssessment[];
  readonly scoreComponents: readonly ScoreComponent[];
  /** Weighted sum of components, 0..1. Always shown together with its components. */
  readonly score: number;
  readonly confidence: Confidence;
  readonly gaps: readonly Gap[];
  readonly summary: string;
}
