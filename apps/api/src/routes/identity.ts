import {
  AgentTokenRecord,
  AgentTokenRequest,
  IssuedAgentToken,
  InvitationPreview,
  LoginRequest,
  Me,
  PasswordResetConfirm,
  PasswordResetRequest,
  RegisterRequest,
  RegistrationPolicy,
  SecretTokenBody,
  TokenResponse,
  Uuid,
} from '@atx/contracts';
import type { Runtime } from '@atx/runtime';
import { z } from 'zod';
import { type AnyRouteSpec, defineRoute } from '../http/route';

/**
 * Built-in identity endpoints (development and small deployments). Larger
 * deployments federate to an external OIDC provider; see ADR-0004.
 */
export const identityRoutes = (runtime: Runtime): AnyRouteSpec[] => {
  const { app, tokens, env } = runtime;
  const AUTH_RATE_LIMIT = { max: env.AUTH_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' } as const;
  const issueSession = async (user: Parameters<typeof app.identity.issueSession>[0]) => ({
    ...(await app.identity.issueSession(user)),
    tokenType: 'Bearer' as const,
  });
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
      handler: async ({ body, ctx }) => issueSession(await app.identity.register(ctx, body)),
    }),
    defineRoute({
      method: 'POST',
      url: '/v1/auth/email-verification/resend',
      operationId: 'resendEmailVerification',
      summary: 'Send a new email-verification link to the signed-in user',
      tags: ['auth'],
      auth: 'required',
      response: z.object({ sent: z.boolean() }),
      rateLimit: AUTH_RATE_LIMIT,
      handler: async ({ ctx }) => app.account.resendEmailVerification(ctx),
    }),
    defineRoute({
      method: 'POST',
      url: '/v1/auth/email-verification/confirm',
      operationId: 'confirmEmail',
      summary: 'Confirm email ownership with the token from the verification link',
      tags: ['auth'],
      auth: 'none',
      body: SecretTokenBody,
      response: z.object({ verified: z.literal(true) }),
      rateLimit: AUTH_RATE_LIMIT,
      handler: async ({ body, ctx }) => {
        await app.account.confirmEmail(ctx, body.token);
        return { verified: true as const };
      },
    }),
    defineRoute({
      method: 'POST',
      url: '/v1/auth/password-reset/request',
      operationId: 'requestPasswordReset',
      summary: 'Email a password-reset link if the address is registered (the response never says)',
      tags: ['auth'],
      auth: 'none',
      body: PasswordResetRequest,
      response: z.object({ accepted: z.literal(true) }),
      status: 202,
      rateLimit: AUTH_RATE_LIMIT,
      handler: async ({ body, ctx }) => {
        await app.account.requestPasswordReset(ctx, body.email);
        return { accepted: true as const };
      },
    }),
    defineRoute({
      method: 'POST',
      url: '/v1/auth/password-reset/confirm',
      operationId: 'resetPassword',
      summary: 'Set a new password with the token from the reset link; ends all sessions and agent tokens',
      tags: ['auth'],
      auth: 'none',
      body: PasswordResetConfirm,
      response: z.object({ reset: z.literal(true) }),
      rateLimit: AUTH_RATE_LIMIT,
      handler: async ({ body, ctx }) => {
        await app.account.resetPassword(ctx, body.token, body.newPassword);
        return { reset: true as const };
      },
    }),
    defineRoute({
      method: 'POST',
      url: '/v1/auth/sign-out-everywhere',
      operationId: 'signOutEverywhere',
      summary: 'Invalidate all sessions and agent tokens of the signed-in user',
      tags: ['auth'],
      auth: 'required',
      response: z.object({ revoked: z.literal(true) }),
      handler: async ({ ctx }) => {
        await app.account.signOutEverywhere(ctx);
        return { revoked: true as const };
      },
    }),
    defineRoute({
      method: 'GET',
      url: '/v1/auth/registration',
      operationId: 'registrationPolicy',
      summary: 'Whether registration is open or invite-only, and the current terms version',
      tags: ['auth'],
      auth: 'none',
      response: RegistrationPolicy,
      handler: async () => ({ mode: env.REGISTRATION_MODE, termsVersion: env.TERMS_VERSION }),
    }),
    defineRoute({
      method: 'POST',
      url: '/v1/invitations/lookup',
      operationId: 'lookupInvitation',
      summary:
        'Describe a pending invitation (token in the body, never in the URL, so it stays out of access logs)',
      tags: ['auth'],
      auth: 'none',
      body: SecretTokenBody,
      response: InvitationPreview,
      rateLimit: AUTH_RATE_LIMIT,
      handler: async ({ body }) => app.invitations.describe(body.token),
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
      handler: async ({ body }) => issueSession(await app.identity.authenticate(body.email, body.password)),
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
      summary:
        'Create a revocable token (1-90 days) for an AI agent host to call the MCP server on your behalf',
      tags: ['auth'],
      auth: 'required',
      body: AgentTokenRequest,
      response: IssuedAgentToken,
      status: 201,
      rateLimit: AUTH_RATE_LIMIT,
      handler: async ({ body, ctx }) => {
        const { token, grant } = await app.agentTokens.issue(ctx, body);
        return { accessToken: token, tokenType: 'Bearer' as const, audience: env.MCP_PUBLIC_URL, grant };
      },
    }),
    defineRoute({
      method: 'GET',
      url: '/v1/auth/agent-tokens',
      operationId: 'listAgentTokens',
      summary: 'Your agent tokens (never the token values)',
      tags: ['auth'],
      auth: 'required',
      response: z.object({ items: z.array(AgentTokenRecord) }),
      handler: async ({ ctx }) => ({ items: await app.agentTokens.list(ctx) }),
    }),
    defineRoute({
      method: 'POST',
      url: '/v1/auth/agent-tokens/:grantId/revoke',
      operationId: 'revokeAgentToken',
      summary: 'Revoke one agent token immediately',
      tags: ['auth'],
      auth: 'required',
      params: z.object({ grantId: Uuid }),
      response: z.object({ revoked: z.literal(true) }),
      handler: async ({ params, ctx }) => {
        await app.agentTokens.revoke(ctx, params.grantId);
        return { revoked: true as const };
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
