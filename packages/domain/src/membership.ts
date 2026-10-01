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
