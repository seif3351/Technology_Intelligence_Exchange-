import {
  type ConceptId,
  type OrganizationVerificationState,
  asId,
  detectInjectionSignals,
  isSlug,
  notFound,
  transitionOrganizationVerification,
  validationError,
  verifyClaim,
} from '@atx/domain';
import type { ApplicationDeps } from '../deps';
import { adminScopeFor, requirePlatformAdmin } from '../policies';
import type { RequestContext } from '../principal';
import { organizationRef, presentClaim } from '../views';
import { recordAudit } from './support';

/**
 * Platform administration: supplier verification, evidence review,
 * moderation, taxonomy management and audit access. Admins moderate PUBLIC
 * catalog content; they get no implicit access to private buyer requirements.
 */
export class AdminService {
  constructor(private readonly deps: ApplicationDeps) {}

  async verificationQueue(ctx: RequestContext) {
    requirePlatformAdmin(ctx.principal);
    const pending = await this.deps.repos.organizations.listByVerificationState('pending', 100);
    return pending.map((org) => ({
      ...organizationRef(org),
      kind: org.kind,
      website: org.website,
      requestedAt: org.updatedAt.toISOString(),
    }));
  }

  async setOrganizationVerification(
    ctx: RequestContext,
    organizationId: string,
    state: Extract<OrganizationVerificationState, 'verified' | 'rejected' | 'suspended'>,
    reason: string | null,
  ) {
    const admin = requirePlatformAdmin(ctx.principal);
    const now = this.deps.clock.now();
    const next = await this.deps.transaction(async (repos) => {
      const current = await repos.organizations.findById(asId(organizationId));
      if (!current) throw notFound('Organization');
      const next = transitionOrganizationVerification(current, state, admin.userId, now);
      await repos.organizations.update(next, current.version);
      await recordAudit(repos.audit, ctx, now, {
        action: `organization.${state}`,
        resourceType: 'organization',
        resourceId: next.id,
        organizationId: next.id,
        metadata: { reasonProvided: reason !== null },
      });
      return next;
    });
    // Listing follows verification (ADR 0011): refresh the search index for all published offerings.
    const offerings = await this.deps.repos.offerings.listForTenant(adminScopeFor(ctx, next.id), [
      'published',
    ]);
    for (const offering of offerings)
      await this.deps.jobs.enqueue(
        'offering.reindex',
        { offeringId: offering.id },
        { dedupeKey: `reindex:${offering.id}` },
      );
    return next;
  }

  async claimReviewQueue(ctx: RequestContext) {
    requirePlatformAdmin(ctx.principal);
    const ontology = await this.deps.ontology.current();
    const claims = await this.deps.repos.claims.listAwaitingPlatformReview(100);
    return claims.map((claim) => presentClaim(claim, ontology));
  }

  async reviewClaim(
    ctx: RequestContext,
    claimId: string,
    outcome: 'platform_verified' | 'disputed' | 'rejected',
    notes: string | null,
  ) {
    const admin = requirePlatformAdmin(ctx.principal);
    const ontology = await this.deps.ontology.current();
    const now = this.deps.clock.now();
    const claim = await this.deps.repos.claims.findById(asId(claimId));
    if (!claim) throw notFound('Claim');
    const scope = adminScopeFor(ctx, claim.organizationId);
    const next = verifyClaim(claim, admin.userId, outcome, notes, now);
    await this.deps.transaction(async (repos) => {
      await repos.claims.update(scope, next, claim.version);
      await recordAudit(repos.audit, ctx, now, {
        action: `claim.review.${outcome}`,
        resourceType: 'claim',
        resourceId: claim.id,
        organizationId: claim.organizationId,
      });
    });
    if (claim.subject.type === 'offering')
      await this.deps.jobs.enqueue(
        'offering.reindex',
        { offeringId: claim.subject.id },
        { dedupeKey: `reindex:${claim.subject.id}` },
      );
    return presentClaim(next, ontology);
  }

  /** Published claims whose text looks like instructions aimed at AI agents. */
  async moderationQueue(ctx: RequestContext) {
    requirePlatformAdmin(ctx.principal);
    const ontology = await this.deps.ontology.current();
    const claims = await this.deps.repos.claims.listAwaitingPlatformReview(500);
    return claims
      .filter((claim) => detectInjectionSignals(claim.statement).length > 0)
      .map((claim) => ({
        ...presentClaim(claim, ontology),
        signals: detectInjectionSignals(claim.statement),
      }));
  }

  async archiveOffering(ctx: RequestContext, offeringId: string, reason: string) {
    const admin = requirePlatformAdmin(ctx.principal);
    const offering = await this.deps.repos.offerings.findById(asId(offeringId));
    if (!offering) throw notFound('Offering');
    const scope = adminScopeFor(ctx, offering.organizationId);
    const now = this.deps.clock.now();
    const next = { ...offering, status: 'archived' as const, version: offering.version + 1, updatedAt: now };
    await this.deps.transaction(async (repos) => {
      await repos.offerings.update(scope, next, offering.version);
      await recordAudit(repos.audit, ctx, now, {
        action: 'offering.moderated',
        resourceType: 'offering',
        resourceId: offering.id,
        organizationId: offering.organizationId,
        metadata: { reason: reason.slice(0, 200), moderator: admin.userId },
      });
    });
    await this.deps.jobs.enqueue(
      'offering.reindex',
      { offeringId: offering.id },
      { dedupeKey: `reindex:${offering.id}` },
    );
    return next;
  }

  async addConcept(
    ctx: RequestContext,
    input: {
      readonly id: string;
      readonly facetId: string;
      readonly label: string;
      readonly description: string;
      readonly aliases: readonly string[];
      readonly broaderConceptIds: readonly string[];
    },
  ) {
    requirePlatformAdmin(ctx.principal);
    const ontology = await this.deps.ontology.current();
    if (!isSlug(input.id)) throw validationError('Concept id must be lowercase kebab-case');
    if (ontology.hasConcept(input.id)) throw validationError('Concept already exists');
    if (!ontology.getFacet(asId(input.facetId))) throw validationError('Unknown facet');
    const broader = input.broaderConceptIds.map((id) => {
      if (!ontology.hasConcept(id)) throw validationError(`Unknown broader concept ${id}`);
      return id as ConceptId;
    });
    await this.deps.ontology.addConcept({ ...input, id: asId(input.id), broaderConceptIds: broader });
    await recordAudit(this.deps.repos.audit, ctx, this.deps.clock.now(), {
      action: 'ontology.concept_added',
      resourceType: 'concept',
      resourceId: input.id,
      organizationId: null,
    });
    return { id: input.id };
  }

  async auditLog(
    ctx: RequestContext,
    query: {
      readonly organizationId?: string | null;
      readonly action?: string | null;
      readonly limit?: number;
      readonly before?: string | null;
    },
  ) {
    requirePlatformAdmin(ctx.principal);
    return this.deps.repos.audit.list({
      organizationId: query.organizationId ? asId(query.organizationId) : null,
      action: query.action ?? null,
      limit: Math.min(200, Math.max(1, query.limit ?? 50)),
      before: query.before ? new Date(query.before) : null,
    });
  }

  async demandSignals(ctx: RequestContext) {
    requirePlatformAdmin(ctx.principal);
    const ontology = await this.deps.ontology.current();
    const signals = await this.deps.repos.requirements.listDemandSignals(50);
    return signals.map((signal) => ({
      concept: ontology.getConcept(signal.conceptId)?.label ?? signal.conceptId,
      conceptId: signal.conceptId,
      requirementCount: signal.requirementCount,
    }));
  }
}
