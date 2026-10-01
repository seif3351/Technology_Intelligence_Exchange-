import {
  INVITATION_TTL_DAYS,
  type Invitation,
  type InvitationStatus,
  asId,
  invitationStatus,
  newId,
  normalizeEmail,
  notFound,
  validationError,
  isPlausibleEmail,
} from '@atx/domain';
import type { ApplicationDeps } from '../deps';
import { requirePlatformAdmin } from '../policies';
import type { RequestContext } from '../principal';
import { generateSecretToken, hashSecretToken, recordAudit } from './support';

const DAY_MS = 86_400_000;

export interface InvitationView {
  readonly id: string;
  readonly email: string;
  readonly organizationId: string | null;
  readonly role: string | null;
  readonly status: InvitationStatus;
  readonly expiresAt: string;
  readonly createdAt: string;
}

/** Returned once at creation: the only time the secret link exists outside the invitee's inbox. */
export interface IssuedInvitation {
  readonly invitation: InvitationView;
  readonly url: string;
}

/**
 * Invitations: platform sign-up invitations (pilot, `REGISTRATION_MODE=invite`)
 * issued by platform administrators. Organization invitations reuse the same
 * entity. Only a SHA-256 hash of each token is stored.
 */
export class InvitationService {
  constructor(private readonly deps: ApplicationDeps) {}

  async createPlatformInvitation(ctx: RequestContext, rawEmail: string): Promise<IssuedInvitation> {
    const admin = requirePlatformAdmin(ctx.principal);
    const email = normalizeEmail(rawEmail);
    if (!isPlausibleEmail(email)) throw validationError('Invalid email address');
    const now = this.deps.clock.now();
    const token = generateSecretToken();
    const invitation: Invitation = {
      id: newId(),
      email,
      organizationId: null,
      role: null,
      tokenHash: hashSecretToken(token),
      invitedBy: admin.userId,
      expiresAt: new Date(now.getTime() + INVITATION_TTL_DAYS * DAY_MS),
      acceptedAt: null,
      acceptedBy: null,
      revokedAt: null,
      createdAt: now,
    };
    await this.deps.transaction(async (repos) => {
      await repos.invitations.insert(invitation);
      await recordAudit(repos.audit, ctx, now, {
        action: 'invitation.platform.create',
        resourceType: 'invitation',
        resourceId: invitation.id,
        organizationId: null,
      });
    });
    return { invitation: this.present(invitation, now), url: this.signupUrl(token) };
  }

  async listPlatformInvitations(ctx: RequestContext): Promise<InvitationView[]> {
    requirePlatformAdmin(ctx.principal);
    const now = this.deps.clock.now();
    return (await this.deps.repos.invitations.listPlatform(200)).map((item) => this.present(item, now));
  }

  async revokePlatformInvitation(ctx: RequestContext, invitationId: string): Promise<void> {
    requirePlatformAdmin(ctx.principal);
    const invitation = await this.deps.repos.invitations.findById(asId(invitationId));
    if (!invitation || invitation.organizationId !== null) throw notFound('Invitation');
    const now = this.deps.clock.now();
    await this.deps.transaction(async (repos) => {
      if (!(await repos.invitations.revoke(invitation.id, now)))
        throw validationError('Only pending invitations can be revoked');
      await recordAudit(repos.audit, ctx, now, {
        action: 'invitation.revoke',
        resourceType: 'invitation',
        resourceId: invitation.id,
        organizationId: null,
      });
    });
  }

  /**
   * Public lookup for the sign-up page. Possession of the secret token is the
   * authorization; unusable tokens all look the same.
   */
  async describe(token: string): Promise<{
    readonly email: string;
    readonly organizationName: string | null;
    readonly role: string | null;
  }> {
    const invitation = await this.deps.repos.invitations.findByTokenHash(hashSecretToken(token));
    if (!invitation || invitationStatus(invitation, this.deps.clock.now()) !== 'pending')
      throw notFound('Invitation');
    const organization = invitation.organizationId
      ? await this.deps.repos.organizations.findById(invitation.organizationId)
      : null;
    return { email: invitation.email, organizationName: organization?.name ?? null, role: invitation.role };
  }

  private signupUrl(token: string): string {
    const url = new URL('/signup', this.deps.settings.publicWebUrl);
    url.searchParams.set('invite', token);
    return url.toString();
  }

  private present(invitation: Invitation, now: Date): InvitationView {
    return {
      id: invitation.id,
      email: invitation.email,
      organizationId: invitation.organizationId,
      role: invitation.role,
      status: invitationStatus(invitation, now),
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    };
  }
}
