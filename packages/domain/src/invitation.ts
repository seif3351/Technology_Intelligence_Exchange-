import type { InvitationId, OrganizationId, UserId } from './ids';
import type { OrganizationRole } from './membership';

/**
 * An invitation to join the platform (organizationId = null) or a specific
 * organization with a role. Only a hash of the secret token is stored.
 */
export interface Invitation {
  readonly id: InvitationId;
  readonly email: string;
  readonly organizationId: OrganizationId | null;
  readonly role: OrganizationRole | null;
  readonly tokenHash: string;
  readonly invitedBy: UserId;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly acceptedBy: UserId | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}

export const INVITATION_TTL_DAYS = 14;

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export const invitationStatus = (invitation: Invitation, now: Date): InvitationStatus => {
  if (invitation.acceptedAt) return 'accepted';
  if (invitation.revokedAt) return 'revoked';
  return invitation.expiresAt.getTime() <= now.getTime() ? 'expired' : 'pending';
};

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();
