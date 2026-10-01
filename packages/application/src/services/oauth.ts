import { createHash, randomBytes } from 'node:crypto';
import {
  type AccessGrant,
  OAUTH_LIFETIMES,
  type OAuthClient,
  accessGrantStatus,
  canonicalResource,
  isAllowedRedirectUri,
  isValidCodeChallenge,
  isValidCodeVerifier,
  newId,
  redirectUriMatches,
  sanitizeUntrustedText,
} from '@atx/domain';
import type { ApplicationDeps } from '../deps';
import { requireUser } from '../policies';
import { type RequestContext, SCOPES, type Scope } from '../principal';
import { generateSecretToken, hashSecretToken, recordAudit } from './support';

/** Scopes an OAuth client may request (platform administration is never delegated). */
export const OAUTH_SCOPES: readonly Scope[] = SCOPES.filter((scope) => scope !== 'admin');
const DEFAULT_SCOPE: Scope = 'catalog:read';

export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'unsupported_response_type'
  | 'invalid_scope'
  | 'invalid_target'
  | 'invalid_client_metadata'
  | 'invalid_redirect_uri'
  | 'access_denied';

/**
 * Protocol error with an RFC 6749 error code. `redirectable` is false when
 * the client or redirect URI cannot be trusted: the error must then be shown
 * to the user instead of being sent to the redirect URI.
 */
export class OAuthFlowError extends Error {
  constructor(
    readonly error: OAuthErrorCode,
    readonly description: string,
    readonly redirectable = false,
  ) {
    super(description);
    this.name = 'OAuthFlowError';
  }
}

export interface AuthorizationRequest {
  readonly responseType: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: string;
  readonly scope: string | null;
  readonly state: string | null;
  readonly resource: string | null;
}

export interface TokenResponse {
  readonly access_token: string;
  readonly token_type: 'Bearer';
  readonly expires_in: number;
  readonly refresh_token: string;
  readonly scope: string;
}

const s256 = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url');

/**
 * Built-in OAuth 2.1 authorization server for MCP hosts (ADR-0017). Public
 * clients only (no client secrets), authorization code + PKCE S256, exact
 * redirect matching, resource indicators bound to the MCP server, rotating
 * refresh tokens with reuse detection. Every authorization is a revocable
 * access grant the user can see.
 */
export class OAuthService {
  constructor(private readonly deps: ApplicationDeps) {}

  /** RFC 8414 authorization server metadata. */
  metadata() {
    const issuer = this.deps.settings.oauthIssuer;
    const endpoint = (path: string) => new URL(path, issuer).toString();
    return {
      issuer,
      authorization_endpoint: new URL('/oauth/authorize', this.deps.settings.publicWebUrl).toString(),
      token_endpoint: endpoint('/oauth/token'),
      registration_endpoint: endpoint('/oauth/register'),
      revocation_endpoint: endpoint('/oauth/revoke'),
      scopes_supported: [...OAUTH_SCOPES],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      authorization_response_iss_parameter_supported: true,
      service_documentation: new URL('/docs/mcp', this.deps.settings.publicWebUrl).toString(),
    };
  }

