import {
  INVITATION_TTL_DAYS,
  type Invitation,
  type InvitationStatus,
  type OrganizationId,
  type OrganizationRole,
  asId,
  canManageMember,
  forbidden,
  invitationStatus,
  isPlausibleEmail,
  newId,
  normalizeEmail,
  notFound,
  roleAtLeast,
  validationError,
} from '@atx/domain';
import type { ApplicationDeps } from '../deps';
import { authorizeTenant, requirePlatformAdmin, requireVerifiedEmail } from '../policies';
import type { RequestContext } from '../principal';
import { deliver } from './account-mail';
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
  /** Whether the invitation email was delivered; if not, share `url` with the invitee yourself. */
  readonly emailed: boolean;
}

const invalidInvitation = () =>
  forbidden('This invitation is invalid, expired or addressed to a different email');

/**
 * Invitations: platform sign-up invitations (pilot, issued by platform
 * administrators) and organization invitations (issued by organization
 * admins, carrying a role). One entity, one issuing path; only a SHA-256 hash
 * of each token is stored.
 */
export class InvitationService {
  constructor(private readonly deps: ApplicationDeps) {}

  // ------------------------------------------------------------- platform

  async createPlatformInvitation(ctx: RequestContext, rawEmail: string): Promise<IssuedInvitation> {
    const admin = requirePlatformAdmin(ctx.principal);
    return this.issue(ctx, {
      email: rawEmail,
      organizationId: null,
      role: null,
      invitedBy: admin.userId,
      subject: 'Your invitation to the Automotive Technology Exchange pilot',
      intro: [
        'You have been invited to join the Automotive Technology Exchange, an evidence-backed technical',
        'discovery network for automotive technologies.',
      ],
    });
  }

  async listPlatformInvitations(ctx: RequestContext): Promise<InvitationView[]> {
    requirePlatformAdmin(ctx.principal);
    const now = this.deps.clock.now();
    return (await this.deps.repos.invitations.listPlatform(200)).map((item) => present(item, now));
  }

  async revokePlatformInvitation(ctx: RequestContext, invitationId: string): Promise<void> {
    requirePlatformAdmin(ctx.principal);
    const invitation = await this.deps.repos.invitations.findById(asId(invitationId));
    if (!invitation || invitation.organizationId !== null) throw notFound('Invitation');
    await this.revoke(ctx, invitation);
  }

  // --------------------------------------------------------- organization

  async createOrganizationInvitation(
    ctx: RequestContext,
    organizationId: string,
    input: { readonly email: string; readonly role: OrganizationRole },
  ): Promise<IssuedInvitation> {
    const scope = authorizeTenant(ctx, asId(organizationId), 'admin');
    const actor = requireVerifiedEmail(ctx.principal);
    if (scope.role === 'system' || !canManageMember(scope.role as OrganizationRole, null, input.role))
      throw forbidden('You cannot invite people with a role higher than your own');
    const email = normalizeEmail(input.email);
    const members = await this.deps.repos.users.listMembers(scope);
    if (members.some((member) => member.email === email))
      throw validationError('This person is already a member of the organization');
    const organization = await this.deps.repos.organizations.findById(scope.organizationId);
    if (!organization) throw notFound('Organization');
    return this.issue(ctx, {
      email,
      organizationId: scope.organizationId,
      role: input.role,
      invitedBy: actor.userId,
      subject: `Join ${organization.name} on the Automotive Technology Exchange`,
      intro: [
        `${actor.displayName} invited you to join ${organization.name} as ${input.role} on the`,
        'Automotive Technology Exchange. If you already have an account, sign in first, then open the link.',
      ],
    });
  }

  async listOrganizationInvitations(ctx: RequestContext, organizationId: string): Promise<InvitationView[]> {
    const scope = authorizeTenant(ctx, asId(organizationId), 'admin');
    const now = this.deps.clock.now();
    return (await this.deps.repos.invitations.listForOrganization(scope)).map((item) => present(item, now));
  }

  async revokeOrganizationInvitation(
    ctx: RequestContext,
    organizationId: string,
    invitationId: string,
  ): Promise<void> {
    const scope = authorizeTenant(ctx, asId(organizationId), 'admin');
    const invitation = await this.deps.repos.invitations.findById(asId(invitationId));
    // Same 404 for missing and foreign invitations (no IDOR oracle).
    if (!invitation || invitation.organizationId !== scope.organizationId) throw notFound('Invitation');
    await this.revoke(ctx, invitation);
  }

