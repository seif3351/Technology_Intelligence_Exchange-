import {
  AppError,
  type Offering,
  type Organization,
  type OrganizationId,
  type OrganizationRole,
  type UserId,
  forbidden,
  isPubliclyListed,
  roleAtLeast,
  unauthenticated,
} from '@atx/domain';
import type { Principal, RequestContext, Scope, TenantScope, UserPrincipal } from './principal';

export const requireUser = (principal: Principal): UserPrincipal => {
  if (principal.kind !== 'user') throw unauthenticated();
  return principal;
};

export const hasScope = (principal: Principal, scope: Scope): boolean =>
  principal.kind === 'system' || (principal.kind === 'user' && principal.scopes.has(scope));

export const requireScope = (principal: Principal, scope: Scope): void => {
  if (principal.kind === 'anonymous') throw unauthenticated(`Scope "${scope}" requires authentication`);
  if (!hasScope(principal, scope)) {
    throw new AppError('FORBIDDEN', `Missing required scope "${scope}"`, [{ path: 'scope', message: scope }]);
  }
};

export const isPlatformAdmin = (principal: Principal): boolean =>
  principal.kind === 'user' && principal.platformRole === 'platform_admin' && principal.scopes.has('admin');

/** Actions that create organizations or contact third parties need a proven email address. */
export const requireVerifiedEmail = (principal: Principal): UserPrincipal => {
  const user = requireUser(principal);
  if (!user.emailVerified)
    throw forbidden('Please confirm your email address first (check your inbox or request a new link)');
  return user;
};

/** Use cases that only background jobs may run. */
export const forbiddenUnlessSystem = (principal: Principal): void => {
  if (principal.kind !== 'system') throw forbidden('This task runs as a system job');
};

export const requirePlatformAdmin = (principal: Principal): UserPrincipal => {
  const user = requireUser(principal);
  if (!isPlatformAdmin(user)) throw forbidden('Platform administrator role required');
  return user;
};

export const membershipRole = (
  principal: Principal,
  organizationId: OrganizationId,
): OrganizationRole | null =>
  principal.kind === 'user'
    ? (principal.memberships.find((membership) => membership.organizationId === organizationId)?.role ?? null)
    : null;

/**
 * The single gate for tenant-owned data. Verifies membership and role for a
 * client-supplied organization id and returns an unforgeable TenantScope.
 * Platform admins do NOT get implicit access to private buyer data.
 */
export const authorizeTenant = (
  ctx: RequestContext,
  organizationId: OrganizationId,
  minimumRole: OrganizationRole,
): TenantScope => {
  const { principal } = ctx;
  if (principal.kind === 'system') return { organizationId, role: 'system' } as TenantScope;
  const user = requireUser(principal);
  const role = membershipRole(user, organizationId);
  if (role === null || !roleAtLeast(role, minimumRole)) {
    throw forbidden('You are not a member of this organization with the required role');
  }
  return { organizationId, role } as TenantScope;
};

/** Supplier-side content moderation scope for platform admins (public catalog data only). */
export const adminScopeFor = (ctx: RequestContext, organizationId: OrganizationId): TenantScope => {
  requirePlatformAdmin(ctx.principal);
  return { organizationId, role: 'platform_admin' } as TenantScope;
};

/** Insiders (members, platform admins, system) may see drafts and unlisted organizations. */
export const isInsider = (principal: Principal, organizationId: OrganizationId): boolean =>
  principal.kind === 'system' ||
  isPlatformAdmin(principal) ||
  membershipRole(principal, organizationId) !== null;

/** Published offerings are public only while their organization is listed (ADR 0011). */
export const canViewOffering = (
  principal: Principal,
  offering: Offering,
  organization: Pick<Organization, 'verificationState'>,
): boolean =>
  (offering.status === 'published' && isPubliclyListed(organization)) ||
  isInsider(principal, offering.organizationId);

export const canViewSupplier = (principal: Principal, organization: Organization): boolean =>
  organization.kind !== 'buyer' && (isPubliclyListed(organization) || isInsider(principal, organization.id));

export const actorUserId = (principal: Principal): UserId | null =>
  principal.kind === 'user' ? principal.userId : null;