  /** RFC 7591 dynamic client registration (public clients only). */
  async registerClient(metadata: Record<string, unknown>) {
    const redirectUris = metadata['redirect_uris'];
    if (
      !Array.isArray(redirectUris) ||
      redirectUris.length === 0 ||
      redirectUris.length > 10 ||
      !redirectUris.every((uri) => typeof uri === 'string' && isAllowedRedirectUri(uri))
    )
      throw new OAuthFlowError(
        'invalid_redirect_uri',
        'redirect_uris must be 1-10 https, loopback or app URIs',
      );
    const authMethod = metadata['token_endpoint_auth_method'] ?? 'none';
    if (authMethod !== 'none')
      throw new OAuthFlowError(
        'invalid_client_metadata',
        'Only public clients (token_endpoint_auth_method "none") are supported',
      );
    const grantTypes = (metadata['grant_types'] as unknown[] | undefined) ?? [
      'authorization_code',
      'refresh_token',
    ];
    if (
      !Array.isArray(grantTypes) ||
      grantTypes.some((g) => g !== 'authorization_code' && g !== 'refresh_token')
    )
      throw new OAuthFlowError(
        'invalid_client_metadata',
        'Supported grant types: authorization_code, refresh_token',
      );
    const responseTypes = (metadata['response_types'] as unknown[] | undefined) ?? ['code'];
    if (!Array.isArray(responseTypes) || responseTypes.some((r) => r !== 'code'))
      throw new OAuthFlowError('invalid_client_metadata', 'Supported response type: code');
    const clientUri = typeof metadata['client_uri'] === 'string' ? metadata['client_uri'] : null;
    const client: OAuthClient = {
      clientId: `atx-${randomBytes(18).toString('base64url')}`,
      // Client names are self-asserted and shown on the consent screen as such.
      clientName:
        sanitizeUntrustedText(
          typeof metadata['client_name'] === 'string' ? metadata['client_name'] : '',
          100,
        ) || 'Unnamed application',
      redirectUris: redirectUris as string[],
      clientUri: clientUri && clientUri.startsWith('https://') ? clientUri.slice(0, 500) : null,
      createdAt: this.deps.clock.now(),
    };
    await this.deps.repos.oauth.insertClient(client);
    return {
      client_id: client.clientId,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      ...(client.clientUri ? { client_uri: client.clientUri } : {}),
    };
  }

  /** Validates an authorization request for the consent screen. */
  async describeAuthorization(request: AuthorizationRequest) {
    const { client, scopes, resource } = await this.validateAuthorization(request);
    return {
      clientName: client.clientName,
      clientUri: client.clientUri,
      redirectOrigin: new URL(request.redirectUri).origin,
      scopes,
      resource,
    };
  }

  /**
   * The signed-in user approves or denies. Returns where to send the browser:
   * the client's redirect URI with a single-use code (or an error), plus
   * `state` and `iss` (RFC 9207 mix-up defence).
   */
  async decide(
    ctx: RequestContext,
    request: AuthorizationRequest,
    approve: boolean,
  ): Promise<{ redirectTo: string }> {
    const user = requireUser(ctx.principal);
    // Consent only from a first-party session: an agent can never approve its own access.
    if (user.clientId !== null)
      throw new OAuthFlowError('access_denied', 'Consent must be given on the ATX website');
    const { client, scopes, resource } = await this.validateAuthorization(request);
    const target = new URL(request.redirectUri);
    if (request.state) target.searchParams.set('state', request.state);
    target.searchParams.set('iss', this.deps.settings.oauthIssuer);
    if (!approve) {
      target.searchParams.set('error', 'access_denied');
      return { redirectTo: target.toString() };
    }
    // Never grant more than the user currently has.
    const granted = scopes.filter((scope) => user.scopes.has(scope));
    if (granted.length === 0)
      throw new OAuthFlowError('invalid_scope', 'You do not have any of the requested permissions', true);
    const now = this.deps.clock.now();
    const grant: AccessGrant = {
      id: newId(),
      userId: user.userId,
      kind: 'oauth',
      label: client.clientName,
      clientId: client.clientId,
      scopes: granted,
      createdAt: now,
      expiresAt: new Date(now.getTime() + OAUTH_LIFETIMES.grantDays * 86_400_000),
      lastUsedAt: null,
      revokedAt: null,
    };
    const code = generateSecretToken();
    await this.deps.transaction(async (repos) => {
      await repos.accessGrants.insert(grant);
      await repos.oauth.insertCode({
        codeHash: hashSecretToken(code),
        clientId: client.clientId,
        userId: user.userId,
        grantId: grant.id,
        redirectUri: request.redirectUri,
        codeChallenge: request.codeChallenge,
        scopes: granted,
        resource,
        expiresAt: new Date(now.getTime() + OAUTH_LIFETIMES.authorizationCodeSeconds * 1000),
        usedAt: null,
        createdAt: now,
      });
      await recordAudit(repos.audit, ctx, now, {
        action: 'oauth.authorize',
        resourceType: 'access_grant',
        resourceId: grant.id,
        organizationId: null,
        metadata: { clientId: client.clientId, scopes: granted.join(' ') },
      });
    });
    target.searchParams.set('code', code);
    return { redirectTo: target.toString() };
  }

