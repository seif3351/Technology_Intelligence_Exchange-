import { createHash } from 'node:crypto';
import {
  type Asset,
  type AssetId,
  type TechnicalClaim,
  createClaim,
  detectInjectionSignals,
  newId,
  sanitizeUntrustedText,
  transitionAsset,
} from '@atx/domain';
import type { ApplicationDeps } from '../deps';
import type { RequestContext, TenantScope } from '../principal';
import { recordAudit } from './support';

const MAX_EXTRACTED_CHARS = 200_000;
const MAX_DRAFT_CLAIMS = 40;

/**
 * Asynchronous asset pipeline (runs in the worker with a system principal):
 *   uploaded -> scanning -> quarantined | processing -> text extraction ->
 *   AI/deterministic claim drafting -> ready
 * Extracted text is stored next to the asset and is UNTRUSTED DATA: it is only
 * ever passed to extractors as delimited content, never as instructions.
 * Drafted claims are status=draft, provenance=AI_INFERRED and require human review.
 */
export class IngestionService {
  constructor(private readonly deps: ApplicationDeps) {}

  async processAsset(ctx: RequestContext, assetId: AssetId): Promise<Asset> {
    let asset = await this.deps.repos.assets.findById(assetId);
    if (!asset) throw new Error(`Asset ${assetId} not found`);
    if (asset.processingState === 'ready' || asset.processingState === 'quarantined') return asset;
    if (!asset.storageKey) return asset;
    const scope = { organizationId: asset.organizationId, role: 'system' } as TenantScope;

    if (asset.processingState === 'scanning' || asset.processingState === 'processing') {
      // A previous attempt was interrupted mid-pipeline; restart from the scan.
      asset = transitionAsset(asset, 'failed', this.deps.clock.now(), 'retrying after interruption');
    }
    asset = await this.save(transitionAsset(asset, 'scanning', this.deps.clock.now()));
    const bytes = await this.deps.storage.get(asset.storageKey!);
    const scan = await this.deps.scanner.scan(bytes, asset.contentType);
    if (!scan.clean) {
      asset = await this.save({
        ...transitionAsset(asset, 'quarantined', this.deps.clock.now(), scan.reason),
        extractionState: 'not_started',
      });
      await recordAudit(this.deps.repos.audit, ctx, this.deps.clock.now(), {
        action: 'asset.quarantined',
        resourceType: 'asset',
        resourceId: asset.id,
        organizationId: asset.organizationId,
        outcome: 'denied',
        metadata: { reason: scan.reason },
      });
      return asset;
    }
    asset = await this.save({
      ...transitionAsset(asset, 'processing', this.deps.clock.now()),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });

    const extraction = await this.deps.textExtractor.extract(bytes, asset.contentType);
    if (extraction.kind === 'unsupported') {
      return this.save({
        ...transitionAsset(asset, 'ready', this.deps.clock.now()),
        extractionState: 'not_supported',
      });
    }
    const text = sanitizeUntrustedText(extraction.text, MAX_EXTRACTED_CHARS);
    await this.deps.storage.put(
      `${asset.storageKey}.extracted.txt`,
      new TextEncoder().encode(text),
      'text/plain',
    );

    const drafted = await this.draftClaims(asset, text, scope);
    await recordAudit(this.deps.repos.audit, ctx, this.deps.clock.now(), {
      action: 'asset.processed',
      resourceType: 'asset',
      resourceId: asset.id,
      organizationId: asset.organizationId,
      metadata: {
        draftedClaims: drafted.count,
        method: drafted.method,
        injectionSignals: detectInjectionSignals(text).length,
      },
    });
    return this.save({
      ...transitionAsset(asset, 'ready', this.deps.clock.now()),
      extractionState: 'completed',
    });
  }

  async markFailed(assetId: AssetId, reason: string): Promise<void> {
    const asset = await this.deps.repos.assets.findById(assetId);
    if (
      !asset ||
      asset.processingState === 'ready' ||
      asset.processingState === 'quarantined' ||
      asset.processingState === 'failed'
    )
      return;
    await this.save({
      ...transitionAsset(asset, 'failed', this.deps.clock.now(), reason.slice(0, 300)),
      extractionState: 'failed',
    });
  }

  private async draftClaims(asset: Asset, text: string, scope: TenantScope) {
    const ontology = await this.deps.ontology.current();
    const draft = await this.deps.profileDraftGenerator.generate({ sourceText: text, ontology });
    const evidence = await this.deps.repos.evidence.findByAsset(asset.id);
    const now = this.deps.clock.now();
    const claims: TechnicalClaim[] = [];
    for (const proposal of draft.claims.slice(0, MAX_DRAFT_CLAIMS)) {
      if (!ontology.hasConcept(proposal.conceptId)) continue;
      try {
        claims.push(
          createClaim({
            id: newId(),
            organizationId: asset.organizationId,
            subject: asset.offeringId
              ? { type: 'offering', id: asset.offeringId }
              : { type: 'organization', id: asset.organizationId },
            predicate: proposal.predicate,
            conceptId: proposal.conceptId,
            qualifiers: proposal.qualifiers,
            statement: proposal.quote,
            provenance: {
              category: 'AI_INFERRED',
              sourceType: asset.kind === 'video' ? 'video' : 'document',
              sourceReference: asset.title,
              sourceUrl: null,
              sourceVersion: null,
              license: null,
              evidenceIds: evidence ? [evidence.id] : [],
            },
            providedBy: { organizationId: asset.organizationId, userId: null, via: 'ai_extraction' },
            confidence: 'low',
            notes: `Drafted by ${draft.method} extraction; requires supplier review before publication.`,
            now,
          }),
        );
      } catch {
        // A proposal that violates domain rules is dropped, never "fixed up".
      }
    }
    await this.deps.transaction(async (repos) => {
      for (const claim of claims) await repos.claims.insert(scope, claim);
    });
    return { count: claims.length, method: draft.method };
  }

  private async save(asset: Asset): Promise<Asset> {
    await this.deps.repos.assets.save(asset);
    return asset;
  }
}
