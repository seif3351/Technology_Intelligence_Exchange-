import type { Runtime } from '@atx/runtime';
import { createTestRuntime } from '@atx/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpHarness } from './http';

let runtime: Runtime;
let http: Awaited<ReturnType<typeof createHttpHarness>>;
const PASSWORD = 'demo-password-2026';

beforeAll(async () => {
  runtime = await createTestRuntime();
  http = await createHttpHarness(runtime);
});
afterAll(async () => {
  await http.server.close();
  await runtime.close();
});

describe('agent token management API', () => {
  it('creates a labelled, scoped, revocable token and never lists token values', async () => {
    const session = await http.login('buyer@aurelia-motors.example', PASSWORD);
    const created = await http.post(
      '/v1/auth/agent-tokens',
      { scopes: ['catalog:read', 'requirements:read'], label: 'Claude Code laptop', expiresInDays: 90 },
      session,
    );
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.grant).toMatchObject({ label: 'Claude Code laptop', status: 'active' });
    const claims = await runtime.tokens.mcpVerifier.verify(body.accessToken as string);
    expect(claims.grantId).toBe(body.grant.id);
    expect(claims.expiresAt * 1000 - Date.now()).toBeGreaterThan(89 * 86_400_000);

    const list = await http.get('/v1/auth/agent-tokens', session);
    expect(JSON.stringify(list.json())).not.toContain(body.accessToken);

    const outsider = await http.login('owner@vectorforge.example', PASSWORD);
    expect((await http.post(`/v1/auth/agent-tokens/${body.grant.id}/revoke`, {}, outsider)).statusCode).toBe(
      404,
    );
    expect((await http.post(`/v1/auth/agent-tokens/${body.grant.id}/revoke`, {}, session)).statusCode).toBe(
      200,
    );
    expect((await http.get('/v1/auth/agent-tokens', session)).json().items[0].status).toBe('revoked');
  });

  it('rejects lifetimes above 90 days and tokens are not accepted by the web API', async () => {
    const session = await http.login('buyer@aurelia-motors.example', PASSWORD);
    const tooLong = await http.post(
      '/v1/auth/agent-tokens',
      { scopes: ['catalog:read'], label: 'x', expiresInDays: 91 },
      session,
    );
    expect(tooLong.statusCode).toBe(400);
    const created = await http.post(
      '/v1/auth/agent-tokens',
      { scopes: ['catalog:read'], label: 'x' },
      session,
    );
    // Audience-bound to the MCP server: the HTTP API refuses it (no token passthrough / reuse).
    expect((await http.get('/v1/me', created.json().accessToken as string)).statusCode).toBe(401);
  });
});