  /** Token endpoint (authorization_code and refresh_token grants). */
  async token(params: Readonly<Record<string, string | undefined>>): Promise<TokenResponse> {
    const clientId = params['client_id'];
    if (!clientId) throw new OAuthFlowError('invalid_client', 'client_id is required');
    const client = await this.deps.repos.oauth.findClient(clientId);
    if (!client) throw new OAuthFlowError('invalid_client', 'Unknown client');
    switch (params['grant_type']) {
      case 'authorization_code':
        return this.exchangeCode(client, params);
      case 'refresh_token':
        return this.refresh(client, params);
      default:
        throw new OAuthFlowError('unsupported_grant_type', 'Supported: authorization_code, refresh_token');
    }
  }

  /** RFC 7009: revoking a refresh token revokes the whole grant. Unknown tokens are ignored. */
  async revoke(params: Readonly<Record<string, string | undefined>>): Promise<void> {
    const token = params['token'];
    if (!token) throw new OAuthFlowError('invalid_request', 'token is required');
    const stored = await this.deps.repos.oauth.findRefreshToken(hashSecretToken(token));
    if (stored && stored.clientId === params['client_id'])
      await this.deps.repos.accessGrants.revokeById(stored.grantId, this.deps.clock.now());
  }

  /** Applications the user connected via OAuth (shown on the account page). */
  async listConnections(ctx: RequestContext) {
    const user = requireUser(ctx.principal);
    const now = this.deps.clock.now();
    return (await this.deps.repos.accessGrants.listForUser(user.userId, 'oauth')).map((grant) => ({
      id: grant.id,
      clientName: grant.label,
      scopes: grant.scopes,
      status: accessGrantStatus(grant, now),
      createdAt: grant.createdAt.toISOString(),
      lastUsedAt: grant.lastUsedAt?.toISOString() ?? null,
    }));
  }

  // ------------------------------------------------------------- internals

  private async validateAuthorization(request: AuthorizationRequest) {
    const client = request.clientId ? await this.deps.repos.oauth.findClient(request.clientId) : null;
    if (!client) throw new OAuthFlowError('invalid_client', 'Unknown application (client_id)');
    if (!client.redirectUris.some((registered) => redirectUriMatches(registered, request.redirectUri)))
      throw new OAuthFlowError('invalid_redirect_uri', 'redirect_uri is not registered for this application');
    // From here on, errors can be returned to the (verified) redirect URI.
    if (request.responseType !== 'code')
      throw new OAuthFlowError('unsupported_response_type', 'Only response_type=code is supported', true);
    if (request.codeChallengeMethod !== 'S256' || !isValidCodeChallenge(request.codeChallenge))
      throw new OAuthFlowError('invalid_request', 'PKCE with code_challenge_method=S256 is required', true);
    const expected =
      canonicalResource(this.deps.settings.mcpResourceUrl) ?? this.deps.settings.mcpResourceUrl;
    const resource = request.resource ? canonicalResource(request.resource) : expected;
    if (resource !== expected)
      throw new OAuthFlowError('invalid_target', 'Tokens can only be issued for this MCP server', true);
    const requested = (request.scope ?? DEFAULT_SCOPE).split(/\s+/).filter(Boolean);
    const scopes = [...new Set(requested)].filter((scope): scope is Scope =>
      OAUTH_SCOPES.includes(scope as Scope),
    );
    if (scopes.length === 0) throw new OAuthFlowError('invalid_scope', 'No supported scope requested', true);
    return { client, scopes, resource };
  }

