import { randomUUID } from 'node:crypto';
import {
  type JWTVerifyGetKey,
  SignJWT,
  createLocalJWKSet,
  createRemoteJWKSet,
  errors,
  jwtVerify,
} from 'jose';
import { ACCESS_TOKEN_ALG, type SigningKey } from './keys';

export interface AccessTokenClaims {
  readonly subject: string;
  readonly audience: string;
  readonly scopes: readonly string[];
  readonly clientId: string | null;
  readonly expiresAt: number;
  /** Issue time in milliseconds (`iat_ms` when present, else `iat` × 1000); tokens older than a credential change are rejected. */
  readonly issuedAtMs: number;
  /** Persisted grant (agent token / OAuth grant) the token belongs to, if any. */
  readonly grantId: string | null;
}

export class InvalidTokenError extends Error {
  constructor(message = 'Invalid access token') {
    super(message);
    this.name = 'InvalidTokenError';
  }
}

/** Upper bound for any token: revocable agent-token grants may live up to 90 days. */
const MAX_TTL_SECONDS = 90 * 24 * 3600;

/** Issues short-lived JWT access tokens bound to one audience (RFC 8707 resource). */
export const createAccessTokenIssuer = (key: SigningKey, issuer: string) => ({
  async issue(input: {
    readonly subject: string;
    readonly audience: string;
    readonly scopes: readonly string[];
    readonly clientId?: string | null;
    readonly ttlSeconds: number;
    readonly grantId?: string | null;
  }): Promise<string> {
    return new SignJWT({
      scope: input.scopes.join(' '),
      // Millisecond issue time: `iat` (seconds) is too coarse to order tokens against a password reset.
      iat_ms: Date.now(),
      ...(input.clientId ? { client_id: input.clientId } : {}),
      ...(input.grantId ? { grant: input.grantId } : {}),
    })
      .setProtectedHeader({ alg: ACCESS_TOKEN_ALG, kid: key.kid, typ: 'at+jwt' })
      .setIssuer(issuer)
      .setSubject(input.subject)
      .setAudience(input.audience)
      .setIssuedAt()
      .setJti(randomUUID())
      .setExpirationTime(`${Math.max(60, Math.min(input.ttlSeconds, MAX_TTL_SECONDS))}s`)
      .sign(key.privateKey);
  },
  jwks: () => ({ keys: [key.publicJwk] }),
});

export type AccessTokenIssuer = ReturnType<typeof createAccessTokenIssuer>;

/**
 * Verifies access tokens: signature (algorithm allow-list), issuer, audience
 * and expiry. Tokens for any other audience are rejected — the server never
 * accepts or forwards tokens minted for other resources (no token passthrough).
 */
export const createAccessTokenVerifier = (options: {
  readonly issuer: string;
  readonly audience: string;
  readonly jwks: { readonly keys: readonly object[] } | URL;
}) => {
  const keySet: JWTVerifyGetKey =
    options.jwks instanceof URL
      ? createRemoteJWKSet(options.jwks, { cooldownDuration: 30_000, timeoutDuration: 5_000 })
      : createLocalJWKSet({ keys: [...options.jwks.keys] as never });
  return {
    async verify(token: string): Promise<AccessTokenClaims> {
      try {
        const { payload } = await jwtVerify(token, keySet, {
          issuer: options.issuer,
          audience: options.audience,
          algorithms: [ACCESS_TOKEN_ALG],
          typ: 'at+jwt',
          clockTolerance: 30,
        });
        if (!payload.sub || typeof payload.exp !== 'number' || typeof payload.iat !== 'number')
          throw new InvalidTokenError();
        return {
          subject: payload.sub,
          audience: options.audience,
          scopes: typeof payload['scope'] === 'string' ? payload['scope'].split(' ').filter(Boolean) : [],
          clientId: typeof payload['client_id'] === 'string' ? payload['client_id'] : null,
          expiresAt: payload.exp,
          issuedAtMs: typeof payload['iat_ms'] === 'number' ? payload['iat_ms'] : payload.iat * 1000,
          grantId: typeof payload['grant'] === 'string' ? payload['grant'] : null,
        };
      } catch (error) {
        if (error instanceof InvalidTokenError) throw error;
        if (error instanceof errors.JOSEError)
          throw new InvalidTokenError(
            error.code === 'ERR_JWT_EXPIRED' ? 'Access token expired' : 'Invalid access token',
          );
        throw error;
      }
    },
  };
};

export type AccessTokenVerifier = ReturnType<typeof createAccessTokenVerifier>;
