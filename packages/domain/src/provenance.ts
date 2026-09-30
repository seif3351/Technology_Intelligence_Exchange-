import type { EvidenceId, OrganizationId, UserId } from './ids';

/**
 * Where an assertion comes from. This is independent of whether the platform
 * has verified it (see VerificationStatus).
 */
export const PROVENANCE_CATEGORIES = [
  'SUPPLIER_VERIFIED',
  'PUBLIC_SOURCE',
  'LICENSED_THIRD_PARTY',
  'INTERNAL',
  'AI_INFERRED',
  'UNVERIFIED',
] as const;
export type ProvenanceCategory = (typeof PROVENANCE_CATEGORIES)[number];

export const SOURCE_TYPES = [
  'supplier_statement',
  'document',
  'video',
  'public_url',
  'certificate',
  'case_study',
  'third_party_dataset',
  'platform_review',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** Platform-level review outcome for a claim. */
export const VERIFICATION_STATUSES = ['unreviewed', 'platform_verified', 'disputed', 'rejected'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** Qualitative confidence. Deliberately not a number: it must not pose as objective truth. */
export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export interface Provenance {
  readonly category: ProvenanceCategory;
  readonly sourceType: SourceType;
  readonly sourceReference: string | null;
  readonly sourceUrl: string | null;
  readonly sourceVersion: string | null;
  /** License under which third-party data may be displayed; required for LICENSED_THIRD_PARTY. */
  readonly license: string | null;
  readonly evidenceIds: readonly EvidenceId[];
}

export interface ProvidedBy {
  readonly organizationId: OrganizationId;
  readonly userId: UserId | null;
  readonly via: 'manual' | 'ai_extraction' | 'import' | 'seed';
}

export interface Verification {
  readonly status: VerificationStatus;
  readonly verifiedBy: UserId | null;
  readonly verifiedAt: Date | null;
  readonly notes: string | null;
}

export const UNREVIEWED: Verification = {
  status: 'unreviewed',
  verifiedBy: null,
  verifiedAt: null,
  notes: null,
};

/**
 * Trust tiers used for ranking and for the evidence strength shown to users.
 * Ordered strongest first. The tier is derived — never stored — so that the
 * rule is applied consistently everywhere.
 */
export const TRUST_TIERS = [
  'platform_verified',
  'supplier_verified_with_evidence',
  'supplier_verified',
  'public_source',
  'unverified',
  'ai_inferred',
] as const;
export type TrustTier = (typeof TRUST_TIERS)[number];

export const trustTier = (provenance: Provenance, verification: Verification): TrustTier => {
  if (verification.status === 'platform_verified') return 'platform_verified';
  switch (provenance.category) {
    case 'SUPPLIER_VERIFIED':
      return provenance.evidenceIds.length > 0 ? 'supplier_verified_with_evidence' : 'supplier_verified';
    case 'PUBLIC_SOURCE':
    case 'LICENSED_THIRD_PARTY':
    case 'INTERNAL':
      return 'public_source';
    case 'AI_INFERRED':
      return 'ai_inferred';
    case 'UNVERIFIED':
      return 'unverified';
  }
};

/** Numeric weight of a trust tier, used only inside the transparent scoring model. */
export const TRUST_TIER_WEIGHT: Readonly<Record<TrustTier, number>> = {
  platform_verified: 1,
  supplier_verified_with_evidence: 0.85,
  supplier_verified: 0.7,
  public_source: 0.6,
  unverified: 0.3,
  ai_inferred: 0.2,
};

/** Human-readable phrasing that never upgrades uncertainty into certainty. */
export const describeTrustTier = (tier: TrustTier): string => {
  switch (tier) {
    case 'platform_verified':
      return 'verified by platform review of evidence';
    case 'supplier_verified_with_evidence':
      return 'stated by supplier, with linked evidence (not independently verified)';
    case 'supplier_verified':
      return 'stated by supplier (not independently verified)';
    case 'public_source':
      return 'from public/third-party documentation (not supplier-confirmed)';
    case 'unverified':
      return 'unverified';
    case 'ai_inferred':
      return 'AI-inferred — not confirmed by supplier or platform';
  }
};

export const validateProvenance = (provenance: Provenance): string[] => {
  const problems: string[] = [];
  if (provenance.category === 'LICENSED_THIRD_PARTY' && !provenance.license) {
    problems.push('LICENSED_THIRD_PARTY provenance requires a license');
  }
  if (provenance.category === 'PUBLIC_SOURCE' && !provenance.sourceUrl && !provenance.sourceReference) {
    problems.push('PUBLIC_SOURCE provenance requires a source URL or reference');
  }
  return problems;
};
