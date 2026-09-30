import type { AssetId, EvidenceId, OfferingId, OrganizationId, UserId } from './ids';
import type { Provenance } from './provenance';

export const EVIDENCE_KINDS = [
  'document',
  'video',
  'case_study',
  'public_url',
  'certificate',
  'production_reference',
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const VISIBILITIES = ['public', 'private'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/**
 * A piece of supporting material. Binary content (if any) lives in an Asset;
 * Evidence carries the metadata and provenance of the material itself.
 */
export interface Evidence {
  readonly id: EvidenceId;
  readonly organizationId: OrganizationId;
  readonly offeringId: OfferingId | null;
  readonly kind: EvidenceKind;
  readonly title: string;
  readonly description: string;
  readonly assetId: AssetId | null;
  readonly url: string | null;
  readonly provenance: Provenance;
  readonly visibility: Visibility;
  /** For production references: whether the customer may be named. */
  readonly customerDisclosure: 'named' | 'anonymized' | null;
  readonly createdBy: UserId | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
