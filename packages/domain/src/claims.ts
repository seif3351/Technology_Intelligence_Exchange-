import { invariant, validationError } from './errors';
import type {
  CapabilityId,
  ClaimId,
  ConceptId,
  OfferingId,
  OrganizationId,
  UserId,
} from './ids';
import {
  type Confidence,
  type Provenance,
  type ProvidedBy,
  type Verification,
  UNREVIEWED,
  validateProvenance,
} from './provenance';
import { sanitizeUntrustedText } from './text';

/**
 * The semantic core of a technical statement. Predicates are a closed set on
 * purpose: they encode distinctions the product must never blur
 * (capability vs certification, support vs production deployment,
 * "designed for" vs "certified"). Concepts (the objects) stay data-driven.
 */
export const CLAIM_PREDICATES = [
  'SUPPORTS', // works with / compatible with (e.g. supports QNX)
  'IMPLEMENTS', // implements a standard or specification (e.g. AUTOSAR Adaptive R23-11)
  'INTEGRATES_WITH', // documented integration with a tool/platform
  'PROVIDES_CAPABILITY', // delivers a capability (e.g. integration testing)
  'TARGETS_DOMAIN', // intended application domain (e.g. ADAS)
  'DESIGNED_FOR', // designed for use in a context (e.g. ASIL-B projects) — NOT certification
  'EXPERIENCE_WITH', // organisation has project experience (e.g. ISO 26262 projects)
  'PROCESS_COMPLIANT', // development process claimed compliant with a standard
  'CERTIFIED', // third-party certification exists (requires certificate details)
  'PRODUCTION_DEPLOYMENT', // deployed in series production
] as const;
export type ClaimPredicate = (typeof CLAIM_PREDICATES)[number];

export const CLAIM_SUBJECT_TYPES = ['organization', 'offering', 'capability'] as const;
export type ClaimSubject =
  | { readonly type: 'organization'; readonly id: OrganizationId }
  | { readonly type: 'offering'; readonly id: OfferingId }
  | { readonly type: 'capability'; readonly id: CapabilityId };

