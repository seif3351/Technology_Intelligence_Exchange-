import { randomUUID } from 'node:crypto';
import type { ConfirmationClaims, ConfirmationTokens } from '@atx/application';
import { AppError, asId } from '@atx/domain';
import { SignJWT, jwtVerify } from 'jose';

const AUDIENCE = 'atx:confirmation';

/**
 * HMAC-signed, short-lived tokens that bind a user, an action and the digest
 * of the exact payload the user reviewed. Replays of a confirmed action are
 * neutralized by the idempotency key on the resulting write.
 */
export const createConfirmationTokens = (secret: string, issuer: string): ConfirmationTokens => {
  if (secret.length < 32) throw new Error('CONFIRMATION_SECRET must be at least 32 characters');
  const key = new TextEncoder().encode(secret);
  return {
    async issue(claims, ttlSeconds) {
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      const token = await new SignJWT({ org: claims.organizationId, act: claims.action, dig: claims.digest })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer(issuer)
        .setAudience(AUDIENCE)
        .setSubject(claims.userId)
        .setJti(randomUUID())
        .setIssuedAt()
        .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
        .sign(key);
      return { token, expiresAt };
    },
    async verify(token): Promise<ConfirmationClaims> {
      try {
        const { payload } = await jwtVerify(token, key, { issuer, audience: AUDIENCE, algorithms: ['HS256'] });
        if (!payload.sub || typeof payload['org'] !== 'string' || typeof payload['act'] !== 'string' || typeof payload['dig'] !== 'string') {
          throw new Error('malformed');
        }
        return { userId: asId(payload.sub), organizationId: asId(payload['org']), action: payload['act'], digest: payload['dig'] };
      } catch {
        throw new AppError('CONFIRMATION_REQUIRED', 'Confirmation token is invalid or expired; prepare the action again');
      }
    },
  };
};
