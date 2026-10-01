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
  respondToEngagement,
  roleAtLeast,
  transitionEngagement,
  validationError,
  isPlausibleEmail,
  normalizeEmail,
} from '@atx/domain';
import type { ApplicationDeps } from '../deps';
import { authorizeTenant, requireScope, requireUser, requireVerifiedEmail } from '../policies';
import type { RequestContext } from '../principal';
import { presentConstraint } from '../views';
import { plainName } from './account-mail';
import { digest, recordAudit } from './support';

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
const ENGAGEMENT_LABEL: Readonly<Record<EngagementType, string>> = {
  demo: 'demo',
  workshop: 'workshop',
  poc: 'proof-of-concept',
  rfi: 'RFI',
};

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
        willNotBeShared: [
          'requirement title',
          'requirement description',
          'confidential terms',
          'other requirements',
          'search history',
        ],
      },
      confirmationToken: token,
      expiresAt: expiresAt.toISOString(),
      requiresHumanConfirmation: true as const,
    };
  }

  async confirm(
    ctx: RequestContext,
    draft: EngagementDraft,
    confirmationToken: string,
    idempotencyKey: string,
  ) {
    this.assertEnabled();
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(idempotencyKey))
      throw validationError('idempotencyKey must be 8-100 URL-safe characters');
    const user = requireVerifiedEmail(ctx.principal);
    const scope = authorizeTenant(ctx, asId(draft.buyerOrganizationId), 'editor');

    const existing = await this.deps.repos.engagements.findByIdempotencyKey(scope, idempotencyKey);
    if (existing) return { engagement: existing, replayed: true };

    const { disclosure, supplierOrganizationId, offeringId, requirementId } = await this.buildDisclosure(
      ctx,
      draft,
    );
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
      throw new AppError(
        'CONFIRMATION_REQUIRED',
        'Confirmation token does not match this request; prepare it again',
      );
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
      supplierResponse: null,
      respondedBy: null,
      respondedAt: null,
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

  /**
   * Supplier response. Acknowledging requires a contact person, which is then
   * shared with the buyer (contact handover); declining may include a note.
   */
  async respond(
    ctx: RequestContext,
    supplierOrganizationId: string,
    engagementId: string,
    input: {
      readonly status: Extract<EngagementStatus, 'acknowledged' | 'declined' | 'closed'>;
      readonly message?: string | null;
      readonly contactName?: string | null;
      readonly contactEmail?: string | null;
    },
  ) {
    const scope = authorizeTenant(ctx, asId(supplierOrganizationId), 'editor');
    const user = requireVerifiedEmail(ctx.principal);
    const engagement = await this.deps.repos.engagements.findById(asId(engagementId));
    if (!engagement || engagement.supplierOrganizationId !== scope.organizationId)
      throw notFound('Engagement');
    const now = this.deps.clock.now();
    let next: EngagementRequest;
    if (input.status === 'closed') {
      next = transitionEngagement(engagement, 'closed', now);
    } else {
      const contactEmail = input.contactEmail ? normalizeEmail(input.contactEmail) : null;
      if (contactEmail && !isPlausibleEmail(contactEmail)) throw validationError('contactEmail is invalid');
      next = respondToEngagement(
        engagement,
        input.status,
        {
          message: input.message ? sanitizeUntrustedText(input.message, 2000) : null,
          contactName: input.contactName ? sanitizeUntrustedText(input.contactName, 120) : null,
          contactEmail,
        },
        user.userId,
        now,
      );
    }
    await this.deps.transaction(async (repos) => {
      await repos.engagements.updateStatus(next, engagement.status);
      await recordAudit(repos.audit, ctx, now, {
        action: `engagement.${input.status}`,
        resourceType: 'engagement',
        resourceId: next.id,
        organizationId: scope.organizationId,
        metadata: { contactShared: next.supplierResponse?.contactEmail != null },
      });
    });
    if (input.status !== 'closed')
      await this.deps.jobs.enqueue('engagement.response_notify', { engagementId: next.id });
    return next;
  }

  /**
   * Worker: tells the supplier's responders (editor and above) about a new
   * request. Only metadata and a link; the request itself stays in the app.
   * Throws on delivery failure so the job is retried.
   */
  async notifySupplier(ctx: RequestContext, engagementId: string): Promise<number> {
    const engagement = await this.deps.repos.engagements.findById(asId(engagementId));
    if (!engagement) return 0;
    const scope = authorizeTenant(ctx, engagement.supplierOrganizationId, 'viewer');
    const offering = engagement.offeringId
      ? await this.deps.repos.offerings.findById(engagement.offeringId)
      : null;
    const recipients = (await this.deps.repos.users.listMembers(scope)).filter((m) =>
      roleAtLeast(m.role, 'editor'),
    );
    const link = new URL('/workspace', this.deps.settings.publicWebUrl).toString();
    for (const recipient of recipients)
      await this.deps.mailer.send({
        to: recipient.email,
        subject: `New ${ENGAGEMENT_LABEL[engagement.type]} request on the Automotive Technology Exchange`,
        text: [
          `Hello ${plainName(recipient.displayName)},`,
          '',
          `${plainName(engagement.disclosure.buyerOrganizationName)} sent a ${ENGAGEMENT_LABEL[engagement.type]} request` +
            (offering ? ` about ${plainName(offering.name)}.` : '.'),
          'Read it and respond in your supplier workspace:',
          link,
        ].join('\n'),
      });
    this.deps.telemetry.increment('atx.engagement.notifications', {
      kind: 'supplier',
      count: recipients.length,
    });
    return recipients.length;
  }

  /** Worker: tells the buyer contact that the supplier responded. */
  async notifyBuyer(_ctx: RequestContext, engagementId: string): Promise<boolean> {
    const engagement = await this.deps.repos.engagements.findById(asId(engagementId));
    if (!engagement || !engagement.supplierResponse) return false;
    const supplier = await this.deps.repos.organizations.findById(engagement.supplierOrganizationId);
    const verb = engagement.status === 'acknowledged' ? 'accepted' : 'declined';
    await this.deps.mailer.send({
      to: engagement.disclosure.contactEmail,
      subject: `${plainName(supplier?.name ?? 'A supplier')} ${verb} your ${ENGAGEMENT_LABEL[engagement.type]} request`,
      text: [
        `Hello ${plainName(engagement.disclosure.contactName)},`,
        '',
        `${plainName(supplier?.name ?? 'The supplier')} ${verb} your ${ENGAGEMENT_LABEL[engagement.type]} request.`,
        engagement.status === 'acknowledged'
          ? 'Their contact person and reply are shown with the request:'
          : 'Details are shown with the request:',
        new URL('/buyer/requests', this.deps.settings.publicWebUrl).toString(),
      ].join('\n'),
    });
    this.deps.telemetry.increment('atx.engagement.notifications', { kind: 'buyer', count: 1 });
    return true;
  }

  private async buildDisclosure(ctx: RequestContext, draft: EngagementDraft) {
    requireScope(ctx.principal, 'engagements:write');
    const scope = authorizeTenant(ctx, asId(draft.buyerOrganizationId), 'editor');
    if (!isPlausibleEmail(draft.contactEmail)) throw validationError('contactEmail is invalid');
    const message = sanitizeUntrustedText(draft.message, 3000);
    if (message.length < 10) throw validationError('message must be at least 10 characters');

    const [buyer, offering] = await Promise.all([
      this.deps.repos.organizations.findById(scope.organizationId),
      this.deps.repos.offerings.findById(asId(draft.offeringId)),
    ]);
    if (!buyer) throw notFound('Organization');
    if (!offering || offering.status !== 'published') throw notFound('Offering');
    if (offering.organizationId === scope.organizationId)
      throw validationError('Cannot send a request to your own organization');
    const supplier = await this.deps.repos.organizations.findById(offering.organizationId);
    if (!supplier) throw notFound('Offering');

    let requirement = null;
    let confidentialTerms: readonly string[] = [];
    if (draft.requirementId) {
      const stored = await this.deps.repos.requirements.findById(scope, asId(draft.requirementId));
      if (!stored) throw notFound('Requirement');
      confidentialTerms = stored.confidentialTerms;
      requirement = toSupplierFacingRequirement(
        stored,
        draft.disclosedSummary ?? null,
        `REQ-${stored.id.slice(0, 8)}`,
      );
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