export const CLAIM_STATUSES = ['draft', 'published', 'retracted'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/**
 * Structured qualifiers. Kept as a small open record because qualifiers vary
 * by concept (ASIL level, standard release, certificate id). Well-known keys
 * are validated below.
 */
export type ClaimQualifiers = Readonly<Record<string, string>>;

export const ASIL_LEVELS = ['QM', 'A', 'B', 'C', 'D'] as const;

export interface TechnicalClaim {
  readonly id: ClaimId;
  readonly organizationId: OrganizationId;
  readonly subject: ClaimSubject;
  readonly predicate: ClaimPredicate;
  readonly conceptId: ConceptId;
  readonly qualifiers: ClaimQualifiers;
  /** The statement exactly as the source phrased it (untrusted text). */
  readonly statement: string;
  readonly provenance: Provenance;
  readonly providedBy: ProvidedBy;
  readonly verification: Verification;
  readonly confidence: Confidence;
  readonly status: ClaimStatus;
  readonly reviewAt: Date | null;
  readonly expiresAt: Date | null;
  readonly notes: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewClaimInput {
  readonly id: ClaimId;
  readonly organizationId: OrganizationId;
  readonly subject: ClaimSubject;
  readonly predicate: ClaimPredicate;
  readonly conceptId: ConceptId;
  readonly qualifiers?: ClaimQualifiers;
  readonly statement: string;
  readonly provenance: Provenance;
  readonly providedBy: ProvidedBy;
  readonly confidence?: Confidence;
  readonly reviewAt?: Date | null;
  readonly expiresAt?: Date | null;
  readonly notes?: string | null;
  readonly now: Date;
}

const validateQualifiers = (predicate: ClaimPredicate, qualifiers: ClaimQualifiers): string[] => {
  const problems: string[] = [];
  const asil = qualifiers['asil'];
  if (asil !== undefined && !(ASIL_LEVELS as readonly string[]).includes(asil)) {
    problems.push(`asil must be one of ${ASIL_LEVELS.join(', ')}`);
  }
  if (predicate === 'CERTIFIED' && !qualifiers['certificationBody']) {
    problems.push('CERTIFIED claims require a certificationBody qualifier');
  }
  for (const [key, value] of Object.entries(qualifiers)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(key)) problems.push(`invalid qualifier key "${key}"`);
    if (value.length > 200) problems.push(`qualifier "${key}" is too long`);
  }
  return problems;
};

export const createClaim = (input: NewClaimInput): TechnicalClaim => {
  const statement = sanitizeUntrustedText(input.statement, 1000);
  const qualifiers = input.qualifiers ?? {};
  const problems = [
    ...validateQualifiers(input.predicate, qualifiers),
    ...validateProvenance(input.provenance),
  ];
  if (statement.length === 0) problems.push('statement is required');
  if (input.subject.type === 'organization' && input.subject.id !== input.organizationId) {
    problems.push('organization claims must be about the owning organization');
  }
  if (input.providedBy.organizationId !== input.organizationId && input.providedBy.via !== 'import') {
    problems.push('claims can only be provided by the owning organization unless imported');
  }
  if (input.provenance.category === 'AI_INFERRED' && input.providedBy.via !== 'ai_extraction') {
    problems.push('AI_INFERRED provenance is reserved for AI extraction');
  }
  if (problems.length > 0) {
    throw validationError('Invalid technical claim', problems.map((message) => ({ message })));
  }
  return {
    id: input.id,
    organizationId: input.organizationId,
    subject: input.subject,
    predicate: input.predicate,
    conceptId: input.conceptId,
    qualifiers,
    statement,
    provenance: input.provenance,
    providedBy: input.providedBy,
    verification: UNREVIEWED,
    confidence: input.confidence ?? (input.provenance.category === 'AI_INFERRED' ? 'low' : 'medium'),
    status: 'draft',
    reviewAt: input.reviewAt ?? null,
    expiresAt: input.expiresAt ?? null,
    notes: input.notes ?? null,
    version: 1,
    createdAt: input.now,
    updatedAt: input.now,
  };
};

/**
 * Publishing requires an explicit human decision by the supplier.
 * AI-extracted drafts become supplier-attested (SUPPLIER_VERIFIED) only
 * through this call — never automatically — and never become
 * platform_verified here.
 */
export const publishClaim = (claim: TechnicalClaim, reviewer: UserId, now: Date): TechnicalClaim => {
  if (claim.status === 'retracted') throw invariant('A retracted claim cannot be published');
  const provenance: Provenance =
    claim.provenance.category === 'AI_INFERRED' || claim.provenance.category === 'UNVERIFIED'
      ? { ...claim.provenance, category: 'SUPPLIER_VERIFIED' }
      : claim.provenance;
  return {
    ...claim,
    provenance,
    providedBy: { ...claim.providedBy, userId: claim.providedBy.userId ?? reviewer },
    confidence: claim.confidence === 'low' ? 'medium' : claim.confidence,
    status: 'published',
    version: claim.version + 1,
    updatedAt: now,
  };
};

export const retractClaim = (claim: TechnicalClaim, now: Date): TechnicalClaim => ({
  ...claim,
  status: 'retracted',
  version: claim.version + 1,
  updatedAt: now,
});

/**
 * Platform verification requires linked evidence and a human verifier.
 * Editing a verified claim's substance resets verification (see reviseClaim).
 */
export const verifyClaim = (
  claim: TechnicalClaim,
  verifier: UserId,
  outcome: 'platform_verified' | 'disputed' | 'rejected',
  notes: string | null,
  now: Date,
): TechnicalClaim => {
  if (claim.status !== 'published') throw invariant('Only published claims can be reviewed');
  if (outcome === 'platform_verified' && claim.provenance.evidenceIds.length === 0) {
    throw invariant('Platform verification requires at least one linked evidence item');
  }
  return {
    ...claim,
    verification: { status: outcome, verifiedBy: verifier, verifiedAt: now, notes },
    confidence: outcome === 'platform_verified' ? 'high' : 'low',
    version: claim.version + 1,
    updatedAt: now,
  };
};

export interface ClaimRevision {
  readonly predicate?: ClaimPredicate;
  readonly conceptId?: ConceptId;
  readonly qualifiers?: ClaimQualifiers;
  readonly statement?: string;
  readonly provenance?: Provenance;
  readonly reviewAt?: Date | null;
  readonly expiresAt?: Date | null;
  readonly notes?: string | null;
}

export const reviseClaim = (claim: TechnicalClaim, revision: ClaimRevision, now: Date): TechnicalClaim => {
  if (claim.status === 'retracted') throw invariant('A retracted claim cannot be revised');
  const next = createClaim({
    id: claim.id,
    organizationId: claim.organizationId,
    subject: claim.subject,
    predicate: revision.predicate ?? claim.predicate,
    conceptId: revision.conceptId ?? claim.conceptId,
    qualifiers: revision.qualifiers ?? claim.qualifiers,
    statement: revision.statement ?? claim.statement,
    provenance: revision.provenance ?? claim.provenance,
    providedBy: claim.providedBy,
    confidence: claim.confidence,
    reviewAt: revision.reviewAt === undefined ? claim.reviewAt : revision.reviewAt,
    expiresAt: revision.expiresAt === undefined ? claim.expiresAt : revision.expiresAt,
    notes: revision.notes === undefined ? claim.notes : revision.notes,
    now,
  });
  const substantiveChange =
    next.predicate !== claim.predicate ||
    next.conceptId !== claim.conceptId ||
    next.statement !== claim.statement ||
    JSON.stringify(next.qualifiers) !== JSON.stringify(claim.qualifiers) ||
    JSON.stringify(next.provenance) !== JSON.stringify(claim.provenance);
  return {
    ...next,
    // A substantive edit invalidates any previous platform verification.
    verification: substantiveChange ? UNREVIEWED : claim.verification,
    status: claim.status,
    version: claim.version + 1,
    createdAt: claim.createdAt,
  };
};

export const isClaimActive = (claim: TechnicalClaim, now: Date): boolean =>
  claim.status === 'published' &&
  claim.verification.status !== 'rejected' &&
  (claim.expiresAt === null || claim.expiresAt.getTime() > now.getTime());

/** Human phrasing of a predicate that preserves its exact strength. */
export const describePredicate = (predicate: ClaimPredicate): string => {
  switch (predicate) {
    case 'SUPPORTS':
      return 'supports';
    case 'IMPLEMENTS':
      return 'implements';
    case 'INTEGRATES_WITH':
      return 'integrates with';
    case 'PROVIDES_CAPABILITY':
      return 'provides';
    case 'TARGETS_DOMAIN':
      return 'targets';
    case 'DESIGNED_FOR':
      return 'designed for (not a certification)';
    case 'EXPERIENCE_WITH':
      return 'has project experience with';
    case 'PROCESS_COMPLIANT':
      return 'states process compliance with';
    case 'CERTIFIED':
      return 'holds third-party certification for';
    case 'PRODUCTION_DEPLOYMENT':
      return 'has series-production deployment with';
  }
};
