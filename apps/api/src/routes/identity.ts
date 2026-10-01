import { type Scope, requireUser } from '@atx/application';
import { AgentTokenRequest, LoginRequest, Me, RegisterRequest, TokenResponse } from '@atx/contracts';
import type { Runtime } from '@atx/runtime';
import { z } from 'zod';
import { type AnyRouteSpec, defineRoute } from '../http/route';

const SESSION_TTL_SECONDS = 8 * 3600;
const AUTH_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;

/**
 * Built-in identity endpoints (development and small deployments). Larger
 * deployments federate to an external OIDC provider; see ADR-0004.
 */
export const identityRoutes = (runtime: Runtime): AnyRouteSpec[] => {
  const { app, tokens, env } = runtime;
  const issueSession = async (userId: string) => {
    const principal = await app.identity.principalFor(userId as never, { channel: 'web', clientId: null, grantedScopes: 'all' });
    const scopes = [...principal.scopes].sort();
    const accessToken = await tokens.issuer.issue({ subject: userId, audience: env.API_PUBLIC_URL, scopes, ttlSeconds: SESSION_TTL_SECONDS });
    return { accessToken, tokenType: 'Bearer' as const, expiresIn: SESSION_TTL_SECONDS, audience: env.API_PUBLIC_URL, scopes };
  };
  return [
    defineRoute({
      method: 'POST',
      url: '/v1/auth/register',
      operationId: 'register',
      summary: 'Register a user account',
      tags: ['auth'],
      auth: 'none',
      body: RegisterRequest,
      response: TokenResponse,
      status: 201,
      rateLimit: AUTH_RATE_LIMIT,
      handler: async ({ body }) => issueSession((await app.identity.register(body)).id),
    }),
    defineRoute({
      method: 'POST',
      url: '/v1/auth/login',
      operationId: 'login',
      summary: 'Exchange credentials for a short-lived API access token',
      tags: ['auth'],
      auth: 'none',
      body: LoginRequest,
      response: TokenResponse,
      rateLimit: AUTH_RATE_LIMIT,
      handler: async ({ body }) => issueSession((await app.identity.authenticate(body.email, body.password)).id),
    }),
    defineRoute({
      method: 'GET',
      url: '/v1/me',
      operationId: 'me',
      summary: 'Current user, memberships and effective scopes',
      tags: ['auth'],
      auth: 'required',
      response: Me,
      handler: async ({ ctx }) => app.identity.profile(ctx),
    }),
    defineRoute({
      method: 'POST',
      url: '/v1/auth/agent-tokens',
      operationId: 'issueAgentToken',
      summary: 'Issue a scoped, short-lived token for an AI agent host to call the MCP server on your behalf',
      tags: ['auth'],
      auth: 'required',
      body: AgentTokenRequest,
      response: TokenResponse,
      rateLimit: AUTH_RATE_LIMIT,
      handler: async ({ body, ctx }) => {
        const user = requireUser(ctx.principal);
        // A token can never carry more than the issuing session already has.
        const scopes = body.scopes.filter((scope) => user.scopes.has(scope as Scope));
        const ttlSeconds = body.ttlHours * 3600;
        const accessToken = await tokens.issuer.issue({ subject: user.userId, audience: env.MCP_PUBLIC_URL, scopes, clientId: 'personal-agent-token', ttlSeconds });
        return { accessToken, tokenType: 'Bearer' as const, expiresIn: ttlSeconds, audience: env.MCP_PUBLIC_URL, scopes };
      },
    }),
    defineRoute({
      method: 'GET',
      url: '/.well-known/jwks.json',
      operationId: 'jwks',
      summary: 'Public keys for verifying access tokens issued by this deployment',
      tags: ['auth'],
      auth: 'none',
      response: z.object({ keys: z.array(z.record(z.string(), z.unknown())) }),
      handler: async () => tokens.issuer.jwks(),
    }),
  ];
};
