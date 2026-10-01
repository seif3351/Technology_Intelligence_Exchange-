import type { Runtime } from '@atx/runtime';
import { createTestRuntime } from '@atx/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpHarness, linkToken } from './http';

let runtime: Runtime;
let http: Awaited<ReturnType<typeof createHttpHarness>>;
const mails = () => runtime.mailbox?.messages ?? [];
const lastMailTo = (email: string) => [...mails()].reverse().find((m) => m.to === email);

beforeAll(async () => {
  // Open registration exercises the email-verification path (invitations prove ownership already).
  runtime = await createTestRuntime({ REGISTRATION_MODE: 'open' });
  http = await createHttpHarness(runtime);
});
afterAll(async () => {
  await http.server.close();
  await runtime.close();
});

const register = async (email: string, password = 'a-long-account-password') => {
  const response = await http.post('/v1/auth/register', {
    email,
    password,
    displayName: 'Account Test',
    acceptTerms: true,
  });
  expect(response.statusCode).toBe(201);
  return response.json().accessToken as string;
};

describe('email verification', () => {
  it('requires a confirmed address before creating an organization', async () => {
    const token = await register('verify-me@example.com');
    const mail = lastMailTo('verify-me@example.com');
    expect(mail?.subject).toMatch(/Confirm your email/);
    expect((await http.get('/v1/me', token)).json().user.emailVerified).toBe(false);

    const blocked = await http.post(
      '/v1/organizations',
      { name: 'Unverified Org', kind: 'supplier', summary: 'Should not be created yet.' },
      token,
    );
    expect(blocked.statusCode).toBe(403);

    const verificationToken = linkToken(mail?.text ?? '');
    expect(
      (await http.post('/v1/auth/email-verification/confirm', { token: verificationToken })).statusCode,
    ).toBe(200);
    expect((await http.get('/v1/me', token)).json().user.emailVerified).toBe(true);
    // Single use.
    expect(
      (await http.post('/v1/auth/email-verification/confirm', { token: verificationToken })).statusCode,
    ).toBe(400);

    const created = await http.post(
      '/v1/organizations',
      { name: 'Verified Org', kind: 'supplier', summary: 'Created after verifying the email.' },
      token,
    );
    expect(created.statusCode).toBe(201);
  });

  it('can resend a verification link, within limits', async () => {
    const token = await register('resend@example.com');
    const before = mails().length;
    const resent = await http.post('/v1/auth/email-verification/resend', {}, token);
    expect(resent.json()).toEqual({ sent: true });
    expect(mails().length).toBe(before + 1);
  });
});

describe('password reset', () => {
  it('never reveals whether an address is registered', async () => {
    const before = mails().length;
    const response = await http.post('/v1/auth/password-reset/request', { email: 'nobody@example.com' });
    expect(response.statusCode).toBe(202);
    expect(mails().length).toBe(before);
  });

  it('resets the password, signs out every existing session and is single-use', async () => {
    const email = 'reset-me@example.com';
    const oldSession = await register(email, 'the-original-password');
    expect((await http.get('/v1/me', oldSession)).statusCode).toBe(200);

    expect(
      (await http.post('/v1/auth/password-reset/request', { email: 'Reset-Me@Example.com' })).statusCode,
    ).toBe(202);
    const resetToken = linkToken(lastMailTo(email)?.text ?? '');
    const reset = await http.post('/v1/auth/password-reset/confirm', {
      token: resetToken,
      newPassword: 'a-brand-new-password',
    });
    expect(reset.statusCode).toBe(200);

    expect((await http.get('/v1/me', oldSession)).statusCode).toBe(401);
    await expect(http.login(email, 'the-original-password')).rejects.toThrow();
    const fresh = await http.login(email, 'a-brand-new-password');
    const me = (await http.get('/v1/me', fresh)).json();
    // Receiving the reset link proves the address.
    expect(me.user.emailVerified).toBe(true);

    const reuse = await http.post('/v1/auth/password-reset/confirm', {
      token: resetToken,
      newPassword: 'yet-another-password',
    });
    expect(reuse.statusCode).toBe(400);
  });

  it('limits reset emails per account and hour', async () => {
    const email = 'mailbomb@example.com';
    await register(email);
    const count = () => mails().filter((m) => m.to === email && /Reset/.test(m.subject)).length;
    for (let i = 0; i < 5; i += 1) await http.post('/v1/auth/password-reset/request', { email });
    expect(count()).toBe(3);
  });

  it('never writes secret links to the audit log', async () => {
    const { rows } = await runtime.pool.query(
      "SELECT metadata::text AS m FROM audit_events WHERE action LIKE 'user.%'",
    );
    expect(rows.every((row) => !/token|https?:/i.test(row['m'] as string))).toBe(true);
  });
});

describe('sign out everywhere', () => {
  it('invalidates sessions and MCP agent tokens issued before, but not later sign-ins', async () => {
    const email = 'everywhere@example.com';
    const session = await register(email, 'everywhere-password');
    const userId = (await http.get('/v1/me', session)).json().user.id as string;
    const agentToken = await runtime.tokens.issuer.issue({
      subject: userId,
      audience: runtime.env.MCP_PUBLIC_URL,
      scopes: ['catalog:read'],
      ttlSeconds: 600,
    });
    expect((await http.post('/v1/auth/sign-out-everywhere', {}, session)).statusCode).toBe(200);
    expect((await http.get('/v1/me', session)).statusCode).toBe(401);

    const claims = await runtime.tokens.mcpVerifier.verify(agentToken);
    await expect(
      runtime.app.identity.principalFor(claims.subject as never, {
        channel: 'mcp',
        clientId: null,
        grantedScopes: claims.scopes,
        issuedAtMs: claims.issuedAtMs,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    const again = await http.login(email, 'everywhere-password');
    expect((await http.get('/v1/me', again)).statusCode).toBe(200);
  });
});
