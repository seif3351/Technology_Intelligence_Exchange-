import type {
  Asset,
  AuditEvent,
  Capability,
  ClaimSubject,
  EngagementRequest,
  Evidence,
  Offering,
  Organization,
  Requirement,
  TechnicalClaim,
  User,
} from '@atx/domain';
import { asId } from '@atx/domain';

/**
 * Row <-> domain mapping. Database rows never leave this package; the rest
 * of the system only sees domain types.
 */
type Row = Record<string, unknown>;

const str = (row: Row, key: string): string => row[key] as string;
const strOrNull = (row: Row, key: string): string | null => (row[key] as string | null) ?? null;
const date = (row: Row, key: string): Date => row[key] as Date;
const dateOrNull = (row: Row, key: string): Date | null => (row[key] as Date | null) ?? null;
const num = (row: Row, key: string): number => Number(row[key]);
const numOrNull = (row: Row, key: string): number | null =>
  row[key] === null || row[key] === undefined ? null : Number(row[key]);

export const toUser = (row: Row): User => ({
  id: asId(str(row, 'id')),
  email: str(row, 'email'),
  displayName: str(row, 'display_name'),
  platformRole: row['platform_role'] as User['platformRole'],
  createdAt: date(row, 'created_at'),
});

export const toOrganization = (row: Row): Organization => ({
  id: asId(str(row, 'id')),
  slug: str(row, 'slug'),
  name: str(row, 'name'),
  kind: row['kind'] as Organization['kind'],
  summary: str(row, 'summary'),
  description: str(row, 'description'),
  website: strOrNull(row, 'website'),
  headquartersCountry: strOrNull(row, 'headquarters_country'),
  regions: row['regions'] as string[],
  employeeRange: strOrNull(row, 'employee_range'),
  contact: { name: null, email: null, url: null, ...(row['contact'] as object) },
  verificationState: row['verification_state'] as Organization['verificationState'],
  verifiedBy: row['verified_by'] ? asId(str(row, 'verified_by')) : null,
  verifiedAt: dateOrNull(row, 'verified_at'),
  isDemo: Boolean(row['is_demo']),
  version: num(row, 'version'),
  createdAt: date(row, 'created_at'),
  updatedAt: date(row, 'updated_at'),
});

export const toOffering = (row: Row): Offering => ({
  id: asId(str(row, 'id')),
  organizationId: asId(str(row, 'organization_id')),
  slug: str(row, 'slug'),
  type: row['type'] as Offering['type'],
  name: str(row, 'name'),
  summary: str(row, 'summary'),
  description: str(row, 'description'),
  maturity: row['maturity'] as Offering['maturity'],
  details: row['details'] as Offering['details'],
  commercial: row['commercial'] as Offering['commercial'],
  regions: row['regions'] as string[],
  status: row['status'] as Offering['status'],
  isDemo: Boolean(row['is_demo']),
  publishedAt: dateOrNull(row, 'published_at'),
  publishedBy: row['published_by'] ? asId(str(row, 'published_by')) : null,
  version: num(row, 'version'),
  createdAt: date(row, 'created_at'),
  updatedAt: date(row, 'updated_at'),
});

export const toCapability = (row: Row): Capability => ({
  id: asId(str(row, 'id')),
  organizationId: asId(str(row, 'organization_id')),
  conceptId: asId(str(row, 'concept_id')),
  name: str(row, 'name'),
  description: str(row, 'description'),
  status: row['status'] as Capability['status'],
  version: num(row, 'version'),
  createdAt: date(row, 'created_at'),
  updatedAt: date(row, 'updated_at'),
});

export const toClaim = (row: Row): TechnicalClaim => ({
  id: asId(str(row, 'id')),
  organizationId: asId(str(row, 'organization_id')),
  subject: { type: row['subject_type'], id: str(row, 'subject_id') } as ClaimSubject,
  predicate: row['predicate'] as TechnicalClaim['predicate'],
  conceptId: asId(str(row, 'concept_id')),
  qualifiers: row['qualifiers'] as Record<string, string>,
  statement: str(row, 'statement'),
  provenance: {
    category: row['provenance_category'] as TechnicalClaim['provenance']['category'],
    sourceType: row['source_type'] as TechnicalClaim['provenance']['sourceType'],
    sourceReference: strOrNull(row, 'source_reference'),
    sourceUrl: strOrNull(row, 'source_url'),
    sourceVersion: strOrNull(row, 'source_version'),
    license: strOrNull(row, 'license'),
    evidenceIds: (row['evidence_ids'] as string[]).map((id) => asId(id)),
  },
  providedBy: {
    organizationId: asId(str(row, 'provided_by_org')),
    userId: row['provided_by_user'] ? asId(str(row, 'provided_by_user')) : null,
    via: row['provided_via'] as TechnicalClaim['providedBy']['via'],
  },
  verification: {
    status: row['verification_status'] as TechnicalClaim['verification']['status'],
    verifiedBy: row['verified_by'] ? asId(str(row, 'verified_by')) : null,
    verifiedAt: dateOrNull(row, 'verified_at'),
    notes: strOrNull(row, 'verification_notes'),
  },
  confidence: row['confidence'] as TechnicalClaim['confidence'],
  status: row['status'] as TechnicalClaim['status'],
  reviewAt: dateOrNull(row, 'review_at'),
  expiresAt: dateOrNull(row, 'expires_at'),
  notes: strOrNull(row, 'notes'),
  version: num(row, 'version'),
  createdAt: date(row, 'created_at'),
  updatedAt: date(row, 'updated_at'),
});

