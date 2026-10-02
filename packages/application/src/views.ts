import {
  type Asset,
  type Capability,
  type ConstraintAssessment,
  type Evidence,
  type MatchResult,
  type Offering,
  type Ontology,
  type Organization,
  type RequirementConstraint,
  type TechnicalClaim,
  describeConstraint,
  describePredicate,
  describeTrustTier,
  detectInjectionSignals,
  trustTier,
} from '@atx/domain';

/**
 * Read models shared by every interface (web, HTTP API, MCP). They are plain
 * data: adapters validate them against @atx/contracts before sending.
 *
 * Supplier-authored free text is always marked `untrusted: true` so that
 * downstream agents treat it as data, never as instructions.
 */
export interface ConceptRef {
  readonly id: string;
  readonly label: string;
  readonly facet: string;
}

export interface OrganizationRef {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly verificationState: string;
  readonly isDemo: boolean;
}

export interface ClaimView {
  readonly id: string;
  readonly subject: { readonly type: string; readonly id: string };
  readonly predicate: string;
  readonly predicateLabel: string;
  readonly concept: ConceptRef;
  readonly qualifiers: Readonly<Record<string, string>>;
  readonly statement: string;
  readonly untrusted: true;
  readonly provenance: {
    readonly category: string;
    readonly sourceType: string;
    readonly sourceReference: string | null;
    readonly sourceUrl: string | null;
    readonly sourceVersion: string | null;
    readonly evidenceIds: readonly string[];
  };
  readonly trustTier: string;
  readonly trustLabel: string;
  readonly verification: { readonly status: string; readonly verifiedAt: string | null };
  readonly confidence: string;
  readonly status: string;
  readonly reviewAt: string | null;
  readonly expiresAt: string | null;
  readonly contentWarnings: readonly string[];
  /** For optimistic concurrency on owner edits. */
  readonly version: number;
}

export interface EvidenceView {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly description: string;
  readonly untrusted: true;
  readonly url: string | null;
  readonly assetId: string | null;
  readonly offeringId: string | null;
  readonly provenance: {
    readonly category: string;
    readonly sourceType: string;
    readonly sourceReference: string | null;
    readonly sourceVersion: string | null;
  };
  readonly customerDisclosure: string | null;
}

export interface VideoView {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly untrusted: true;
  readonly offeringId: string | null;
  readonly organizationId: string;
  readonly contentType: string;
  readonly durationSeconds: number | null;
  readonly thumbnailUrl: string | null;
  /** External https URL or short-lived signed URL. */
  readonly playbackUrl: string | null;
  readonly processingState: string;
  readonly isDemo: boolean;
}

export interface OfferingSummaryView {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly type: string;
  readonly summary: string;
  readonly untrusted: true;
  readonly maturity: string;
  readonly status: string;
  readonly organization: OrganizationRef;
  readonly isDemo: boolean;
  readonly keyConcepts: readonly ConceptRef[];
}

export interface OfferingDetailView extends OfferingSummaryView {
  readonly description: string;
  readonly details: Offering['details'];
  readonly commercial: Offering['commercial'];
  readonly regions: readonly string[];
  readonly publishedAt: string | null;
  readonly version: number;
  readonly claims: readonly ClaimView[];
  readonly organizationClaims: readonly ClaimView[];
  readonly evidence: readonly EvidenceView[];
  readonly videos: readonly VideoView[];
}

export interface SupplierView {
  readonly organization: OrganizationRef & {
    readonly kind: string;
    readonly summary: string;
    readonly description: string;
    readonly untrusted: true;
    readonly website: string | null;
    readonly headquartersCountry: string | null;
    readonly regions: readonly string[];
    readonly employeeRange: string | null;
    readonly verifiedAt: string | null;
  };
  readonly offerings: readonly OfferingSummaryView[];
  readonly capabilities: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly concept: ConceptRef;
  }[];
  readonly organizationClaims: readonly ClaimView[];
  readonly evidence: readonly EvidenceView[];
}

