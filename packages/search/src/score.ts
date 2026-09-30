import {
  type AssessmentStatus,
  type ConstraintAssessment,
  type HardConstraintStatus,
  type MatchResult,
  type ScoreComponent,
  TRUST_TIER_WEIGHT,
} from '@atx/domain';

/**
 * Transparent, documented scoring model (see docs/architecture/search-and-matching.md).
 * The score is ALWAYS returned with its components; it orders candidates,
 * it does not certify them. Replace this module to change the model.
 */
export const SCORE_WEIGHTS = {
  hard_constraints: 0.45,
  preferences: 0.15,
  evidence_strength: 0.2,
  text_relevance: 0.2,
} as const;

const STATUS_VALUE: Readonly<Record<AssessmentStatus, number>> = {
  met: 1,
  partial: 0.4,
  unknown: 0.15,
  unmet: 0,
};

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const round = (value: number): number => Math.round(value * 1000) / 1000;

export const buildScore = (
  assessments: readonly ConstraintAssessment[],
  textRelevance: number,
): { components: ScoreComponent[]; score: number } => {
  const hard = assessments.filter((assessment) => assessment.priority === 'hard');
  const preferences = assessments.filter((assessment) => assessment.priority === 'preference');
  const supported = assessments.filter(
    (assessment) => assessment.status === 'met' || assessment.status === 'partial',
  );

  const components: ScoreComponent[] = [
    {
      name: 'hard_constraints',
      weight: SCORE_WEIGHTS.hard_constraints,
      value: hard.length === 0 ? 1 : round(mean(hard.map((a) => STATUS_VALUE[a.status]))),
      explanation:
        hard.length === 0
          ? 'No hard constraints specified.'
          : 'Mean over hard constraints: met=1, partial=0.4, unknown=0.15, unmet=0.',
    },
    {
      name: 'preferences',
      weight: SCORE_WEIGHTS.preferences,
      value: preferences.length === 0 ? 1 : round(mean(preferences.map((a) => STATUS_VALUE[a.status]))),
      explanation:
        preferences.length === 0 ? 'No preferences specified.' : 'Mean over preferences, same scale as hard constraints.',
    },
    {
      name: 'evidence_strength',
      weight: SCORE_WEIGHTS.evidence_strength,
      value: round(
        mean(supported.map((a) => (a.strongestTrustTier ? TRUST_TIER_WEIGHT[a.strongestTrustTier] : 0))),
      ),
      explanation:
        'Mean trust weight of the strongest supporting claim per supported constraint (platform verified=1 … AI-inferred=0.2).',
    },
    {
      name: 'text_relevance',
      weight: SCORE_WEIGHTS.text_relevance,
      value: round(Math.min(1, Math.max(0, textRelevance))),
      explanation: 'Keyword + semantic retrieval relevance (reciprocal rank fusion), normalized to 0..1.',
    },
  ];
  const score = round(components.reduce((sum, component) => sum + component.weight * component.value, 0));
  return { components, score };
};

const HARD_STATUS_RANK: Readonly<Record<HardConstraintStatus, number>> = {
  all_met: 0,
  none_specified: 0,
  some_unknown: 1,
  some_unmet: 2,
};

export interface RankableMatch {
  readonly match: MatchResult;
  readonly tieBreakName: string;
}

/**
 * Deterministic ordering: hard-constraint status first (a candidate with an
 * unmet hard constraint never outranks one without), then score, then name,
 * then id.
 */
export const compareMatches = (a: RankableMatch, b: RankableMatch): number =>
  HARD_STATUS_RANK[a.match.hardConstraintStatus] - HARD_STATUS_RANK[b.match.hardConstraintStatus] ||
  b.match.score - a.match.score ||
  a.tieBreakName.localeCompare(b.tieBreakName) ||
  a.match.offeringId.localeCompare(b.match.offeringId);
