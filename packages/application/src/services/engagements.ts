import {
  AppError,
  type EngagementDisclosure,
  type EngagementRequest,
  type EngagementStatus,
  type EngagementType,
  asId,
  assertNoConfidentialLeak,
  newId,
  notFound,
  sanitizeUntrustedText,
  toSupplierFacingRequirement,
  transitionEngagement,
  validationError,
} from '@atx/domain';
import type { ApplicationDeps } from '../deps';
import { authorizeTenant, requireScope, requireUser } from '../policies';
import type { RequestContext } from '../principal';
import { presentConstraint } from '../views';
import { digest } from './requirements';
import { recordAudit } from './support';

export interface EngagementDraft {
  readonly buyerOrganizationId: string;
  readonly offeringId: string;
  readonly type: EngagementType;
  readonly message: string;
  readonly contactName: string;
  readonly contactEmail: string;
  /** Optional private requirement whose CONSTRAINTS (never text) are shared. */
  readonly requirementId?: string | null;
  /** Optional buyer-written summary; rejected if it contains confidential terms. */
  readonly disclosedSummary?: string | null;
}

const CONFIRMATION_TTL_SECONDS = 10 * 60;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,20}$/;

/**
 * Demo / workshop / PoC / RFI requests. Two explicit steps:
 *   1. prepare(): builds the exact disclosure, runs leak checks, returns a
 *      preview plus a short-lived confirmation token bound to that preview.
 *   2. confirm(): requires the token and an idempotency key; only then is
 *      anything visible to the supplier.
 * Agents can call prepare(); confirm() must follow an explicit human approval.
 */
export class EngagementService {
  constructor(private readonly deps: ApplicationDeps) {}

  async prepare(ctx: RequestContext, draft: EngagementDraft) {
    this.assertEnabled();
    const { disclosure, supplierName, offeringName } = await this.buildDisclosure(ctx, draft);
    const user = requireUser(ctx.principal);
    const { token, expiresAt } = await this.deps.confirmations.issue(
      {
        userId: user.userId,
        organizationId: asId(draft.buyerOrganizationId),
        action: `engagement.${draft.type}`,
        digest: digest({ draft: normalizeDraft(draft), disclosure }),
      },
      CONFIRMATION_TTL_SECONDS,
    );
    const ontology = await this.deps.ontology.current();
    return {
      preview: {
        type: draft.type,
        recipient: { supplierName, offeringName },
        willBeShared: {
          buyerOrganizationName: disclosure.buyerOrganizationName,
          contactName: disclosure.contactName,
          contactEmail: disclosure.contactEmail,
          message: disclosure.message,
          disclosedSummary: disclosure.requirement?.disclosedSummary ?? null,
          constraints: disclosure.requirement?.constraints.map((c) => presentConstraint(c, ontology)) ?? [],
        },
        willNotBeShared: ['requirement title', 'requirement description', 'confidential terms', 'other requirements', 'search history'],
      },
      confirmationToken: token,
      expiresAt: expiresAt.toISOString(),
      requiresHumanConfirmation: true as const,
    };
  }

  async confirm(ctx: RequestContext, draft: EngagementDraft, confirmationToken: string, idempotencyKey: string) {
    this.assertEnabled();
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(idempotencyKey)) throw validationError('idempotencyKey must be 8-100 URL-safe characters');
    const user = requireUser(ctx.principal);
    const scope = authorizeTenant(ctx, asId(draft.buyerOrganizationId), 'editor');

    const existing = await this.deps.repos.engagements.findByIdempotencyKey(scope, idempotencyKey);
    if (existing) return { engagement: existing, replayed: true };

    const { disclosure, supplierOrganizationId, offeringId, requirementId } = await this.buildDisclosure(ctx, draft);
    const claims = await this.deps.confirmations.verify(confirmationToken);
    if (
      claims.userId !== user.userId ||
      claims.organizationId !== scope.organizationId ||
      claims.action !== `engagement.${draft.type}` ||
      claims.digest !== digest({ draft: normalizeDraft(draft), disclosure })
    ) {
      await recordAudit(this.deps.repos.audit, ctx, this.deps.clock.now(), {
        action: 'engagement.confirm',
        resourceType: 'engagement',
        resourceId: null,
        organizationId: scope.organizationId,
        outcome: 'denied',
        metadata: { reason: 'confirmation_mismatch' },
      });
      throw new AppError('CONFIRMATION_REQUIRED', 'Confirmation token does not match this request; prepare it again');
    }

