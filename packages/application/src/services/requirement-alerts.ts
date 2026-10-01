import { asId, notFound, type OfferingId } from '@atx/domain';
import type { ApplicationDeps } from '../deps';
import { authorizeTenant, forbiddenUnlessSystem, requireScope, requireUser } from '../policies';
import type { RequestContext } from '../principal';
import { plainName } from './account-mail';
import type { MatchingService } from './matching';
import { recordAudit } from './support';

/**
 * Opt-in "new match" alerts for saved private requirements. When an offering
 * becomes publicly listed, the system job evaluates it against every watched
 * requirement (re-authorized per tenant and audited by the matcher) and
 * emails the watcher once per requirement/offering when all hard constraints
 * are met. Nothing about the requirement is shared with the supplier.
 */
export class RequirementAlertService {
  constructor(
    private readonly deps: ApplicationDeps,
    private readonly matching: MatchingService,
  ) {}

  async getAlerts(ctx: RequestContext, organizationId: string, requirementId: string) {
    requireScope(ctx.principal, 'requirements:read');
    const scope = authorizeTenant(ctx, asId(organizationId), 'viewer');
    const watch = await this.deps.repos.requirements.findWatch(scope, asId(requirementId));
    return { enabled: watch !== null };
  }

  async setAlerts(ctx: RequestContext, organizationId: string, requirementId: string, enabled: boolean) {
    requireScope(ctx.principal, 'requirements:read');
    const user = requireUser(ctx.principal);
    const scope = authorizeTenant(ctx, asId(organizationId), 'viewer');
    if (!(await this.deps.repos.requirements.findById(scope, asId(requirementId))))
      throw notFound('Requirement');
    const now = this.deps.clock.now();
    await this.deps.repos.requirements.setWatch(
      scope,
      asId(requirementId),
      enabled ? user.userId : null,
      now,
    );
    await recordAudit(this.deps.repos.audit, ctx, now, {
      action: enabled ? 'requirement.alerts.enable' : 'requirement.alerts.disable',
      resourceType: 'requirement',
      resourceId: requirementId,
      organizationId: scope.organizationId,
    });
    return { enabled };
  }

  /** Worker job: evaluate a newly listed offering against all watched requirements. */
  async alertForNewOffering(ctx: RequestContext, offeringId: OfferingId): Promise<number> {
    forbiddenUnlessSystem(ctx.principal);
    const offering = await this.deps.repos.offerings.findById(offeringId);
    if (!offering || offering.status !== 'published') return 0;
    const supplier = await this.deps.repos.organizations.findById(offering.organizationId);
    let sent = 0;
    for (const watch of await this.deps.repos.requirements.listAllWatchesForAlerting()) {
      if (watch.organizationId === offering.organizationId) continue;
      const result = await this.matching.findMatches(ctx, {
        requirement: { organizationId: watch.organizationId, requirementId: watch.requirementId },
        offeringIds: [offering.id],
        limit: 1,
      });
      const match = result.matches[0];
      if (!match || match.hardConstraintStatus !== 'all_met') continue;
      if (
        !(await this.deps.repos.requirements.recordAlert(
          watch.requirementId,
          offering.id,
          this.deps.clock.now(),
        ))
      )
        continue;
      const scope = authorizeTenant(ctx, watch.organizationId, 'viewer');
      const [requirement, user] = await Promise.all([
        this.deps.repos.requirements.findById(scope, watch.requirementId),
        this.deps.repos.users.findById(watch.userId),
      ]);
      if (!requirement || !user) continue;
      await this.deps.mailer.send({
        to: user.email,
        subject: 'New match for your saved requirement — Automotive Technology Exchange',
        text: [
          `Hello ${plainName(user.displayName)},`,
          '',
          `A newly listed offering meets all hard constraints of your private requirement "${plainName(requirement.title)}":`,
          `${plainName(offering.name)} by ${plainName(supplier?.name ?? 'a supplier')}`,
          '(supplier statements; check the evidence basis before relying on it)',
          new URL(`/offerings/${offering.id}`, this.deps.settings.publicWebUrl).toString(),
          '',
          'Turn these alerts off on the requirement page.',
        ].join('\n'),
      });
      sent += 1;
    }
    this.deps.telemetry.increment('atx.requirement_alerts.sent', { count: sent });
    return sent;
  }
}
