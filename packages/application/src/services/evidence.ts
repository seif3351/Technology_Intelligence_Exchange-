import {
  ASSET_UPLOAD_POLICY,
  type Asset,
  type AssetKind,
  type Evidence,
  type EvidenceKind,
  asId,
  newId,
  sanitizeUntrustedText,
  validationError,
} from '@atx/domain';
import type { ApplicationDeps } from '../deps';
import { requireUser } from '../policies';
import type { RequestContext } from '../principal';
import { presentEvidence } from '../views';
import { ownedOffering, safeExternalUrl, supplierWriteScope } from './supplier-access';
import { recordAudit } from './support';

export interface EvidenceInput {
  readonly offeringId?: string | null;
  readonly kind: Exclude<EvidenceKind, 'video'>;
  readonly title: string;
  readonly description: string;
  readonly url?: string | null;
  readonly sourceReference?: string | null;
  readonly sourceVersion?: string | null;
  readonly customerDisclosure?: 'named' | 'anonymized' | null;
}

export interface ExternalVideoInput {
  readonly offeringId: string;
  readonly title: string;
  readonly description: string;
  readonly url: string;
  readonly durationSeconds?: number | null;
  readonly thumbnailUrl?: string | null;
}

export interface UploadInput {
  readonly offeringId?: string | null;
  readonly kind: AssetKind;
  readonly title: string;
  readonly description: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

/**
 * Supplier evidence: documents, certificates, case studies, production
 * references, uploaded files and externally hosted demo videos. Split from
 * SupplierService (R5 K6). Every method authorizes the tenant first; nothing
 * about uploaded content is trusted, and nothing is fetched server-side.
 */
export class EvidenceService {
  constructor(private readonly deps: ApplicationDeps) {}