    const now = this.deps.clock.now();
    const engagement: EngagementRequest = {
      id: newId(),
      type: draft.type,
      buyerOrganizationId: scope.organizationId,
      supplierOrganizationId,
      offeringId,
      requirementId,
      disclosure,
      status: 'submitted',
      idempotencyKey,
      requestedBy: user.userId,
      confirmedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.transaction(async (repos) => {
      await repos.engagements.insert(scope, engagement);
      await recordAudit(repos.audit, ctx, now, {
        action: `engagement.${draft.type}.submitted`,
        resourceType: 'engagement',
        resourceId: engagement.id,
        organizationId: scope.organizationId,
        metadata: { supplierOrganizationId, sharedRequirementConstraints: disclosure.requirement !== null },
      });
    });
    await this.deps.jobs.enqueue('engagement.notify', { engagementId: engagement.id });
    return { engagement, replayed: false };
  }

  async listForBuyer(ctx: RequestContext, organizationId: string) {
    const scope = authorizeTenant(ctx, asId(organizationId), 'viewer');
    return this.deps.repos.engagements.listForBuyer(scope);
  }

  /** Suppliers see only the disclosure snapshot, never the buyer's private requirement. */
  async listForSupplier(ctx: RequestContext, organizationId: string) {
    const scope = authorizeTenant(ctx, asId(organizationId), 'viewer');
    const items = await this.deps.repos.engagements.listForSupplier(scope);
    await recordAudit(this.deps.repos.audit, ctx, this.deps.clock.now(), {
      action: 'engagement.list_incoming',
      resourceType: 'engagement',
      resourceId: null,
      organizationId: scope.organizationId,
      metadata: { count: items.length },
    });
    return items;
  }

  async respond(ctx: RequestContext, supplierOrganizationId: string, engagementId: string, status: Extract<EngagementStatus, 'acknowledged' | 'declined' | 'closed'>) {
    const scope = authorizeTenant(ctx, asId(supplierOrganizationId), 'editor');
    const engagement = await this.deps.repos.engagements.findById(asId(engagementId));
    if (!engagement || engagement.supplierOrganizationId !== scope.organizationId) throw notFound('Engagement');
    const next = transitionEngagement(engagement, status, this.deps.clock.now());
    await this.deps.repos.engagements.updateStatus(next);
    await recordAudit(this.deps.repos.audit, ctx, next.updatedAt, { action: `engagement.${status}`, resourceType: 'engagement', resourceId: next.id, organizationId: scope.organizationId });
    return next;
  }

  private async buildDisclosure(ctx: RequestContext, draft: EngagementDraft) {
    requireScope(ctx.principal, 'engagements:write');
    const scope = authorizeTenant(ctx, asId(draft.buyerOrganizationId), 'editor');
    if (!EMAIL.test(draft.contactEmail)) throw validationError('contactEmail is invalid');
    const message = sanitizeUntrustedText(draft.message, 3000);
    if (message.length < 10) throw validationError('message must be at least 10 characters');

    const [buyer, offering] = await Promise.all([
      this.deps.repos.organizations.findById(scope.organizationId),
      this.deps.repos.offerings.findById(asId(draft.offeringId)),
    ]);
    if (!buyer) throw notFound('Organization');
    if (!offering || offering.status !== 'published') throw notFound('Offering');
    if (offering.organizationId === scope.organizationId) throw validationError('Cannot send a request to your own organization');
    const supplier = await this.deps.repos.organizations.findById(offering.organizationId);
    if (!supplier) throw notFound('Offering');

    let requirement = null;
    let confidentialTerms: readonly string[] = [];
    if (draft.requirementId) {
      const stored = await this.deps.repos.requirements.findById(scope, asId(draft.requirementId));
      if (!stored) throw notFound('Requirement');
      confidentialTerms = stored.confidentialTerms;
      requirement = toSupplierFacingRequirement(stored, draft.disclosedSummary ?? null, `REQ-${stored.id.slice(0, 8)}`);
    } else if (draft.disclosedSummary) {
      throw validationError('disclosedSummary requires a requirementId');
    }
    // The free-text message is checked against the requirement's confidential terms too.
    assertNoConfidentialLeak(`${message} ${draft.contactName}`, confidentialTerms);

    const disclosure: EngagementDisclosure = {
      buyerOrganizationName: buyer.name,
      contactName: sanitizeUntrustedText(draft.contactName, 120),
      contactEmail: draft.contactEmail.trim().toLowerCase(),
      message,
      requirement,
    };
    return {
      disclosure,
      supplierOrganizationId: supplier.id,
      supplierName: supplier.name,
      offeringId: offering.id,
      offeringName: offering.name,
      requirementId: draft.requirementId ? asId<'RequirementId'>(draft.requirementId) : null,
    };
  }

  private assertEnabled(): void {
    if (!this.deps.features.engagementActions) {
      throw new AppError('FEATURE_DISABLED', 'Engagement requests are disabled on this deployment');
    }
  }
}

const normalizeDraft = (draft: EngagementDraft) => ({
  buyerOrganizationId: draft.buyerOrganizationId,
  offeringId: draft.offeringId,
  type: draft.type,
  requirementId: draft.requirementId ?? null,
});