/** Column order used by claim INSERT/UPDATE statements. */
export const claimParams = (claim: TechnicalClaim): unknown[] => [
  claim.id,
  claim.organizationId,
  claim.subject.type,
  claim.subject.id,
  claim.predicate,
  claim.conceptId,
  JSON.stringify(claim.qualifiers),
  claim.statement,
  claim.provenance.category,
  claim.provenance.sourceType,
  claim.provenance.sourceReference,
  claim.provenance.sourceUrl,
  claim.provenance.sourceVersion,
  claim.provenance.license,
  claim.provenance.evidenceIds,
  claim.providedBy.organizationId,
  claim.providedBy.userId,
  claim.providedBy.via,
  claim.verification.status,
  claim.verification.verifiedBy,
  claim.verification.verifiedAt,
  claim.verification.notes,
  claim.confidence,
  claim.status,
  claim.reviewAt,
  claim.expiresAt,
  claim.notes,
  claim.version,
  claim.createdAt,
  claim.updatedAt,
];

export const toEvidence = (row: Row): Evidence => ({
  id: asId(str(row, 'id')),
  organizationId: asId(str(row, 'organization_id')),
  offeringId: row['offering_id'] ? asId(str(row, 'offering_id')) : null,
  kind: row['kind'] as Evidence['kind'],
  title: str(row, 'title'),
  description: str(row, 'description'),
  assetId: row['asset_id'] ? asId(str(row, 'asset_id')) : null,
  url: strOrNull(row, 'url'),
  provenance: {
    category: row['provenance_category'] as Evidence['provenance']['category'],
    sourceType: row['source_type'] as Evidence['provenance']['sourceType'],
    sourceReference: strOrNull(row, 'source_reference'),
    sourceUrl: strOrNull(row, 'source_url'),
    sourceVersion: strOrNull(row, 'source_version'),
    license: strOrNull(row, 'license'),
    evidenceIds: [],
  },
  visibility: row['visibility'] as Evidence['visibility'],
  customerDisclosure: (row['customer_disclosure'] as Evidence['customerDisclosure']) ?? null,
  createdBy: row['created_by'] ? asId(str(row, 'created_by')) : null,
  createdAt: date(row, 'created_at'),
  updatedAt: date(row, 'updated_at'),
});

export const toAsset = (row: Row): Asset => ({
  id: asId(str(row, 'id')),
  organizationId: asId(str(row, 'organization_id')),
  offeringId: row['offering_id'] ? asId(str(row, 'offering_id')) : null,
  kind: row['kind'] as Asset['kind'],
  title: str(row, 'title'),
  description: str(row, 'description'),
  contentType: str(row, 'content_type'),
  byteSize: numOrNull(row, 'byte_size'),
  storageKey: strOrNull(row, 'storage_key'),
  externalUrl: strOrNull(row, 'external_url'),
  sha256: strOrNull(row, 'sha256'),
  durationSeconds: numOrNull(row, 'duration_seconds'),
  thumbnailUrl: strOrNull(row, 'thumbnail_url'),
  visibility: row['visibility'] as Asset['visibility'],
  processingState: row['processing_state'] as Asset['processingState'],
  extractionState: row['extraction_state'] as Asset['extractionState'],
  failureReason: strOrNull(row, 'failure_reason'),
  createdBy: row['created_by'] ? asId(str(row, 'created_by')) : null,
  isDemo: Boolean(row['is_demo']),
  createdAt: date(row, 'created_at'),
  updatedAt: date(row, 'updated_at'),
});

export const toRequirement = (row: Row): Requirement => ({
  id: asId(str(row, 'id')),
  organizationId: asId(str(row, 'organization_id')),
  title: str(row, 'title'),
  description: str(row, 'description'),
  constraints: row['constraints'] as Requirement['constraints'],
  confidentialTerms: row['confidential_terms'] as string[],
  visibility: row['visibility'] as Requirement['visibility'],
  status: row['status'] as Requirement['status'],
  createdBy: asId(str(row, 'created_by')),
  version: num(row, 'version'),
  createdAt: date(row, 'created_at'),
  updatedAt: date(row, 'updated_at'),
});

export const toEngagement = (row: Row): EngagementRequest => ({
  id: asId(str(row, 'id')),
  type: row['type'] as EngagementRequest['type'],
  buyerOrganizationId: asId(str(row, 'buyer_organization_id')),
  supplierOrganizationId: asId(str(row, 'supplier_organization_id')),
  offeringId: row['offering_id'] ? asId(str(row, 'offering_id')) : null,
  requirementId: row['requirement_id'] ? asId(str(row, 'requirement_id')) : null,
  disclosure: row['disclosure'] as EngagementRequest['disclosure'],
  status: row['status'] as EngagementRequest['status'],
  idempotencyKey: str(row, 'idempotency_key'),
  requestedBy: asId(str(row, 'requested_by')),
  confirmedAt: date(row, 'confirmed_at'),
  createdAt: date(row, 'created_at'),
  updatedAt: date(row, 'updated_at'),
});

export const toAuditEvent = (row: Row): AuditEvent => ({
  id: asId(str(row, 'id')),
  occurredAt: date(row, 'occurred_at'),
  actor: row['actor'] as AuditEvent['actor'],
  organizationId: row['organization_id'] ? asId(str(row, 'organization_id')) : null,
  action: str(row, 'action'),
  resourceType: str(row, 'resource_type'),
  resourceId: strOrNull(row, 'resource_id'),
  outcome: row['outcome'] as AuditEvent['outcome'],
  requestId: strOrNull(row, 'request_id'),
  metadata: row['metadata'] as AuditEvent['metadata'],
});
