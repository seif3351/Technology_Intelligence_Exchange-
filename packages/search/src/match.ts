import {
  type ConceptConstraint,
  type ConstraintAssessment,
  type Gap,
  type HardConstraintStatus,
  type MatchResult,
  type Offering,
  type Ontology,
  type Organization,
  type RequirementConstraint,
  SATISFYING_PREDICATES,
  type SupportingClaimRef,
  type TechnicalClaim,
  TRUST_TIERS,
  type TrustTier,
  describeConstraint,
  describePredicate,
  describeTrustTier,
  formatQualifiers,
  isClaimActive,
  meetsOrdinal,
  ordinalRequirements,
  maturityAtLeast,
  trustTier,
} from '@atx/domain';
import { buildScore } from './score';

/** Everything the matcher needs to know about one candidate offering. */
export interface MatchCandidate {
  readonly offering: Offering;
  readonly organization: Pick<Organization, 'id' | 'name' | 'verificationState'>;
  /** Claims about the offering, its organization, and its linked capabilities. */
  readonly claims: readonly TechnicalClaim[];
  readonly hasProductionReferenceEvidence: boolean;
  /** Retrieval relevance normalized to 0..1 (keyword + semantic fusion). */
  readonly textRelevance: number;
}

export const evaluateCandidate = (
  candidate: MatchCandidate,
  constraints: readonly RequirementConstraint[],
  ontology: Ontology,
  now: Date,
): MatchResult => {
  const activeClaims = candidate.claims.filter((claim) => isClaimActive(claim, now));
  const assessments = constraints.map((constraint) =>
    assessConstraint(constraint, candidate, activeClaims, ontology),
  );
  const hardConstraintStatus = summarizeHard(assessments);
  const { components, score } = buildScore(assessments, candidate.textRelevance);
  return {
    offeringId: candidate.offering.id,
    organizationId: candidate.offering.organizationId,
    hardConstraintStatus,
    assessments,
    scoreComponents: components,
    score,
    confidence: deriveConfidence(assessments, hardConstraintStatus),
    gaps: deriveGaps(assessments, candidate.offering.name),
    summary: summarize(assessments, hardConstraintStatus),
  };
};

const assessConstraint = (
  constraint: RequirementConstraint,
  candidate: MatchCandidate,
  claims: readonly TechnicalClaim[],
  ontology: Ontology,
): ConstraintAssessment => {
  switch (constraint.kind) {
    case 'concept':
      return assessConceptConstraint(constraint, claims, ontology);
    case 'maturity': {
      const met = maturityAtLeast(candidate.offering.maturity, constraint.minimum);
      return {
        constraintId: constraint.id,
        description: describeConstraint(constraint),
        priority: constraint.priority,
        level: null,
        conceptId: null,
        status: met ? 'met' : 'unmet',
        strongestTrustTier: 'supplier_verified',
        supportingClaims: [],
        explanation: `Supplier states the offering maturity is "${candidate.offering.maturity}".`,
      };
    }
    case 'production_reference': {
      const productionClaims = claims.filter((claim) => claim.predicate === 'PRODUCTION_DEPLOYMENT');
      const refs = productionClaims.map(toRef(ontology));
      const met = productionClaims.length > 0 || candidate.hasProductionReferenceEvidence;
      return {
        constraintId: constraint.id,
        description: describeConstraint(constraint),
        priority: constraint.priority,
        level: 'production',
        conceptId: null,
        status: met ? 'met' : 'unknown',
        strongestTrustTier: strongest(refs.map((ref) => ref.trustTier)),
        supportingClaims: refs,
        explanation: met
          ? `${productionClaims.length} production-deployment claim(s)${candidate.hasProductionReferenceEvidence ? ' and production-reference evidence' : ''}.`
          : 'No production deployment claims or production-reference evidence found.',
      };
    }
  }
};

/**
 * Ordinal qualifiers (ASIL, ASPICE capability level, CAL) are minimums: a claim
 * meets "ASIL B or higher" with ASIL B, C or D. A claim that does not state
 * the level never counts as meeting it.
 */
