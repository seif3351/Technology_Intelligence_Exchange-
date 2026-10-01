import {
  type Channel,
  type User,
  type UserId,
  forbidden,
  invitationStatus,
  newId,
  normalizeEmail,
  sanitizeUntrustedText,
  unauthenticated,
  validationError,
} from '@atx/domain';
import type { ApplicationDeps } from '../deps';
import { requireUser } from '../policies';
import { hashSecretToken, recordAudit } from './support';
import { type RequestContext, SCOPES, type Scope, type UserPrincipal } from '../principal';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,20}$/;

/**
 * Builds principals from verified identities. Credential checks exist for the
 * built-in (development / small deployment) identity provider; production
 * deployments can federate to an external OIDC provider and only use
 * `principalFor`.
 */
export class IdentityService {
  constructor(
    private readonly deps: ApplicationDeps,
    private readonly passwords: PasswordHasher,
  ) {}

  /**
   * Self-service registration. Requires acceptance of the current terms and,
   * in `invite` mode, a valid invitation addressed to the same email. An
   * organization invitation also grants its membership.
   */
  async register(
    ctx: RequestContext,
    input: {
      readonly email: string;
      readonly password: string;
      readonly displayName: string;
      readonly acceptTerms: boolean;
      readonly invitationToken?: string | null;
    },
  ): Promise<User> {
    if (!input.acceptTerms) throw validationError('You must accept the terms of use to register');
    const email = normalizeEmail(input.email);
    const invitation = input.invitationToken
      ? await this.deps.repos.invitations.findByTokenHash(hashSecretToken(input.invitationToken))
      : null;
    const now = this.deps.clock.now();
    if (input.invitationToken) {
      // One message for unknown, used, revoked, expired and mismatched invitations.
      if (!invitation || invitation.email !== email || invitationStatus(invitation, now) !== 'pending')
        throw forbidden('This invitation is invalid, expired or addressed to a different email');
    } else if (this.deps.settings.registrationMode === 'invite') {
      throw forbidden('Registration is by invitation only during the pilot');
    }
    const user = this.newUser(email, input, { version: this.deps.settings.termsVersion, acceptedAt: now });
    const passwordHash = await this.passwords.hash(input.password);
    await this.deps.transaction(async (repos) => {
      if (await repos.users.findCredentialByEmail(email)) throw validationError('Registration failed');
      await repos.users.insert(user, passwordHash);
      if (invitation) {
        if (!(await repos.invitations.markAccepted(invitation.id, user.id, now)))
          throw forbidden('This invitation is invalid, expired or addressed to a different email');
        if (invitation.organizationId && invitation.role)
          await repos.users.addMembership({
            organizationId: invitation.organizationId,
            userId: user.id,
            role: invitation.role,
            createdAt: now,
          });
      }
      await recordAudit(repos.audit, ctx, now, {
        action: 'user.register',
        resourceType: 'user',
        resourceId: user.id,
        organizationId: invitation?.organizationId ?? null,
        metadata: { invited: invitation !== null, termsVersion: this.deps.settings.termsVersion },
      });
    });
    return user;
  }

  private newUser(
    email: string,
    input: { readonly password: string; readonly displayName: string },
    terms: { readonly version: string; readonly acceptedAt: Date } | null,
  ): User {
    if (!EMAIL.test(email)) throw validationError('Invalid email address');
    if (input.password.length < 12 || input.password.length > 200)
      throw validationError('Password must be 12-200 characters');
    return {
      id: newId(),
      email,
      displayName: sanitizeUntrustedText(input.displayName, 120) || email,
      platformRole: 'none',
      termsVersion: terms?.version ?? null,
      termsAcceptedAt: terms?.acceptedAt ?? null,
      createdAt: this.deps.clock.now(),
    };
  }

