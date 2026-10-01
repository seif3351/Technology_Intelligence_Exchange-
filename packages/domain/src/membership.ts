import type { OrganizationId, UserId } from './ids';

/** Roles within an organization (the tenant boundary). Ordered by privilege. */
export const ORGANIZATION_ROLES = ['viewer', 'editor', 'admin', 'owner'] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export const PLATFORM_ROLES = ['none', 'platform_admin'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export interface User {
  readonly id: UserId;
  readonly email: string;
  readonly displayName: string;
  readonly platformRole: PlatformRole;
  /** Version of the terms of use the user accepted (null for operator-created accounts). */
  readonly termsVersion: string | null;
  readonly termsAcceptedAt: Date | null;
  /** Set when the user proved ownership of the address (verification link or email-bound invitation). */
  readonly emailVerifiedAt: Date | null;
  /** Access tokens issued before this instant are rejected (password reset, sign-out everywhere). */
  readonly credentialsChangedAt: Date | null;
  readonly createdAt: Date;
}

export interface Membership {
  readonly organizationId: OrganizationId;
  readonly userId: UserId;
  readonly role: OrganizationRole;
  readonly createdAt: Date;
}

export const roleAtLeast = (role: OrganizationRole, minimum: OrganizationRole): boolean =>
  ORGANIZATION_ROLES.indexOf(role) >= ORGANIZATION_ROLES.indexOf(minimum);

/**
 * Membership administration rules. An actor needs at least `admin`, can only
 * grant or change roles up to their own, and only owners can touch owners.
 */
export const canManageMember = (
  actorRole: OrganizationRole,
  currentRole: OrganizationRole | null,
  newRole: OrganizationRole | null,
): boolean => {
  if (!roleAtLeast(actorRole, 'admin')) return false;
  const touchesOwner = currentRole === 'owner' || newRole === 'owner';
  if (touchesOwner && actorRole !== 'owner') return false;
  return newRole === null || roleAtLeast(actorRole, newRole);
};

/** An organization must always keep at least one owner. */
export const leavesOrganizationWithoutOwner = (
  ownerCount: number,
  currentRole: OrganizationRole,
  newRole: OrganizationRole | null,
): boolean => currentRole === 'owner' && newRole !== 'owner' && ownerCount <= 1;