const qualifiersSatisfied = (
  constraint: ConceptConstraint,
  claim: TechnicalClaim,
): 'yes' | 'no' | 'unknown' => {
  let verdict: 'yes' | 'no' | 'unknown' = 'yes';
  for (const { qualifier, value } of ordinalRequirements(constraint.qualifiers)) {
    const result = meetsOrdinal(qualifier.key, claim.qualifiers[qualifier.key], value);
    if (result === 'no') return 'no';
    if (result === 'unknown') verdict = 'unknown';
  }
  return verdict;
};

/** Why a claim's qualifiers fall short, e.g. "the claim states CL1, not CL2 or higher". */
const qualifierShortfall = (constraint: ConceptConstraint, claim: TechnicalClaim): string => {
  const required = ordinalRequirements(constraint.qualifiers);
  const missing = required.filter(({ qualifier }) => claim.qualifiers[qualifier.key] === undefined);
  const wanted = required.map(({ qualifier, value }) => `${qualifier.format(value)} or higher`).join(', ');
  if (missing.length > 0)
    return `the claim does not state ${missing.map(({ qualifier }) => `the ${qualifier.label}`).join(' or ')} (required: ${wanted})`;
  const stated = formatQualifiers(
    Object.fromEntries(
      required.map(({ qualifier }) => [qualifier.key, claim.qualifiers[qualifier.key] ?? '']),
    ),
  ).join(', ');
  return `the claim states ${stated}, not ${wanted}`;
};

const assessConceptConstraint = (
  constraint: ConceptConstraint,
  claims: readonly TechnicalClaim[],
  ontology: Ontology,
): ConstraintAssessment => {
  const concept = ontology.getConcept(constraint.conceptId);
  const label = concept?.label ?? constraint.conceptId;
  const description = describeConstraint(constraint, label);
  const acceptable = SATISFYING_PREDICATES[constraint.level];

  const relevant = claims.filter((claim) => ontology.satisfies(claim.conceptId, constraint.conceptId));
  const satisfying = relevant.filter(
    (claim) => acceptable.includes(claim.predicate) && qualifiersSatisfied(constraint, claim) === 'yes',
  );
  const toRefs = toRef(ontology);

  if (satisfying.length > 0) {
    const refs = satisfying.map(toRefs);
    const tier = strongest(refs.map((ref) => ref.trustTier));
    return {
      constraintId: constraint.id,
      description,
      priority: constraint.priority,
      level: constraint.level,
      conceptId: constraint.conceptId,
      status: 'met',
      strongestTrustTier: tier,
      supportingClaims: refs,
      explanation: `Met by ${refs.length} claim(s); strongest basis: ${tier ? describeTrustTier(tier) : 'n/a'}.`,
    };
  }

  // Related information at a weaker level, or about a broader concept.
  const broaderClaims = claims.filter((claim) => ontology.broader(constraint.conceptId).has(claim.conceptId));
  const partial = [...relevant, ...broaderClaims];
  if (partial.length > 0) {
    const refs = partial.map(toRefs);
    const reasons = partial.map((claim) => {
      const claimLabel = ontology.getConcept(claim.conceptId)?.label ?? claim.conceptId;
      if (
        claim.conceptId !== constraint.conceptId &&
        !ontology.satisfies(claim.conceptId, constraint.conceptId)
      ) {
        return `claims "${claimLabel}" in general, not specifically "${label}"`;
      }
      if (qualifiersSatisfied(constraint, claim) !== 'yes') return qualifierShortfall(constraint, claim);
      return `the claim "${describePredicate(claim.predicate)}" is weaker than required`;
    });
    return {
      constraintId: constraint.id,
      description,
      priority: constraint.priority,
      level: constraint.level,
      conceptId: constraint.conceptId,
      status: 'partial',
      strongestTrustTier: strongest(refs.map((ref) => ref.trustTier)),
      supportingClaims: refs,
      explanation: `Partially supported: ${[...new Set(reasons)].join('; ')}.`,
    };
  }

  return {
    constraintId: constraint.id,
    description,
    priority: constraint.priority,
    level: constraint.level,
    conceptId: constraint.conceptId,
    status: 'unknown',
    strongestTrustTier: null,
    supportingClaims: [],
    explanation: `No published information about ${label} (unknown, not unsupported).`,
  };
};