  async addEvidence(ctx: RequestContext, organizationId: string, input: EvidenceInput) {
    const scope = supplierWriteScope(ctx, organizationId);
    const user = requireUser(ctx.principal);
    const now = this.deps.clock.now();
    const offeringId = input.offeringId
      ? (await ownedOffering(this.deps.repos.offerings.findById(asId(input.offeringId)), scope)).id
      : null;
    const url = input.url ? safeExternalUrl(input.url, 'url') : null;
    if (input.kind === 'public_url' && !url) throw validationError('public_url evidence requires a url');
    const evidence: Evidence = {
      id: newId(),
      organizationId: scope.organizationId,
      offeringId,
      kind: input.kind,
      title: sanitizeUntrustedText(input.title, 200),
      description: sanitizeUntrustedText(input.description, 2000),
      assetId: null,
      url,
      provenance: {
        category: 'SUPPLIER_VERIFIED',
        sourceType:
          input.kind === 'public_url'
            ? 'public_url'
            : input.kind === 'case_study'
              ? 'case_study'
              : input.kind === 'certificate'
                ? 'certificate'
                : 'document',
        sourceReference: input.sourceReference ?? null,
        sourceUrl: url,
        sourceVersion: input.sourceVersion ?? null,
        license: null,
        evidenceIds: [],
      },
      visibility: 'public',
      customerDisclosure:
        input.kind === 'production_reference' ? (input.customerDisclosure ?? 'anonymized') : null,
      createdBy: user.userId,
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.transaction(async (repos) => {
      await repos.evidence.insert(scope, evidence);
      await recordAudit(repos.audit, ctx, now, {
        action: 'evidence.create',
        resourceType: 'evidence',
        resourceId: evidence.id,
        organizationId: scope.organizationId,
      });
    });
    return presentEvidence(evidence);
  }

  /** Registers an externally hosted demo video (e.g. on the supplier's CDN). Nothing is fetched server-side. */
  async registerExternalVideo(
    ctx: RequestContext,
    organizationId: string,
    input: ExternalVideoInput,
  ): Promise<Asset> {
    const scope = supplierWriteScope(ctx, organizationId);
    const user = requireUser(ctx.principal);
    const now = this.deps.clock.now();
    const offering = await ownedOffering(this.deps.repos.offerings.findById(asId(input.offeringId)), scope);
    const asset: Asset = {
      id: newId(),
      organizationId: scope.organizationId,
      offeringId: offering.id,
      kind: 'video',
      title: sanitizeUntrustedText(input.title, 200),
      description: sanitizeUntrustedText(input.description, 2000),
      contentType: 'video/external',
      byteSize: null,
      storageKey: null,
      externalUrl: safeExternalUrl(input.url, 'url'),
      sha256: null,
      durationSeconds: input.durationSeconds ?? null,
      thumbnailUrl: input.thumbnailUrl ? safeExternalUrl(input.thumbnailUrl, 'thumbnailUrl') : null,
      visibility: 'public',
      processingState: 'ready',
      extractionState: 'not_supported',
      failureReason: null,
      createdBy: user.userId,
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.transaction(async (repos) => {
      await repos.assets.insert(scope, asset);
      await repos.evidence.insert(scope, this.assetEvidence(asset, user.userId, now));
      await recordAudit(repos.audit, ctx, now, {
        action: 'asset.register_external',
        resourceType: 'asset',
        resourceId: asset.id,
        organizationId: scope.organizationId,
      });
    });
    return asset;
  }

  /**
   * Accepts an upload, stores the bytes and queues asynchronous processing
   * (scan -> extract -> AI draft). Nothing about the content is trusted yet.
   */
  async uploadAsset(ctx: RequestContext, organizationId: string, input: UploadInput): Promise<Asset> {
    const scope = supplierWriteScope(ctx, organizationId);
    const user = requireUser(ctx.principal);
    const policy = ASSET_UPLOAD_POLICY[input.kind];
    const contentType = input.contentType.split(';')[0]?.trim().toLowerCase() ?? '';
    if (!policy.contentTypes.includes(contentType))
      throw validationError(`Content type ${contentType} is not allowed for ${input.kind}`);
    if (input.bytes.byteLength === 0 || input.bytes.byteLength > policy.maxBytes)
      throw validationError('File is empty or too large');
    const offeringId = input.offeringId
      ? (await ownedOffering(this.deps.repos.offerings.findById(asId(input.offeringId)), scope)).id
      : null;
    const now = this.deps.clock.now();
    const id = newId<'AssetId'>();
    const storageKey = `org/${scope.organizationId}/assets/${id}`;
    await this.deps.storage.put(storageKey, input.bytes, contentType);
    const asset: Asset = {
      id,
      organizationId: scope.organizationId,
      offeringId,
      kind: input.kind,
      title: sanitizeUntrustedText(input.title, 200),
      description: sanitizeUntrustedText(input.description, 2000),
      contentType,
      byteSize: input.bytes.byteLength,
      storageKey,
      externalUrl: null,
      sha256: null,
      durationSeconds: null,
      thumbnailUrl: null,
      visibility: 'public',
      processingState: 'uploaded',
      extractionState: 'pending',
      failureReason: null,
      createdBy: user.userId,
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.transaction(async (repos) => {
      await repos.assets.insert(scope, asset);
      await repos.evidence.insert(scope, this.assetEvidence(asset, user.userId, now));
      await recordAudit(repos.audit, ctx, now, {
        action: 'asset.upload',
        resourceType: 'asset',
        resourceId: asset.id,
        organizationId: scope.organizationId,
        metadata: { kind: asset.kind, contentType, byteSize: asset.byteSize },
      });
    });
    await this.deps.jobs.enqueue('asset.process', { assetId: asset.id }, { dedupeKey: `asset:${asset.id}` });
    return asset;
  }

  // --------------------------------------------------------------- helpers

  private assetEvidence(asset: Asset, userId: Evidence['createdBy'], now: Date): Evidence {
    return {
      id: newId(),
      organizationId: asset.organizationId,
      offeringId: asset.offeringId,
      kind: asset.kind === 'video' ? 'video' : 'document',
      title: asset.title,
      description: asset.description,
      assetId: asset.id,
      url: asset.externalUrl,
      provenance: {
        category: 'SUPPLIER_VERIFIED',
        sourceType: asset.kind === 'video' ? 'video' : 'document',
        sourceReference: asset.title,
        sourceUrl: asset.externalUrl,
        sourceVersion: null,
        license: null,
        evidenceIds: [],
      },
      visibility: asset.visibility,
      customerDisclosure: null,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    };
  }
}
