import type {
  Brand,
  Channel,
  OrganizationId,
  OrganizationKind,
  OrganizationRole,
  PlatformRole,
  UserId,
} from '@atx/domain';

/**
 * OAuth-style scopes. Web sessions receive every scope their roles allow;
 * MCP/API tokens carry only the scopes the user consented to.
 */
export const SCOPES = [
  'catalog:read',
  'requirements:read',
  'requirements:write',
  'engagements:write',
  'supplier:write',
  'admin',
] as const;
export type Scope = (typeof SCOPES)[number];

export interface PrincipalMembership {
  readonly organizationId: OrganizationId;
  readonly organizationKind: OrganizationKind;
  readonly role: OrganizationRole;
}

export interface UserPrincipal {
  readonly kind: 'user';
  readonly userId: UserId;
  readonly displayName: string;
  readonly platformRole: PlatformRole;
  readonly memberships: readonly PrincipalMembership[];
  readonly scopes: ReadonlySet<Scope>;
  /** OAuth client that acts on behalf of the user (e.g. an AI agent host), if any. */
  readonly clientId: string | null;
  readonly channel: Channel;
}

export interface AnonymousPrincipal {
  readonly kind: 'anonymous';
  readonly channel: Channel;
}

export interface SystemPrincipal {
  readonly kind: 'system';
  readonly component: string;
}

export type Principal = UserPrincipal | AnonymousPrincipal | SystemPrincipal;

/** Per-request context passed explicitly to every use case. */
export interface RequestContext {
  readonly principal: Principal;
  readonly requestId: string;
}

/**
 * Proof that the current principal was authorized for an organization.
 * Only `authorizeTenant` (policies.ts) can mint one; tenant-owned
 * repository methods require it, so an unchecked client-supplied
 * organization id cannot reach a query.
 */
export type TenantScope = Brand<
  { readonly organizationId: OrganizationId; readonly role: OrganizationRole | 'platform_admin' | 'system' },
  'TenantScope'
>;
