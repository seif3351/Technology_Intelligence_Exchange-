import { SCOPES, type Scope, requireUser } from '@atx/application';
import {
  AgentTokenRequest,
  InvitationLookup,
  InvitationPreview,
  LoginRequest,
  Me,
  PasswordResetConfirm,
  PasswordResetRequest,
  RegisterRequest,
  RegistrationPolicy,
  SecretTokenBody,
  TokenResponse,
} from '@atx/contracts';
import type { Runtime } from '@atx/runtime';
import { z } from 'zod';
import { type AnyRouteSpec, defineRoute } from '../http/route';

const SESSION_TTL_SECONDS = 8 * 3600;

/**
 * Built-in identity endpoints (development and small deployments). Larger
 * deployments federate to an external OIDC provider; see ADR-0004.
 */
export const identityRoutes = (runtime: Runtime): AnyRouteSpec[] => {
  const { app, tokens, env } = runtime;
  const AUTH_RATE_LIMIT = { max: env.AUTH_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' } as const;
  /**
   * First-party sessions carry the full scope ceiling; effective permissions
   * are derived per request from current memberships and roles (so creating
   * an organization does not require a new login). Agent tokens, below, are
   * narrowly scoped instead.
   */
  const issueSession = async (userId: string) => {
    const scopes = [...SCOPES];
    const accessToken = await tokens.issuer.issue({
      subject: userId,
      audience: env.API_PUBLIC_URL,
      scopes,
      ttlSeconds: SESSION_TTL_SECONDS,
    });
    return {
      accessToken,
      tokenType: 'Bearer' as const,
      expiresIn: SESSION_TTL_SECONDS,
      audience: env.API_PUBLIC_URL,
      scopes,
    };
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
      handler: async ({ body, ctx }) => issueSession((await app.identity.register(ctx, body)).id),
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
      body: InvitationLookup,
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
      handler: async ({ body }) =>
        issueSession((await app.identity.authenticate(body.email, body.password)).id),
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
        const accessToken = await tokens.issuer.issue({
          subject: user.userId,
          audience: env.MCP_PUBLIC_URL,
          scopes,
          clientId: 'personal-agent-token',
          ttlSeconds,
        });
        return {
          accessToken,
          tokenType: 'Bearer' as const,
          expiresIn: ttlSeconds,
          audience: env.MCP_PUBLIC_URL,
          scopes,
        };
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
