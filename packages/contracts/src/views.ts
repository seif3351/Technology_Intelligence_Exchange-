import { z } from 'zod';
import { Untrusted } from './common';

export const ConceptRef = z.object({ id: z.string(), label: z.string(), facet: z.string() }).meta({ id: 'ConceptRef' });

export const OrganizationRef = z
  .object({ id: z.string(), slug: z.string(), name: z.string(), verificationState: z.string(), isDemo: z.boolean() })
  .meta({ id: 'OrganizationRef' });

export const Provenance = z.object({
  category: z.string().describe('SUPPLIER_VERIFIED | PUBLIC_SOURCE | LICENSED_THIRD_PARTY | INTERNAL | AI_INFERRED | UNVERIFIED'),
  sourceType: z.string(),
  sourceReference: z.string().nullable(),
  sourceUrl: z.string().nullable().optional(),
  sourceVersion: z.string().nullable(),
  evidenceIds: z.array(z.string()).optional(),
});

export const ClaimView = z
  .object({
    id: z.string(),
    subject: z.object({ type: z.string(), id: z.string() }),
    predicate: z.string(),
    predicateLabel: z.string(),
    concept: ConceptRef,
    qualifiers: z.record(z.string(), z.string()),
    statement: z.string(),
    untrusted: Untrusted,
    provenance: Provenance,
    trustTier: z.string(),
    trustLabel: z.string(),
    verification: z.object({ status: z.string(), verifiedAt: z.string().nullable() }),
    confidence: z.string(),
    status: z.string(),
    reviewAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
    contentWarnings: z.array(z.string()),
    version: z.number().int(),
  })
  .meta({ id: 'Claim' });

export const EvidenceView = z
  .object({
    id: z.string(),
    kind: z.string(),
    title: z.string(),
    description: z.string(),
    untrusted: Untrusted,
    url: z.string().nullable(),
    assetId: z.string().nullable(),
    offeringId: z.string().nullable(),
    provenance: Provenance,
    customerDisclosure: z.string().nullable(),
  })
  .meta({ id: 'Evidence' });

export const VideoView = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    untrusted: Untrusted,
    offeringId: z.string().nullable(),
    organizationId: z.string(),
    contentType: z.string(),
    durationSeconds: z.number().nullable(),
    thumbnailUrl: z.string().nullable(),
    playbackUrl: z.string().nullable(),
    processingState: z.string(),
    isDemo: z.boolean(),
  })
  .meta({ id: 'Video' });

export const OfferingSummary = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    type: z.string(),
    summary: z.string(),
    untrusted: Untrusted,
    maturity: z.string(),
    status: z.string(),
    organization: OrganizationRef,
    isDemo: z.boolean(),
    keyConcepts: z.array(ConceptRef),
  })
  .meta({ id: 'OfferingSummary' });

export const OfferingDetail = OfferingSummary.extend({
  description: z.string(),
  details: z.record(z.string(), z.unknown()),
  commercial: z.object({ pricingModel: z.string().nullable(), availability: z.array(z.string()), notes: z.string().nullable() }),
  regions: z.array(z.string()),
  publishedAt: z.string().nullable(),
  version: z.number().int(),
  claims: z.array(ClaimView),
  organizationClaims: z.array(ClaimView),
  evidence: z.array(EvidenceView),
  videos: z.array(VideoView),
}).meta({ id: 'OfferingDetail' });

export const SupplierView = z
  .object({
    organization: OrganizationRef.extend({
      kind: z.string(),
      summary: z.string(),
      description: z.string(),
      untrusted: Untrusted,
      website: z.string().nullable(),
      headquartersCountry: z.string().nullable(),
      regions: z.array(z.string()),
      employeeRange: z.string().nullable(),
      verifiedAt: z.string().nullable(),
    }),
    offerings: z.array(OfferingSummary),
    capabilities: z.array(z.object({ id: z.string(), name: z.string(), description: z.string(), concept: ConceptRef })),
    organizationClaims: z.array(ClaimView),
    evidence: z.array(EvidenceView),
  })
  .meta({ id: 'Supplier' });

export const ConstraintView = z
  .object({
    id: z.string(),
    kind: z.string(),
    priority: z.string(),
    level: z.string().nullable(),
    concept: ConceptRef.nullable(),
    qualifiers: z.record(z.string(), z.string()),
    minimumMaturity: z.string().nullable(),
    origin: z.string(),
    description: z.string(),
  })
  .meta({ id: 'Constraint' });

export const Interpretation = z
  .object({
    constraints: z.array(ConstraintView),
    unrecognizedTerms: z.array(z.string()),
    notes: z.array(z.string()),
    method: z.string(),
  })
  .meta({ id: 'Interpretation' });

export const ScoreComponent = z.object({ name: z.string(), weight: z.number(), value: z.number(), explanation: z.string() });

