import type { AccessGrantId, UserId } from './ids';

/**
 * A user's standing permission for a client (personal agent token or OAuth
 * client) to act on their behalf. Access tokens reference their grant, so a
 * grant can be revoked individually before the token expires.
 */
export const ACCESS_GRANT_KINDS = ['agent_token', 'oauth'] as const;
export type AccessGrantKind = (typeof ACCESS_GRANT_KINDS)[number];

export const AGENT_TOKEN_MAX_DAYS = 90;

export interface AccessGrant {
  readonly id: AccessGrantId;
  readonly userId: UserId;
  readonly kind: AccessGrantKind;
  readonly label: string;
  readonly clientId: string | null;
  readonly scopes: readonly string[];
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
}

export type AccessGrantStatus = 'active' | 'revoked' | 'expired';

export const accessGrantStatus = (grant: AccessGrant, now: Date): AccessGrantStatus => {
  if (grant.revokedAt) return 'revoked';
  return grant.expiresAt.getTime() <= now.getTime() ? 'expired' : 'active';
};
