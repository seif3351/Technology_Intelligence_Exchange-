import {
  AppError,
  type Offering,
  type TechnicalClaim,
  asId,
  invariant,
  isPubliclyListed,
  notFound,
  publishClaim,
  transitionOffering,
  validationError,
} from '@atx/domain';
import type { ApplicationDeps } from '../deps';
import { requireUser } from '../policies';
import type { RequestContext } from '../principal';
import { presentClaim } from '../views';
import { ownedClaim, ownedOffering, supplierWriteScope } from './supplier-access';
import { digest, recordAudit } from './support';

const PUBLICATION_TTL_SECONDS = 15 * 60;
const MAX_PUBLICATION_CLAIMS = 50;

/** What a human approves: exact claim/offering versions, so later edits invalidate the approval. */
export interface PublicationRequest {
  readonly claims: readonly { readonly id: string; readonly version: number }[];
  readonly offering: { readonly id: string; readonly version: number } | null;
}

/**
 * Agent-assisted publication of supplier drafts (prepare -> explicit human
 * approval -> confirm with a token bound to the user and the exact versions).
 */
export class PublicationService {
  constructor(private readonly deps: ApplicationDeps) {}

  /**
   * Step 1 of agent-assisted publication: returns exactly what would become
   * public (claim wording and strength, provenance, AI-drafted flags) and a
   * short-lived confirmation token bound to the user and these exact
   * versions. Nothing is published.
   */
  async prepare(
    ctx: RequestContext,
    organizationId: string,
    input: { readonly claimIds: readonly string[]; readonly offeringId: string | null },
  ) {
    const scope = supplierWriteScope(ctx, organizationId);
    const user = requireUser(ctx.principal);
    const ids = [...new Set(input.claimIds)];
    if (ids.length === 0 && !input.offeringId) throw validationError('Nothing to publish');
    if (ids.length > MAX_PUBLICATION_CLAIMS)
      throw validationError(`At most ${MAX_PUBLICATION_CLAIMS} claims per publication`);
    const ontology = await this.deps.ontology.current();
    const claims = await Promise.all(ids.map((id) => ownedClaim(this.deps.repos.claims, scope, id)));
    const notPublishable = claims.filter((claim) => claim.status !== 'draft');
    if (notPublishable.length > 0)
      throw invariant(
        `Only draft claims can be published (${notPublishable.map((c) => `${c.id} is ${c.status}`).join(', ')})`,
      );
    const offering = input.offeringId
      ? await ownedOffering(this.deps.repos.offerings.findById(asId(input.offeringId)), scope)
      : null;
    if (offering) {
      if (offering.status === 'published') throw invariant('The offering is already published');
      const alreadyPublished = await this.deps.repos.claims.listForTenant(scope, {
        offeringId: offering.id,
        status: 'published',
      });
      const includedForOffering = claims.filter(
        (claim) => claim.subject.type === 'offering' && claim.subject.id === offering.id,
      );
      if (alreadyPublished.length === 0 && includedForOffering.length === 0)
        throw invariant('Include at least one claim about the offering before publishing it');
    }
    const request: PublicationRequest = {
      claims: claims.map((claim) => ({ id: claim.id, version: claim.version })),
      offering: offering ? { id: offering.id, version: offering.version } : null,
    };
    const { token, expiresAt } = await this.deps.confirmations.issue(
      {
        userId: user.userId,
        organizationId: scope.organizationId,
        action: 'supplier.publish',
        digest: digest(request),
      },
      PUBLICATION_TTL_SECONDS,
    );
    return {
      request,
      claims: claims.map((claim) => presentClaim(claim, ontology)),
      offering,
      confirmationToken: token,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Step 2: publishes exactly the previewed versions after explicit human
   * approval. Publication is the supplier's review step: AI-drafted claims
   * become supplier statements, never platform-verified ones.
   */
  async confirm(
    ctx: RequestContext,
    organizationId: string,
    request: PublicationRequest,
    confirmationToken: string,
  ) {
    const scope = supplierWriteScope(ctx, organizationId);
    const user = requireUser(ctx.principal);
    const confirmation = await this.deps.confirmations.verify(confirmationToken);
    const normalized: PublicationRequest = {
      claims: request.claims.map((claim) => ({ id: claim.id, version: claim.version })),
      offering: request.offering ? { id: request.offering.id, version: request.offering.version } : null,
    };
    if (
      confirmation.action !== 'supplier.publish' ||
      confirmation.userId !== user.userId ||
      confirmation.organizationId !== scope.organizationId ||
      confirmation.digest !== digest(normalized)
    ) {
      throw new AppError(
        'CONFIRMATION_REQUIRED',
        'Confirmation token does not match this publication; prepare it again',
      );
    }
    const ontology = await this.deps.ontology.current();
    const now = this.deps.clock.now();
    const result = await this.deps.transaction(async (repos) => {
      const published: TechnicalClaim[] = [];
      let alreadyPublished = 0;
      for (const expected of normalized.claims) {
        const current = await repos.claims.findById(asId(expected.id));
        if (!current || current.organizationId !== scope.organizationId) throw notFound('Claim');
        // A replay after success finds the claim published one version later: report, do not fail.
        if (current.status === 'published' && current.version === expected.version + 1) {
          alreadyPublished += 1;
          continue;
        }
        const next = publishClaim(current, user.userId, now);
        await repos.claims.update(scope, next, expected.version);
        await recordAudit(repos.audit, ctx, now, {
          action: 'claim.publish',
          resourceType: 'claim',
          resourceId: next.id,
          organizationId: scope.organizationId,
          metadata: { via: current.providedBy.via, provenance: next.provenance.category, confirmed: true },
        });
        published.push(next);
      }
      let offering: Offering | null = null;
      if (normalized.offering) {
        const current = await ownedOffering(repos.offerings.findById(asId(normalized.offering.id)), scope);
        if (current.status === 'published' && current.version === normalized.offering.version + 1) {
          offering = current;
        } else {
          const claims = await repos.claims.listForTenant(scope, {
            offeringId: current.id,
            status: 'published',
          });
          if (claims.length === 0)
            throw invariant('Publish at least one technical claim before publishing the offering');
          offering = transitionOffering(current, 'published', user.userId, now);
          await repos.offerings.update(scope, offering, normalized.offering.version);
          await recordAudit(repos.audit, ctx, now, {
            action: 'offering.published',
            resourceType: 'offering',
            resourceId: offering.id,
            organizationId: scope.organizationId,
            metadata: { confirmed: true },
          });
        }
      }
      return { published, alreadyPublished, offering };
    });
    const offeringIds = new Set<string>(
      result.published.flatMap((claim) => (claim.subject.type === 'offering' ? [claim.subject.id] : [])),
    );
    if (result.offering) offeringIds.add(result.offering.id);
    for (const offeringId of offeringIds)
      await this.deps.jobs.enqueue(
        'offering.reindex',
        { offeringId: asId<'OfferingId'>(offeringId) },
        { dedupeKey: `reindex:${offeringId}` },
      );
    const organization = await this.deps.repos.organizations.findById(scope.organizationId);
    return {
      claims: result.published.map((claim) => presentClaim(claim, ontology)),
      alreadyPublished: result.alreadyPublished,
      offering: result.offering,
      /** False until the platform verifies the organization (ADR 0011): published content is not yet public. */
      listed: organization ? isPubliclyListed(organization) : false,
    };
  }
}
