import type { AccessGrantId, UserId } from './ids';

/**
 * Built-in OAuth 2.1 authorization server for MCP hosts (ADR-0017): public
 * clients registered dynamically (RFC 7591), authorization code + PKCE S256,
 * rotating refresh tokens bound to a revocable access grant.
 */
export const OAUTH_LIFETIMES = {
  authorizationCodeSeconds: 10 * 60,
  accessTokenSeconds: 60 * 60,
  refreshTokenDays: 30,
  grantDays: 90,
} as const;

export interface OAuthClient {
  readonly clientId: string;
  readonly clientName: string;
  readonly redirectUris: readonly string[];
  readonly clientUri: string | null;
  readonly createdAt: Date;
}

export interface OAuthAuthorizationCode {
  readonly codeHash: string;
  readonly clientId: string;
  readonly userId: UserId;
  readonly grantId: AccessGrantId;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly scopes: readonly string[];
  readonly resource: string;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
  readonly createdAt: Date;
}

export interface OAuthRefreshToken {
  readonly tokenHash: string;
  readonly grantId: AccessGrantId;
  readonly clientId: string;
  readonly userId: UserId;
  readonly scopes: readonly string[];
  readonly expiresAt: Date;
  /** Set when rotated; presenting a rotated token again signals theft (the grant is revoked). */
  readonly usedAt: Date | null;
  readonly createdAt: Date;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const FORBIDDEN_SCHEMES = new Set([
  'javascript:',
  'data:',
  'file:',
  'vbscript:',
  'about:',
  'blob:',
  'ftp:',
  'ws:',
  'wss:',
]);

/**
 * Redirect URI policy (OAuth 2.1, RFC 8252): https, http only on loopback
 * (native apps on an ephemeral port), or a private-use scheme of a native
 * app. No fragments, no credentials, no dangerous schemes.
 */
export const isAllowedRedirectUri = (raw: string): boolean => {
  if (raw.length > 2000) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (FORBIDDEN_SCHEMES.has(url.protocol)) return false;
  if (url.protocol === 'https:') return url.hostname.length > 0;
  if (url.protocol === 'http:') return LOOPBACK_HOSTS.has(url.hostname);
  // Private-use URI scheme for native apps (e.g. com.example.app:/callback, cursor://…).
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol);
};

/**
 * Exact string matching, except that loopback http redirects may use any
 * port (RFC 8252 §7.3), because native apps listen on ephemeral ports.
 */
export const redirectUriMatches = (registered: string, requested: string): boolean => {
  if (registered === requested) return true;
  try {
    const a = new URL(registered);
    const b = new URL(requested);
    return (
      a.protocol === 'http:' &&
      b.protocol === 'http:' &&
      LOOPBACK_HOSTS.has(a.hostname) &&
      a.hostname === b.hostname &&
      a.pathname === b.pathname &&
      a.search === b.search
    );
  } catch {
    return false;
  }
};

/** RFC 7636: verifier 43–128 unreserved characters; S256 challenge is 43 base64url characters. */
export const isValidCodeVerifier = (verifier: string): boolean => /^[A-Za-z0-9\-._~]{43,128}$/.test(verifier);
export const isValidCodeChallenge = (challenge: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(challenge);

/** Canonical form of a resource indicator (RFC 8707) for comparison: no fragment, no trailing slash. */
export const canonicalResource = (raw: string): string | null => {
  try {
    const url = new URL(raw);
    if (url.hash) return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
};