export const Assessment = z
  .object({
    constraintId: z.string(),
    description: z.string(),
    priority: z.string(),
    level: z.string().nullable(),
    status: z.enum(['met', 'partial', 'unmet', 'unknown']),
    concept: ConceptRef.nullable(),
    strongestTrustTier: z.string().nullable(),
    strongestTrustLabel: z.string().nullable(),
    supportingClaims: z.array(z.object({ claimId: z.string(), predicate: z.string(), trustTier: z.string(), statement: z.string(), untrusted: Untrusted })),
    explanation: z.string(),
  })
  .meta({ id: 'Assessment' });

export const Gap = z.object({ constraintId: z.string(), description: z.string(), kind: z.string(), suggestedQuestion: z.string() });

export const Match = z
  .object({
    rank: z.number().int(),
    offering: OfferingSummary,
    hardConstraintStatus: z.enum(['all_met', 'some_unknown', 'some_unmet', 'none_specified']),
    score: z.number(),
    scoreComponents: z.array(ScoreComponent),
    confidence: z.enum(['high', 'medium', 'low']),
    summary: z.string(),
    assessments: z.array(Assessment),
    gaps: z.array(Gap),
  })
  .meta({ id: 'Match' });

export const MatchResponse = z
  .object({
    interpretation: Interpretation,
    matches: z.array(Match),
    nextCursor: z.string().nullable(),
    totalCandidatesEvaluated: z.number().int(),
    degraded: z.array(z.string()),
  })
  .meta({ id: 'MatchResponse' });

export const ComparisonRow = z.object({
  constraintId: z.string(),
  description: z.string(),
  priority: z.string(),
  cells: z.array(z.object({ offeringId: z.string(), status: z.string(), strongestTrustTier: z.string().nullable(), claimIds: z.array(z.string()) })),
});

export const CompareResponse = MatchResponse.extend({ matrix: z.array(ComparisonRow) }).meta({ id: 'CompareResponse' });

export const OfferingSearchResponse = z
  .object({
    interpretation: Interpretation,
    items: z.array(z.object({ offering: OfferingSummary, relevance: z.number(), matchedConcepts: z.array(ConceptRef) })),
    nextCursor: z.string().nullable(),
    degraded: z.array(z.string()),
  })
  .meta({ id: 'OfferingSearchResponse' });

export const SupplierSearchResponse = z
  .object({
    items: z.array(OrganizationRef.extend({ summary: z.string(), untrusted: Untrusted, headquartersCountry: z.string().nullable(), regions: z.array(z.string()) })),
    nextCursor: z.string().nullable(),
  })
  .meta({ id: 'SupplierSearchResponse' });

export const Technology = ConceptRef.extend({
  description: z.string(),
  aliases: z.array(z.string()),
  broader: z.array(ConceptRef),
  narrower: z.array(ConceptRef),
  related: z.array(ConceptRef.extend({ relation: z.string() })),
  publishedOfferingCount: z.number().int(),
}).meta({ id: 'Technology' });

export const EvidenceResponse = z.object({ claims: z.array(ClaimView), evidence: z.array(EvidenceView) }).meta({ id: 'EvidenceResponse' });
export const DemoResponse = z.object({ videos: z.array(VideoView), offerings: z.array(OfferingSummary) }).meta({ id: 'DemoResponse' });

export const RequirementView = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    title: z.string(),
    description: z.string(),
    constraints: z.array(ConstraintView),
    confidentialTermCount: z.number().int(),
    visibility: z.string(),
    status: z.string(),
    version: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: 'Requirement' });

export const ValidationIssue = z.object({ severity: z.enum(['error', 'warning', 'info']), code: z.string(), message: z.string() });

export const RequirementValidation = z
  .object({ valid: z.boolean(), issues: z.array(ValidationIssue), constraints: z.array(ConstraintView), unrecognizedTerms: z.array(z.string()) })
  .meta({ id: 'RequirementValidation' });

export const EngagementPreview = z
  .object({
    preview: z.object({
      type: z.string(),
      recipient: z.object({ supplierName: z.string(), offeringName: z.string() }),
      willBeShared: z.object({
        buyerOrganizationName: z.string(),
        contactName: z.string(),
        contactEmail: z.string(),
        message: z.string(),
        disclosedSummary: z.string().nullable(),
        constraints: z.array(ConstraintView),
      }),
      willNotBeShared: z.array(z.string()),
    }),
    confirmationToken: z.string(),
    expiresAt: z.string(),
    requiresHumanConfirmation: z.literal(true),
  })
  .meta({ id: 'EngagementPreview' });

export const Engagement = z
  .object({
    id: z.string(),
    type: z.string(),
    status: z.string(),
    buyerOrganizationId: z.string(),
    supplierOrganizationId: z.string(),
    offeringId: z.string().nullable(),
    disclosure: z.object({
      buyerOrganizationName: z.string(),
      contactName: z.string(),
      contactEmail: z.string(),
      message: z.string(),
      requirement: z
        .object({
          reference: z.string(),
          constraints: z.array(z.record(z.string(), z.unknown())),
          disclosedSummary: z.string().nullable(),
        })
        .nullable(),
    }),
    createdAt: z.string(),
  })
  .meta({ id: 'Engagement' });