  private async exchangeCode(
    client: OAuthClient,
    params: Readonly<Record<string, string | undefined>>,
  ): Promise<TokenResponse> {
    const code = params['code'];
    const verifier = params['code_verifier'] ?? '';
    if (!code || !params['redirect_uri'])
      throw new OAuthFlowError('invalid_request', 'code and redirect_uri are required');
    const stored = await this.deps.repos.oauth.findCode(hashSecretToken(code));
    const now = this.deps.clock.now();
    if (!stored || stored.clientId !== client.clientId)
      throw new OAuthFlowError('invalid_grant', 'Invalid authorization code');
    if (stored.usedAt) {
      // Replay of a used code: revoke everything issued from it (OAuth 2.1 §4.1.3).
      await this.deps.repos.accessGrants.revokeById(stored.grantId, now);
      throw new OAuthFlowError('invalid_grant', 'Authorization code was already used');
    }
    if (stored.expiresAt.getTime() <= now.getTime())
      throw new OAuthFlowError('invalid_grant', 'Authorization code expired');
    if (stored.redirectUri !== params['redirect_uri'])
      throw new OAuthFlowError('invalid_grant', 'redirect_uri does not match the authorization request');
    if (!isValidCodeVerifier(verifier) || s256(verifier) !== stored.codeChallenge)
      throw new OAuthFlowError('invalid_grant', 'PKCE verification failed');
    if (params['resource'] && canonicalResource(params['resource']) !== stored.resource)
      throw new OAuthFlowError('invalid_target', 'resource does not match the authorization request');
    if (!(await this.deps.repos.oauth.markCodeUsed(stored.codeHash, now)))
      throw new OAuthFlowError('invalid_grant', 'Authorization code was already used');
    const grant = await this.activeGrant(stored.grantId);
    return this.issueTokens(client, grant, stored.scopes);
  }

  private async refresh(
    client: OAuthClient,
    params: Readonly<Record<string, string | undefined>>,
  ): Promise<TokenResponse> {
    const token = params['refresh_token'];
    if (!token) throw new OAuthFlowError('invalid_request', 'refresh_token is required');
    const stored = await this.deps.repos.oauth.findRefreshToken(hashSecretToken(token));
    const now = this.deps.clock.now();
    if (!stored || stored.clientId !== client.clientId)
      throw new OAuthFlowError('invalid_grant', 'Invalid refresh token');
    if (stored.usedAt || !(await this.deps.repos.oauth.markRefreshTokenUsed(stored.tokenHash, now))) {
      // A rotated token presented again: assume theft and revoke the grant (OAuth 2.1 §4.3.1).
      await this.deps.repos.accessGrants.revokeById(stored.grantId, now);
      throw new OAuthFlowError(
        'invalid_grant',
        'Refresh token was already used; the authorization has been revoked',
      );
    }
    if (stored.expiresAt.getTime() <= now.getTime())
      throw new OAuthFlowError('invalid_grant', 'Refresh token expired');
    const requested = params['scope']?.split(/\s+/).filter(Boolean);
    if (requested && requested.some((scope) => !stored.scopes.includes(scope)))
      throw new OAuthFlowError('invalid_scope', 'A refresh cannot add scopes');
    const grant = await this.activeGrant(stored.grantId);
    return this.issueTokens(client, grant, requested ?? stored.scopes);
  }

  private async activeGrant(grantId: AccessGrant['id']): Promise<AccessGrant> {
    const grant = await this.deps.repos.accessGrants.findById(grantId);
    if (!grant || accessGrantStatus(grant, this.deps.clock.now()) !== 'active')
      throw new OAuthFlowError('invalid_grant', 'The authorization was revoked or has expired');
    return grant;
  }

  private async issueTokens(
    client: OAuthClient,
    grant: AccessGrant,
    scopes: readonly string[],
  ): Promise<TokenResponse> {
    const now = this.deps.clock.now();
    const refreshToken = generateSecretToken();
    const refreshExpiry = Math.min(
      now.getTime() + OAUTH_LIFETIMES.refreshTokenDays * 86_400_000,
      grant.expiresAt.getTime(),
    );
    await this.deps.repos.oauth.insertRefreshToken({
      tokenHash: hashSecretToken(refreshToken),
      grantId: grant.id,
      clientId: client.clientId,
      userId: grant.userId,
      scopes,
      expiresAt: new Date(refreshExpiry),
      usedAt: null,
      createdAt: now,
    });
    const accessToken = await this.deps.tokenSigner.sign({
      subject: grant.userId,
      audience: this.deps.settings.mcpResourceUrl,
      scopes,
      clientId: client.clientId,
      ttlSeconds: OAUTH_LIFETIMES.accessTokenSeconds,
      grantId: grant.id,
    });
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: OAUTH_LIFETIMES.accessTokenSeconds,
      refresh_token: refreshToken,
      scope: scopes.join(' '),
    };
  }
}
