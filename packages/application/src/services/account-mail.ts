import { USER_TOKEN_TTL_MINUTES, type User, type UserToken, type UserTokenPurpose, newId } from '@atx/domain';
import type { ApplicationDeps } from '../deps';
import type { OutgoingEmail } from '../ports/services';
import { generateSecretToken, hashSecretToken } from './support';

/**
 * Account emails that carry a secret link. They are sent directly after the
 * database commit (never through the job queue) so raw tokens are never
 * persisted; only hashes are stored. Delivery is best effort: the caller
 * learns whether it worked and users can always ask again.
 */
export const deliver = async (deps: ApplicationDeps, message: OutgoingEmail): Promise<boolean> => {
  try {
    await deps.mailer.send(message);
    deps.telemetry.increment('atx.mail.sent', { outcome: 'success' });
    return true;
  } catch {
    // Never log message contents: they contain secret links.
    deps.telemetry.increment('atx.mail.sent', { outcome: 'failure' });
    return false;
  }
};

/**
 * User-controlled names (display names, organization names) appear in emails we
 * send to third parties; strip anything link-like so they cannot carry phishing URLs.
 */
export const plainName = (name: string): string =>
  name
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, '')
    .replace(/\bwww\.\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || 'A colleague';

export const webLink = (deps: ApplicationDeps, pathname: string, token: string): string => {
  const url = new URL(pathname, deps.settings.publicWebUrl);
  url.searchParams.set('token', token);
  return url.toString();
};

export const issueUserToken = async (
  deps: ApplicationDeps,
  user: Pick<User, 'id'>,
  purpose: UserTokenPurpose,
): Promise<string> => {
  const now = deps.clock.now();
  const token = generateSecretToken();
  const record: UserToken = {
    id: newId(),
    userId: user.id,
    purpose,
    tokenHash: hashSecretToken(token),
    expiresAt: new Date(now.getTime() + USER_TOKEN_TTL_MINUTES[purpose] * 60_000),
    usedAt: null,
    createdAt: now,
  };
  await deps.repos.userTokens.insert(record);
  return token;
};

export const sendEmailVerification = async (
  deps: ApplicationDeps,
  user: Pick<User, 'id' | 'email' | 'displayName'>,
): Promise<boolean> => {
  const token = await issueUserToken(deps, user, 'email_verification');
  return deliver(deps, {
    to: user.email,
    subject: 'Confirm your email address — Automotive Technology Exchange',
    text: [
      `Hello ${plainName(user.displayName)},`,
      '',
      'Please confirm your email address by opening this link (valid for 3 days):',
      webLink(deps, '/verify-email', token),
      '',
      'If you did not create an account, you can ignore this message.',
    ].join('\n'),
  });
};
