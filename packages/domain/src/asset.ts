import { invariant } from './errors';
import type { AssetId, OfferingId, OrganizationId, UserId } from './ids';
import type { Visibility } from './evidence';

export const ASSET_KINDS = ['video', 'document', 'image', 'transcript'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/**
 * Asynchronous ingestion pipeline states:
 *   uploaded -> scanning -> (quarantined | processing) -> (ready | failed)
 * External references (e.g. a hosted demo video URL) start at `ready` once
 * their URL has passed validation — nothing is fetched server-side.
 */
export const ASSET_PROCESSING_STATES = [
  'uploaded',
  'scanning',
  'quarantined',
  'processing',
  'ready',
  'failed',
] as const;
export type AssetProcessingState = (typeof ASSET_PROCESSING_STATES)[number];

export const EXTRACTION_STATES = ['not_started', 'pending', 'completed', 'not_supported', 'failed'] as const;
export type ExtractionState = (typeof EXTRACTION_STATES)[number];

export interface Asset {
  readonly id: AssetId;
  readonly organizationId: OrganizationId;
  readonly offeringId: OfferingId | null;
  readonly kind: AssetKind;
  readonly title: string;
  readonly description: string;
  readonly contentType: string;
  readonly byteSize: number | null;
  /** Key in object storage; null for externally hosted assets. */
  readonly storageKey: string | null;
  readonly externalUrl: string | null;
  readonly sha256: string | null;
  readonly durationSeconds: number | null;
  readonly thumbnailUrl: string | null;
  readonly visibility: Visibility;
  readonly processingState: AssetProcessingState;
  readonly extractionState: ExtractionState;
  readonly failureReason: string | null;
  readonly createdBy: UserId | null;
  readonly isDemo: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const TRANSITIONS: Readonly<Record<AssetProcessingState, readonly AssetProcessingState[]>> = {
  uploaded: ['scanning', 'failed'],
  scanning: ['quarantined', 'processing', 'failed'],
  quarantined: [],
  processing: ['ready', 'failed'],
  ready: ['processing'],
  failed: ['scanning'],
};

export const transitionAsset = (
  asset: Asset,
  to: AssetProcessingState,
  now: Date,
  failureReason: string | null = null,
): Asset => {
  if (!TRANSITIONS[asset.processingState].includes(to)) {
    throw invariant(`Cannot move asset from ${asset.processingState} to ${to}`);
  }
  return { ...asset, processingState: to, failureReason, updatedAt: now };
};

/** Upload policy: an explicit allow-list of media types and a size ceiling per kind. */
export const ASSET_UPLOAD_POLICY: Readonly<
  Record<AssetKind, { readonly contentTypes: readonly string[]; readonly maxBytes: number }>
> = {
  document: {
    contentTypes: ['application/pdf', 'text/plain', 'text/markdown', 'text/html'],
    maxBytes: 50 * 1024 * 1024,
  },
  video: { contentTypes: ['video/mp4', 'video/webm'], maxBytes: 2 * 1024 * 1024 * 1024 },
  image: { contentTypes: ['image/png', 'image/jpeg', 'image/webp'], maxBytes: 10 * 1024 * 1024 },
  transcript: { contentTypes: ['text/vtt', 'text/plain'], maxBytes: 5 * 1024 * 1024 },
};
