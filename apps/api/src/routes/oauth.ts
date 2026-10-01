import { type Application, type AuthorizationRequest, OAuthFlowError } from '@atx/application';
import { OAuthAuthorizationPreview, OAuthAuthorizationRequest, OAuthConnection, Uuid } from '@atx/contracts';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { type AnyRouteSpec, defineRoute } from '../http/route';

const FormParams = z.record(z.string(), z.string());

/** RFC 6749 §5.2 error response; tokens and errors are never cached. */
const oauthError = (reply: FastifyReply, error: OAuthFlowError) => {
  const status = error.error === 'invalid_client' ? 401 : 400;
  return reply
    .status(status)
    .header('cache-control', 'no-store')
    .send({ error: error.error, error_description: error.description });
};

const toRequest = (body: z.infer<typeof OAuthAuthorizationRequest>): AuthorizationRequest => ({
  responseType: body.response_type,
  clientId: body.client_id,
  redirectUri: body.redirect_uri,
  codeChallenge: body.code_challenge,
  codeChallengeMethod: body.code_challenge_method,
  scope: body.scope ?? null,
  state: body.state ?? null,
  resource: body.resource ?? null,
});

/**
 * Built-in OAuth 2.1 authorization server endpoints for MCP hosts (ADR-0017).
 * Protocol logic lives in OAuthService; this adapter maps transport details
 * (form bodies, RFC 6749 error format, no-store headers).
 */
export const oauthRoutes = (
  app: Application,
  rateLimit: { max: number; timeWindow: string },
): AnyRouteSpec[] => [
  defineRoute({
    method: 'GET',
    url: '/.well-known/oauth-authorization-server',
    operationId: 'oauthAuthorizationServerMetadata',
    summary: 'RFC 8414 authorization server metadata',
    tags: ['oauth'],
    auth: 'none',
    response: z.record(z.string(), z.unknown()),
    handler: async () => app.oauth.metadata(),
  }),
  defineRoute({
    method: 'POST',
    url: '/oauth/register',
    operationId: 'oauthRegisterClient',
    summary: 'RFC 7591 dynamic client registration (public clients with PKCE)',
    tags: ['oauth'],
    auth: 'none',
    body: z.record(z.string(), z.unknown()),
    response: z.record(z.string(), z.unknown()),
    status: 201,
    rateLimit,
    handler: async ({ body, reply }) => {
      try {
        return await app.oauth.registerClient(body);
      } catch (error) {
        if (error instanceof OAuthFlowError) return oauthError(reply, error) as never;
        throw error;
      }
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/oauth/token',
    operationId: 'oauthToken',
    summary: 'Token endpoint: authorization_code (PKCE) and refresh_token grants (form-encoded)',
    tags: ['oauth'],
    auth: 'none',
    body: FormParams,
    response: z.object({
      access_token: z.string(),
      token_type: z.literal('Bearer'),
      expires_in: z.number(),
      refresh_token: z.string(),
      scope: z.string(),
    }),
    rateLimit,
    handler: async ({ body, reply }) => {
      reply.header('cache-control', 'no-store').header('pragma', 'no-cache');
      try {
        return await app.oauth.token(body);
      } catch (error) {
        if (error instanceof OAuthFlowError) return oauthError(reply, error) as never;
        throw error;
      }
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/oauth/revoke',
    operationId: 'oauthRevoke',
    summary: 'RFC 7009 token revocation (revokes the whole authorization)',
    tags: ['oauth'],
    auth: 'none',
    body: FormParams,
    response: z.object({}),
    rateLimit,
    handler: async ({ body, reply }) => {
      try {
        await app.oauth.revoke(body);
        return {};
      } catch (error) {
        if (error instanceof OAuthFlowError) return oauthError(reply, error) as never;
        throw error;
      }
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/v1/oauth/authorization/describe',
    operationId: 'oauthDescribeAuthorization',
    summary: 'Validate an authorization request for the consent screen',
    tags: ['oauth'],
    auth: 'none',
    body: OAuthAuthorizationRequest,
    response: OAuthAuthorizationPreview,
    handler: async ({ body, reply }) => {
      try {
        return await app.oauth.describeAuthorization(toRequest(body));
      } catch (error) {
        if (error instanceof OAuthFlowError) return oauthError(reply, error) as never;
        throw error;
      }
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/v1/oauth/authorization/decision',
    operationId: 'oauthDecideAuthorization',
    summary: 'The signed-in user approves or denies; returns the redirect for the browser',
    tags: ['oauth'],
    auth: 'required',
    body: OAuthAuthorizationRequest.extend({ approve: z.boolean() }),
    response: z.object({ redirectTo: z.string() }),
    handler: async ({ body, ctx, reply }) => {
      try {
        return await app.oauth.decide(ctx, toRequest(body), body.approve);
      } catch (error) {
        if (error instanceof OAuthFlowError) return oauthError(reply, error) as never;
        throw error;
      }
    },
  }),
  defineRoute({
    method: 'GET',
    url: '/v1/oauth/connections',
    operationId: 'listOAuthConnections',
    summary: 'Applications you connected through OAuth',
    tags: ['oauth'],
    auth: 'required',
    response: z.object({ items: z.array(OAuthConnection) }),
    handler: async ({ ctx }) => ({ items: await app.oauth.listConnections(ctx) }),
  }),
  defineRoute({
    method: 'POST',
    url: '/v1/oauth/connections/:grantId/revoke',
    operationId: 'revokeOAuthConnection',
    summary: 'Disconnect an application (revokes its tokens immediately)',
    tags: ['oauth'],
    auth: 'required',
    params: z.object({ grantId: Uuid }),
    response: z.object({ revoked: z.literal(true) }),
    handler: async ({ params, ctx }) => {
      await app.agentTokens.revoke(ctx, params.grantId);
      return { revoked: true as const };
    },
  }),
];
