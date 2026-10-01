import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { RequestContext } from '@atx/application';
import type { Runtime } from '@atx/runtime';
import { DEMO, REPO_ROOT, TEST_DATABASE_URL, contextFor, createTestRuntime } from '@atx/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const OPERATOR: RequestContext = {
  principal: { kind: 'system', component: 'test-operator' },
  requestId: 'test-operator',
};

let runtime: Runtime;

beforeAll(async () => {
  runtime = await createTestRuntime();
});
afterAll(async () => {
  await runtime.close();
});

describe('platform administrator bootstrap', () => {
  it('creates a new administrator who receives the admin scope', async () => {
    const { user, created } = await runtime.app.identity.bootstrapPlatformAdmin(OPERATOR, {
      email: 'Ops@Example.com',
      displayName: 'Ops',
      password: 'a-very-long-operator-password',
    });
    expect(created).toBe(true);
    expect(user).toMatchObject({ email: 'ops@example.com', platformRole: 'platform_admin' });
    const ctx = await contextFor(runtime, user.id);
    expect(ctx.principal.scopes.has('admin')).toBe(true);
    const { rows } = await runtime.pool.query(
      "SELECT 1 FROM audit_events WHERE action = 'user.platform_admin.grant' AND resource_id = $1",
      [user.id],
    );
    expect(rows).toHaveLength(1);
  });

  it('promotes an existing account without changing its password', async () => {
    const { user, created } = await runtime.app.identity.bootstrapPlatformAdmin(OPERATOR, {
      email: 'owner@northstar-ai.example',
      displayName: 'ignored',
      password: null,
    });
    expect(created).toBe(false);
    expect(user.platformRole).toBe('platform_admin');
    await expect(
      runtime.app.identity.authenticate('owner@northstar-ai.example', 'demo-password-2026'),
    ).resolves.toMatchObject({ id: DEMO.users.northstar });
  });

  it('is unreachable for normal users and requires a password for new accounts', async () => {
    await expect(
      runtime.app.identity.bootstrapPlatformAdmin(await contextFor(runtime, DEMO.users.buyer), {
        email: 'buyer@aurelia-motors.example',
        displayName: 'x',
        password: null,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      runtime.app.identity.bootstrapPlatformAdmin(OPERATOR, {
        email: 'nobody@example.com',
        displayName: 'x',
        password: null,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('works through the operator CLI with the password from the environment, not argv', async () => {
    const { stdout } = await run(
      path.join(REPO_ROOT, 'node_modules/.bin/tsx'),
      [path.join(REPO_ROOT, 'scripts/admin.ts'), 'cli-admin@example.com', 'CLI Admin'],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          LOG_LEVEL: 'silent',
          DATABASE_URL: TEST_DATABASE_URL,
          AUTH_DEV_KEY_FILE: path.join(REPO_ROOT, '.var/test-signing-key.json'),
          ATX_ADMIN_PASSWORD: 'another-long-operator-password',
        },
      },
    );
    expect(stdout).toMatch(/created platform administrator cli-admin@example\.com/);
    expect(stdout).not.toContain('another-long-operator-password');
    await expect(
      runtime.app.identity.authenticate('cli-admin@example.com', 'another-long-operator-password'),
    ).resolves.toMatchObject({ platformRole: 'platform_admin' });
  });
});
