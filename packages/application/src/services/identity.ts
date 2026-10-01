import {
  type Channel,
  type User,
  type UserId,
  newId,
  sanitizeUntrustedText,
  unauthenticated,
  validationError,
} from '@atx/domain';
import type { ApplicationDeps } from '../deps';
import { requireUser } from '../policies';
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

  async register(input: {
    readonly email: string;
    readonly password: string;
    readonly displayName: string;
  }): Promise<User> {
    const email = input.email.trim().toLowerCase();
    if (!EMAIL.test(email)) throw validationError('Invalid email address');
    if (input.password.length < 12 || input.password.length > 200)
      throw validationError('Password must be 12-200 characters');
    if (await this.deps.repos.users.findCredentialByEmail(email))
      throw validationError('Registration failed');
    const user: User = {
      id: newId(),
      email,
      displayName: sanitizeUntrustedText(input.displayName, 120) || email,
      platformRole: 'none',
      createdAt: this.deps.clock.now(),
    };
    await this.deps.repos.users.insert(user, await this.passwords.hash(input.password));
    return user;
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
