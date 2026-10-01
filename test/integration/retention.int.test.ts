import type { Runtime } from '@atx/runtime';
import { DEMO, contextFor, createTestRuntime } from '@atx/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let runtime: Runtime;
const SYSTEM = { principal: { kind: 'system' as const, component: 'test' }, requestId: 'retention-test' };

beforeAll(async () => {
  runtime = await createTestRuntime();
});
afterAll(async () => {
  await runtime.close();
});

describe('retention purge', () => {
  it('deletes long-expired secrets and unused OAuth clients, keeps live data and the audit log', async () => {
    const pool = runtime.pool;
    await runtime.app.oauth.registerClient({ client_name: 'Old', redirect_uris: ['https://old.example/cb'] });
    await runtime.app.oauth.registerClient({
      client_name: 'Fresh',
      redirect_uris: ['https://fresh.example/cb'],
    });
    await pool.query(
      "UPDATE oauth_clients SET created_at = now() - interval '10 days' WHERE client_name = 'Old'",
    );
    await pool.query(
      `INSERT INTO user_tokens (id, user_id, purpose, token_hash, expires_at, created_at)
       VALUES (gen_random_uuid(), $1, 'password_reset', 'old-hash', now() - interval '30 days', now() - interval '31 days'),
              (gen_random_uuid(), $1, 'password_reset', 'live-hash', now() + interval '1 hour', now())`,
      [DEMO.users.buyer],
    );
    const auditBefore = (await pool.query('SELECT count(*)::int AS n FROM audit_events')).rows[0]?.['n'];

    const counts = await runtime.app.maintenance.purgeExpired(SYSTEM);
    expect(counts['unusedOAuthClients']).toBe(1);
    expect(counts['userTokens']).toBe(1);
    const clients = (await pool.query('SELECT client_name FROM oauth_clients')).rows.map(
      (r) => r['client_name'],
    );
    expect(clients).toEqual(['Fresh']);
    const tokens = (await pool.query('SELECT token_hash FROM user_tokens')).rows.map((r) => r['token_hash']);
    expect(tokens).toEqual(['live-hash']);
    expect((await pool.query('SELECT count(*)::int AS n FROM audit_events')).rows[0]?.['n']).toBe(
      auditBefore,
    );
  });

  it('only runs as a system task', async () => {
    await expect(
      runtime.app.maintenance.purgeExpired(await contextFor(runtime, DEMO.users.admin)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