const toRef =
  (ontology: Ontology) =>
  (claim: TechnicalClaim): SupportingClaimRef => ({
    claimId: claim.id,
    conceptId: claim.conceptId,
    predicate: claim.predicate,
    trustTier: trustTier(claim.provenance, claim.verification),
    statement: claim.statement || (ontology.getConcept(claim.conceptId)?.label ?? claim.conceptId),
  });

const strongest = (tiers: readonly TrustTier[]): TrustTier | null => {
  for (const tier of TRUST_TIERS) if (tiers.includes(tier)) return tier;
  return null;
};

const summarizeHard = (assessments: readonly ConstraintAssessment[]): HardConstraintStatus => {
  const hard = assessments.filter((assessment) => assessment.priority === 'hard');
  if (hard.length === 0) return 'none_specified';
  if (hard.some((assessment) => assessment.status === 'unmet')) return 'some_unmet';
  if (hard.some((assessment) => assessment.status !== 'met')) return 'some_unknown';
  return 'all_met';
};

const WEAK_TIERS: readonly TrustTier[] = ['unverified', 'ai_inferred'];

const deriveConfidence = (
  assessments: readonly ConstraintAssessment[],
  hardStatus: HardConstraintStatus,
): MatchResult['confidence'] => {
  const met = assessments.filter((assessment) => assessment.status === 'met');
  const weak = met.filter(
    (assessment) => assessment.strongestTrustTier && WEAK_TIERS.includes(assessment.strongestTrustTier),
  );
  const evidenced = met.filter(
    (assessment) =>
      assessment.strongestTrustTier === 'platform_verified' ||
      assessment.strongestTrustTier === 'supplier_verified_with_evidence',
  );
  if (hardStatus === 'some_unmet') return 'low';
  if (hardStatus === 'all_met' && weak.length === 0 && evidenced.length * 2 >= met.length) return 'high';
  const unknownHard = assessments.filter((a) => a.priority === 'hard' && a.status !== 'met').length;
  if ((hardStatus === 'all_met' || unknownHard <= 1) && weak.length === 0) return 'medium';
  return 'low';
};

const deriveGaps = (assessments: readonly ConstraintAssessment[], offeringName: string): Gap[] =>
  assessments.flatMap((assessment): Gap[] => {
    switch (assessment.status) {
      case 'unknown':
        return [
          {
            constraintId: assessment.constraintId,
            description: `No information: ${assessment.description}`,
            kind: 'missing_information',
            suggestedQuestion: `Does ${offeringName} meet "${assessment.description}"? Please share supporting documentation.`,
          },
        ];
      case 'partial':
        return [
          {
            constraintId: assessment.constraintId,
            description: assessment.explanation,
            kind: 'weaker_than_required',
            suggestedQuestion: `The published information is weaker than "${assessment.description}". Can you provide evidence at that level?`,
          },
        ];
      case 'unmet':
        return [
          {
            constraintId: assessment.constraintId,
            description: `${assessment.description}: ${assessment.explanation}`,
            kind: 'contradicted',
            suggestedQuestion: `Is there a roadmap for ${offeringName} to meet "${assessment.description}"?`,
          },
        ];
      case 'met':
        return assessment.strongestTrustTier && WEAK_TIERS.includes(assessment.strongestTrustTier)
          ? [
              {
                constraintId: assessment.constraintId,
                description: `Only weakly evidenced: ${assessment.description}`,
                kind: 'unverified',
                suggestedQuestion: `Can you provide documentation confirming "${assessment.description}"?`,
              },
            ]
          : [];
    }
  });

const summarize = (
  assessments: readonly ConstraintAssessment[],
  hardStatus: HardConstraintStatus,
): string => {
  const hard = assessments.filter((assessment) => assessment.priority === 'hard');
  const count = (status: string) => hard.filter((assessment) => assessment.status === status).length;
  if (hardStatus === 'none_specified')
    return 'No hard constraints were specified; ranked by relevance and evidence.';
  const parts = [`meets ${count('met')} of ${hard.length} hard constraints`];
  if (count('partial') > 0) parts.push(`${count('partial')} only partially supported`);
  if (count('unknown') > 0) parts.push(`${count('unknown')} unknown`);
  if (count('unmet') > 0) parts.push(`${count('unmet')} not met`);
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
};