  /**
   * Operator bootstrap (CLI only): creates a platform administrator or
   * promotes an existing account. Never reachable from HTTP or MCP.
   */
  async bootstrapPlatformAdmin(
    ctx: RequestContext,
    input: { readonly email: string; readonly displayName: string; readonly password: string | null },
  ): Promise<{ readonly user: User; readonly created: boolean }> {
    if (ctx.principal.kind !== 'system') throw forbidden('Only operators can bootstrap administrators');
    const email = normalizeEmail(input.email);
    const existing = await this.deps.repos.users.findCredentialByEmail(email);
    let user: User;
    let created = false;
    if (existing) {
      user = { ...existing.user, platformRole: 'platform_admin' };
      await this.deps.repos.users.setPlatformRole(user.id, 'platform_admin');
    } else {
      if (!input.password) throw validationError('A password is required to create a new administrator');
      // Operator-created accounts record no terms acceptance (operators act under their own agreement).
      user = {
        ...this.newUser(email, { password: input.password, displayName: input.displayName }, null),
        platformRole: 'platform_admin',
      };
      await this.deps.repos.users.insert(user, await this.passwords.hash(input.password));
      created = true;
    }
    await recordAudit(this.deps.repos.audit, ctx, this.deps.clock.now(), {
      action: 'user.platform_admin.grant',
      resourceType: 'user',
      resourceId: user.id,
      organizationId: null,
      metadata: { created },
    });
    return { user, created };
  }

  profile(ctx: RequestContext) {
    return describePrincipal(this.deps, ctx);
  }

  /** Constant-work credential check: same error for unknown user and wrong password. */
  async authenticate(email: string, password: string): Promise<User> {
    const credential = await this.deps.repos.users.findCredentialByEmail(email.trim().toLowerCase());
    const ok = await this.passwords.verify(password, credential?.passwordHash ?? DUMMY_HASH);
    if (!credential || !ok) throw unauthenticated('Invalid email or password');
    return credential.user;
  }

  /**
   * Resolves the principal for a verified user id. `grantedScopes` narrows the
   * scopes (e.g. what an OAuth client was granted); roles narrow them further.
   */
  async principalFor(
    userId: UserId,
    options: {
      readonly channel: Channel;
      readonly clientId: string | null;
      readonly grantedScopes: readonly string[] | 'all';
    },
  ): Promise<UserPrincipal> {
    const user = await this.deps.repos.users.findById(userId);
    if (!user) throw unauthenticated();
    const memberships = await this.deps.repos.users.listMemberships(user.id);
    const allowed = new Set<Scope>(['catalog:read']);
    if (memberships.length > 0) {
      allowed.add('requirements:read');
      allowed.add('requirements:write');
      allowed.add('engagements:write');
      allowed.add('supplier:write');
    }
    if (user.platformRole === 'platform_admin') allowed.add('admin');
    const granted = options.grantedScopes === 'all' ? SCOPES : options.grantedScopes;
    const scopes = new Set(granted.filter((scope): scope is Scope => allowed.has(scope as Scope)));
    return {
      kind: 'user',
      userId: user.id,
      displayName: user.displayName,
      platformRole: user.platformRole,
      memberships,
      scopes,
      clientId: options.clientId,
      channel: options.channel,
    };
  }
}

export const describePrincipal = async (deps: ApplicationDeps, ctx: RequestContext) => {
  const principal = requireUser(ctx.principal);
  const organizations = await deps.repos.organizations.findManyByIds(
    principal.memberships.map((m) => m.organizationId),
  );
  const byId = new Map(organizations.map((org) => [org.id, org]));
  return {
    user: { id: principal.userId, displayName: principal.displayName, platformRole: principal.platformRole },
    memberships: principal.memberships.flatMap((membership) => {
      const org = byId.get(membership.organizationId);
      return org
        ? [
            {
              organizationId: org.id,
              organizationName: org.name,
              organizationSlug: org.slug,
              organizationKind: org.kind,
              role: membership.role,
            },
          ]
        : [];
    }),
    scopes: [...principal.scopes].sort(),
  };
};

// A well-formed hash of a random password, used to equalize timing for unknown users.
const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
