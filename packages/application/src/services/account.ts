import {
  AppError,
  forbidden,
  isUserTokenUsable,
  normalizeEmail,
  notFound,
  validationError,
  type UserId,
} from '@atx/domain';
import type { ApplicationDeps } from '../deps';
import { requireUser } from '../policies';
import type { RequestContext } from '../principal';
import { deliver, issueUserToken, plainName, sendEmailVerification, webLink } from './account-mail';
import type { PasswordHasher } from './identity';
import { hashSecretToken, recordAudit } from './support';

/** At most this many reset emails per account and hour (mail-bombing protection). */
const MAX_RESETS_PER_HOUR = 3;
const MAX_VERIFICATIONS_PER_HOUR = 5;

const invalidLink = () =>
  new AppError('VALIDATION_FAILED', 'This link is invalid, expired or was already used. Request a new one.');

/**
 * Account self-service: email ownership, password reset and session
 * revocation. Responses never reveal whether an email address is registered.
 */
export class AccountService {
  constructor(
    private readonly deps: ApplicationDeps,
    private readonly passwords: PasswordHasher,
  ) {}

  /** Sends a new verification link to the signed-in user (no-op if already verified). */
  async resendEmailVerification(ctx: RequestContext): Promise<{ readonly sent: boolean }> {
    const principal = requireUser(ctx.principal);
    if (principal.emailVerified) return { sent: false };
    const user = await this.deps.repos.users.findById(principal.userId);
    if (!user) return { sent: false };
    const since = new Date(this.deps.clock.now().getTime() - 3_600_000);
    const recent = await this.deps.repos.userTokens.countCreatedSince(user.id, 'email_verification', since);
    if (recent >= MAX_VERIFICATIONS_PER_HOUR)
      throw new AppError('RATE_LIMITED', 'Too many verification emails; try again later');
    return { sent: await sendEmailVerification(this.deps, user) };
  }

  async confirmEmail(ctx: RequestContext, token: string): Promise<void> {
    const now = this.deps.clock.now();
    await this.deps.transaction(async (repos) => {
      const record = await repos.userTokens.findByTokenHash(hashSecretToken(token));
      if (!record || !isUserTokenUsable(record, 'email_verification', now)) throw invalidLink();
      if (!(await repos.userTokens.markUsed(record.id, now))) throw invalidLink();
      await repos.users.markEmailVerified(record.userId, now);
      await recordAudit(repos.audit, ctx, now, {
        action: 'user.email.verify',
        resourceType: 'user',
        resourceId: record.userId,
        organizationId: null,
      });
    });
  }

  /**
   * Always succeeds from the caller's point of view (no account enumeration).
   * A reset link is mailed only to registered addresses, within a rate limit.
   */
  async requestPasswordReset(ctx: RequestContext, rawEmail: string): Promise<void> {
    const credential = await this.deps.repos.users.findCredentialByEmail(normalizeEmail(rawEmail));
    if (!credential) return;
    const user = credential.user;
    const since = new Date(this.deps.clock.now().getTime() - 3_600_000);
    if (
      (await this.deps.repos.userTokens.countCreatedSince(user.id, 'password_reset', since)) >=
      MAX_RESETS_PER_HOUR
    )
      return;
    const token = await issueUserToken(this.deps, user, 'password_reset');
    await recordAudit(this.deps.repos.audit, ctx, this.deps.clock.now(), {
      action: 'user.password_reset.request',
      resourceType: 'user',
      resourceId: user.id,
      organizationId: null,
    });
    await deliver(this.deps, {
      to: user.email,
      subject: 'Reset your password — Automotive Technology Exchange',
      text: [
        `Hello ${plainName(user.displayName)},`,
        '',
        'Someone (hopefully you) asked to reset the password of your account. Open this link within one hour:',
        webLink(this.deps, '/reset-password', token),
        '',
        'If you did not ask for this, ignore this message; your password stays unchanged.',
      ].join('\n'),
    });
  }

  /** Sets a new password and signs the user out of every session and agent token. */
  async resetPassword(ctx: RequestContext, token: string, newPassword: string): Promise<void> {
    if (newPassword.length < 12 || newPassword.length > 200)
      throw validationError('Password must be 12-200 characters');
    const passwordHash = await this.passwords.hash(newPassword);
    const now = this.deps.clock.now();
    await this.deps.transaction(async (repos) => {
      const record = await repos.userTokens.findByTokenHash(hashSecretToken(token));
      if (!record || !isUserTokenUsable(record, 'password_reset', now)) throw invalidLink();
      if (!(await repos.userTokens.markUsed(record.id, now))) throw invalidLink();
      await repos.userTokens.invalidateAll(record.userId, 'password_reset', now);
      await repos.users.updatePassword(record.userId, passwordHash, now);
      // Refresh tokens would otherwise keep minting new access tokens for connected apps.
      await repos.accessGrants.revokeAllForUser(record.userId, now);
      // Receiving the reset link proves ownership of the address.
      await repos.users.markEmailVerified(record.userId, now);
      await recordAudit(repos.audit, ctx, now, {
        action: 'user.password_reset.complete',
        resourceType: 'user',
        resourceId: record.userId,
        organizationId: null,
      });
    });
  }

  /**
   * Invalidates every session, agent token and connected app (OAuth grant)
   * of the signed-in user.
   */
  async signOutEverywhere(ctx: RequestContext): Promise<void> {
    const principal = requireUser(ctx.principal);
    await this.revokeAllAccess(ctx, principal.userId, 'user.sessions.revoke_all');
  }

  /**
   * Operator incident response (CLI only): cuts off a possibly compromised
   * account the same way as "sign out everywhere". The password is left
   * unchanged; the owner recovers through the password-reset email.
   */
  async revokeAccessAsOperator(
    ctx: RequestContext,
    rawEmail: string,
  ): Promise<{ readonly userId: UserId; readonly revokedGrants: number }> {
    if (ctx.principal.kind !== 'system') throw forbidden("Only operators can revoke another user's access");
    const found = await this.deps.repos.users.findCredentialByEmail(normalizeEmail(rawEmail));
    if (!found) throw notFound('Account');
    const revokedGrants = await this.revokeAllAccess(ctx, found.user.id, 'user.access.revoke_by_operator');
    return { userId: found.user.id, revokedGrants };
  }

  private async revokeAllAccess(ctx: RequestContext, userId: UserId, action: string): Promise<number> {
    const now = this.deps.clock.now();
    let revokedGrants = 0;
    await this.deps.transaction(async (repos) => {
      await repos.users.revokeAllTokens(userId, now);
      revokedGrants = await repos.accessGrants.revokeAllForUser(userId, now);
      await recordAudit(repos.audit, ctx, now, {
        action,
        resourceType: 'user',
        resourceId: userId,
        organizationId: null,
        metadata: { revokedGrants },
      });
    });
    return revokedGrants;
  }
}
