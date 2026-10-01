import {
  type OrganizationRole,
  asId,
  canManageMember,
  forbidden,
  invariant,
  leavesOrganizationWithoutOwner,
  notFound,
} from '@atx/domain';
import type { ApplicationDeps } from '../deps';
import { authorizeTenant, requireUser } from '../policies';
import type { MemberRecord } from '../ports/repositories';
import type { RequestContext, TenantScope } from '../principal';
import { recordAudit } from './support';

export interface MemberView {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly role: OrganizationRole;
  readonly since: string;
}

const present = (member: MemberRecord): MemberView => ({
  userId: member.userId,
  displayName: member.displayName,
  email: member.email,
  role: member.role,
  since: member.createdAt.toISOString(),
});

/** Organization membership administration (roles, removal, leaving). */
export class MembershipService {
  constructor(private readonly deps: ApplicationDeps) {}

  async listMembers(ctx: RequestContext, organizationId: string): Promise<MemberView[]> {
    const scope = authorizeTenant(ctx, asId(organizationId), 'viewer');
    return (await this.deps.repos.users.listMembers(scope)).map(present);
  }

  async changeRole(
    ctx: RequestContext,
    organizationId: string,
    userId: string,
    role: OrganizationRole,
  ): Promise<MemberView> {
    const scope = authorizeTenant(ctx, asId(organizationId), 'admin');
    return this.deps.transaction(async (repos) => {
      const current = await this.targetRole(repos.users, scope, userId);
      if (!canManageMember(actorRole(scope), current, role))
        throw forbidden('You cannot assign a role higher than your own, and only owners can change owners');
      if (leavesOrganizationWithoutOwner(await repos.users.countOwners(scope), current, role))
        throw invariant('An organization needs at least one owner; make someone else owner first');
      await repos.users.updateMembershipRole(scope, asId(userId), role);
      await recordAudit(repos.audit, ctx, this.deps.clock.now(), {
        action: 'membership.role_change',
        resourceType: 'user',
        resourceId: userId,
        organizationId: scope.organizationId,
        metadata: { from: current, to: role },
      });
      const member = (await repos.users.listMembers(scope)).find((m) => m.userId === userId);
      if (!member) throw notFound('Member');
      return present(member);
    });
  }

  /** Removes a member, or lets a member leave (any role, except the last owner). */
  async removeMember(ctx: RequestContext, organizationId: string, userId: string): Promise<void> {
    const self = requireUser(ctx.principal).userId === userId;
    const scope = authorizeTenant(ctx, asId(organizationId), self ? 'viewer' : 'admin');
    await this.deps.transaction(async (repos) => {
      const current = await this.targetRole(repos.users, scope, userId);
      if (!self && !canManageMember(actorRole(scope), current, null))
        throw forbidden('Only owners can remove owners');
      if (leavesOrganizationWithoutOwner(await repos.users.countOwners(scope), current, null))
        throw invariant('An organization needs at least one owner; make someone else owner first');
      await repos.users.removeMembership(scope, asId(userId));
      await recordAudit(repos.audit, ctx, this.deps.clock.now(), {
        action: self ? 'membership.leave' : 'membership.remove',
        resourceType: 'user',
        resourceId: userId,
        organizationId: scope.organizationId,
        metadata: { role: current },
      });
    });
  }

  private async targetRole(
    users: ApplicationDeps['repos']['users'],
    scope: TenantScope,
    userId: string,
  ): Promise<OrganizationRole> {
    const role = await users.findMemberRole(scope, asId(userId));
    if (!role) throw notFound('Member');
    return role;
  }
}

const actorRole = (scope: TenantScope): OrganizationRole =>
  scope.role === 'system' || scope.role === 'platform_admin' ? 'owner' : scope.role;