  /**
   * An existing, signed-in user accepts an organization invitation addressed
   * to their email. New users accept implicitly by registering with the token.
   */
  async acceptOrganizationInvitation(
    ctx: RequestContext,
    token: string,
  ): Promise<{ organizationId: string }> {
    const principal = ctx.principal;
    if (principal.kind !== 'user') throw invalidInvitation();
    const user = await this.deps.repos.users.findById(principal.userId);
    const invitation = await this.deps.repos.invitations.findByTokenHash(hashSecretToken(token));
    const now = this.deps.clock.now();
    if (
      !user ||
      !invitation ||
      !invitation.organizationId ||
      !invitation.role ||
      invitation.email !== user.email ||
      invitationStatus(invitation, now) !== 'pending'
    )
      throw invalidInvitation();
    const { organizationId, role } = invitation;
    await this.deps.transaction(async (repos) => {
      if (!(await repos.invitations.markAccepted(invitation.id, user.id, now))) throw invalidInvitation();
      const current = principal.memberships.find((m) => m.organizationId === organizationId)?.role ?? null;
      // Never downgrade an existing membership through an invitation.
      if (current === null || !roleAtLeast(current, role))
        await repos.users.addMembership({ organizationId, userId: user.id, role, createdAt: now });
      // The token reached this mailbox: the address is proven.
      await repos.users.markEmailVerified(user.id, now);
      await recordAudit(repos.audit, ctx, now, {
        action: 'invitation.accept',
        resourceType: 'invitation',
        resourceId: invitation.id,
        organizationId,
        metadata: { role },
      });
    });
    return { organizationId };
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

  // -------------------------------------------------------------- shared

  private async issue(
    ctx: RequestContext,
    input: {
      readonly email: string;
      readonly organizationId: OrganizationId | null;
      readonly role: OrganizationRole | null;
      readonly invitedBy: Invitation['invitedBy'];
      readonly subject: string;
      readonly intro: readonly string[];
    },
  ): Promise<IssuedInvitation> {
    const email = normalizeEmail(input.email);
    if (!isPlausibleEmail(email)) throw validationError('Invalid email address');
    const now = this.deps.clock.now();
    const token = generateSecretToken();
    const invitation: Invitation = {
      id: newId(),
      email,
      organizationId: input.organizationId,
      role: input.role,
      tokenHash: hashSecretToken(token),
      invitedBy: input.invitedBy,
      expiresAt: new Date(now.getTime() + INVITATION_TTL_DAYS * DAY_MS),
      acceptedAt: null,
      acceptedBy: null,
      revokedAt: null,
      createdAt: now,
    };
    await this.deps.transaction(async (repos) => {
      await repos.invitations.insert(invitation);
      await recordAudit(repos.audit, ctx, now, {
        action: input.organizationId ? 'invitation.organization.create' : 'invitation.platform.create',
        resourceType: 'invitation',
        resourceId: invitation.id,
        organizationId: input.organizationId,
        ...(input.role ? { metadata: { role: input.role } } : {}),
      });
    });
    const url = new URL('/signup', this.deps.settings.publicWebUrl);
    url.searchParams.set('invite', token);
    const emailed = await deliver(this.deps, {
      to: email,
      subject: input.subject,
      text: [
        'Hello,',
        '',
        ...input.intro,
        '',
        `Your personal link (valid for ${INVITATION_TTL_DAYS} days, for ${email} only):`,
        url.toString(),
      ].join('\n'),
    });
    return { invitation: present(invitation, now), url: url.toString(), emailed };
  }

  private async revoke(ctx: RequestContext, invitation: Invitation): Promise<void> {
    const now = this.deps.clock.now();
    await this.deps.transaction(async (repos) => {
      if (!(await repos.invitations.revoke(invitation.id, now)))
        throw validationError('Only pending invitations can be revoked');
      await recordAudit(repos.audit, ctx, now, {
        action: 'invitation.revoke',
        resourceType: 'invitation',
        resourceId: invitation.id,
        organizationId: invitation.organizationId,
      });
    });
  }
}

const present = (invitation: Invitation, now: Date): InvitationView => ({
  id: invitation.id,
  email: invitation.email,
  organizationId: invitation.organizationId,
  role: invitation.role,
  status: invitationStatus(invitation, now),
  expiresAt: invitation.expiresAt.toISOString(),
  createdAt: invitation.createdAt.toISOString(),
});
