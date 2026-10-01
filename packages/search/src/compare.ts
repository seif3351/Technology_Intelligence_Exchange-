import type { AssessmentStatus, ConstraintPriority, TrustTier } from '@atx/domain';

/**
 * Side-by-side comparison matrix: one row per constraint, one cell per
 * offering. Built from match results so web, API and MCP share one truth.
 */
export interface ComparisonCell {
  readonly offeringId: string;
  readonly status: AssessmentStatus;
  readonly strongestTrustTier: TrustTier | null;
  readonly claimIds: readonly string[];
}

export interface ComparisonRow {
  readonly constraintId: string;
  readonly description: string;
  readonly priority: ConstraintPriority;
  readonly cells: readonly ComparisonCell[];
}

/** Structural input so both MatchResult and presented match views can be compared. */
export interface ComparableMatch {
  readonly offeringId: string;
  readonly assessments: readonly {
    readonly constraintId: string;
    readonly description: string;
    readonly priority: ConstraintPriority;
    readonly status: AssessmentStatus;
    readonly strongestTrustTier: TrustTier | null;
    readonly supportingClaims: readonly { readonly claimId: string }[];
  }[];
}

export const buildComparisonMatrix = (matches: readonly ComparableMatch[]): ComparisonRow[] => {
  const first = matches[0];
  if (!first) return [];
  return first.assessments.map((template) => ({
    constraintId: template.constraintId,
    description: template.description,
    priority: template.priority,
    cells: matches.map((match) => {
      const assessment = match.assessments.find((a) => a.constraintId === template.constraintId);
      return {
        offeringId: match.offeringId,
        status: assessment?.status ?? 'unknown',
        strongestTrustTier: assessment?.strongestTrustTier ?? null,
        claimIds: assessment?.supportingClaims.map((claim) => claim.claimId) ?? [],
      };
    }),
  }));
};