export interface ConstraintView {
  readonly id: string;
  readonly kind: string;
  readonly priority: string;
  readonly level: string | null;
  readonly concept: ConceptRef | null;
  readonly qualifiers: Readonly<Record<string, string>>;
  readonly minimumMaturity: string | null;
  readonly origin: string;
  readonly description: string;
}

export interface AssessmentView extends Omit<ConstraintAssessment, 'conceptId' | 'supportingClaims'> {
  readonly concept: ConceptRef | null;
  readonly strongestTrustLabel: string | null;
  readonly supportingClaims: readonly {
    readonly claimId: string;
    readonly predicate: string;
    readonly trustTier: string;
    readonly statement: string;
    readonly untrusted: true;
  }[];
}

export interface MatchView {
  readonly rank: number;
  readonly offering: OfferingSummaryView;
  readonly hardConstraintStatus: MatchResult['hardConstraintStatus'];
  readonly score: number;
  readonly scoreComponents: MatchResult['scoreComponents'];
  readonly confidence: MatchResult['confidence'];
  readonly summary: string;
  readonly assessments: readonly AssessmentView[];
  readonly gaps: MatchResult['gaps'];
}

// ------------------------------------------------------------------ presenters

export const conceptRef = (ontology: Ontology, id: string): ConceptRef => {
  const concept = ontology.getConcept(id as never);
  return { id, label: concept?.label ?? id, facet: concept?.facetId ?? 'unknown' };
};

export const organizationRef = (org: Organization): OrganizationRef => ({
  id: org.id,
  slug: org.slug,
  name: org.name,
  verificationState: org.verificationState,
  isDemo: org.isDemo,
});

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

export const presentClaim = (claim: TechnicalClaim, ontology: Ontology): ClaimView => {
  const tier = trustTier(claim.provenance, claim.verification);
  return {
    id: claim.id,
    subject: { type: claim.subject.type, id: claim.subject.id },
    predicate: claim.predicate,
    predicateLabel: describePredicate(claim.predicate),
    concept: conceptRef(ontology, claim.conceptId),
    qualifiers: claim.qualifiers,
    statement: claim.statement,
    untrusted: true,
    provenance: {
      category: claim.provenance.category,
      sourceType: claim.provenance.sourceType,
      sourceReference: claim.provenance.sourceReference,
      sourceUrl: claim.provenance.sourceUrl,
      sourceVersion: claim.provenance.sourceVersion,
      evidenceIds: claim.provenance.evidenceIds,
    },
    trustTier: tier,
    trustLabel: describeTrustTier(tier),
    verification: { status: claim.verification.status, verifiedAt: iso(claim.verification.verifiedAt) },
    confidence: claim.confidence,
    status: claim.status,
    reviewAt: iso(claim.reviewAt),
    expiresAt: iso(claim.expiresAt),
    contentWarnings:
      detectInjectionSignals(claim.statement).length > 0 ? ['possible_instruction_like_content'] : [],
    version: claim.version,
  };
};

export const presentEvidence = (evidence: Evidence): EvidenceView => ({
  id: evidence.id,
  kind: evidence.kind,
  title: evidence.title,
  description: evidence.description,
  untrusted: true,
  url: evidence.url,
  assetId: evidence.assetId,
  offeringId: evidence.offeringId,
  provenance: {
    category: evidence.provenance.category,
    sourceType: evidence.provenance.sourceType,
    sourceReference: evidence.provenance.sourceReference,
    sourceVersion: evidence.provenance.sourceVersion,
  },
  customerDisclosure: evidence.customerDisclosure,
});

export const presentVideo = (asset: Asset, playbackUrl: string | null): VideoView => ({
  id: asset.id,
  title: asset.title,
  description: asset.description,
  untrusted: true,
  offeringId: asset.offeringId,
  organizationId: asset.organizationId,
  contentType: asset.contentType,
  durationSeconds: asset.durationSeconds,
  thumbnailUrl: asset.thumbnailUrl,
  playbackUrl,
  processingState: asset.processingState,
  isDemo: asset.isDemo,
});

/** The concepts an offering is best known for: published offering-level claims, strongest predicates first. */
export const keyConcepts = (
  offeringClaims: readonly TechnicalClaim[],
  ontology: Ontology,
  max = 6,
): ConceptRef[] => {
  const seen = new Set<string>();
  const result: ConceptRef[] = [];
  for (const claim of offeringClaims) {
    if (claim.subject.type !== 'offering' || claim.status !== 'published' || seen.has(claim.conceptId))
      continue;
    seen.add(claim.conceptId);
    result.push(conceptRef(ontology, claim.conceptId));
    if (result.length >= max) break;
  }
  return result;
};

export const presentOfferingSummary = (
  offering: Offering,
  organization: Organization,
  claims: readonly TechnicalClaim[],
  ontology: Ontology,
): OfferingSummaryView => ({
  id: offering.id,
  slug: offering.slug,
  name: offering.name,
  type: offering.type,
  summary: offering.summary,
  untrusted: true,
  maturity: offering.maturity,
  status: offering.status,
  organization: organizationRef(organization),
  isDemo: offering.isDemo || organization.isDemo,
  keyConcepts: keyConcepts(
    claims.filter((claim) => claim.subject.type === 'offering' && claim.subject.id === offering.id),
    ontology,
  ),
});

export const presentConstraint = (constraint: RequirementConstraint, ontology: Ontology): ConstraintView => {
  switch (constraint.kind) {
    case 'concept': {
      const concept = conceptRef(ontology, constraint.conceptId);
      return {
        id: constraint.id,
        kind: constraint.kind,
        priority: constraint.priority,
        level: constraint.level,
        concept,
        qualifiers: constraint.qualifiers,
        minimumMaturity: null,
        origin: constraint.origin,
        description: describeConstraint(constraint, concept.label),
      };
    }
    case 'maturity':
      return {
        id: constraint.id,
        kind: constraint.kind,
        priority: constraint.priority,
        level: null,
        concept: null,
        qualifiers: {},
        minimumMaturity: constraint.minimum,
        origin: constraint.origin,
        description: describeConstraint(constraint),
      };
    case 'production_reference':
      return {
        id: constraint.id,
        kind: constraint.kind,
        priority: constraint.priority,
        level: 'production',
        concept: null,
        qualifiers: {},
        minimumMaturity: null,
        origin: constraint.origin,
        description: describeConstraint(constraint),
      };
  }
};

export const presentMatch = (
  rank: number,
  match: MatchResult,
  offering: OfferingSummaryView,
  ontology: Ontology,
): MatchView => ({
  rank,
  offering,
  hardConstraintStatus: match.hardConstraintStatus,
  score: match.score,
  scoreComponents: match.scoreComponents,
  confidence: match.confidence,
  summary: match.summary,
  assessments: match.assessments.map((assessment) => ({
    constraintId: assessment.constraintId,
    description: assessment.description,
    priority: assessment.priority,
    level: assessment.level,
    status: assessment.status,
    concept: assessment.conceptId ? conceptRef(ontology, assessment.conceptId) : null,
    strongestTrustTier: assessment.strongestTrustTier,
    strongestTrustLabel: assessment.strongestTrustTier
      ? describeTrustTier(assessment.strongestTrustTier)
      : null,
    supportingClaims: assessment.supportingClaims.map((claim) => ({
      claimId: claim.claimId,
      predicate: claim.predicate,
      trustTier: claim.trustTier,
      statement: claim.statement,
      untrusted: true as const,
    })),
    explanation: assessment.explanation,
  })),
  gaps: match.gaps,
});

export const presentCapability = (capability: Capability, ontology: Ontology) => ({
  id: capability.id,
  name: capability.name,
  description: capability.description,
  concept: conceptRef(ontology, capability.conceptId),
});
