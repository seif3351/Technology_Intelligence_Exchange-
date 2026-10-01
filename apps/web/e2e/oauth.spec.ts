import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { DEMO_PASSWORD } from './helpers';

const API = 'http://localhost:4000';
const CALLBACK = 'http://127.0.0.1:43210/callback';

test.describe('OAuth consent for MCP hosts', () => {
  test('sign in, review requested permissions, allow, and return to the host with a code', async ({
    page,
    request,
  }) => {
    const registered = await request.post(`${API}/oauth/register`, {
      data: {
        client_name: 'Playwright MCP Host',
        redirect_uris: [CALLBACK],
        token_endpoint_auth_method: 'none',
      },
    });
    expect(registered.status()).toBe(201);
    const clientId = (await registered.json()).client_id as string;
    const verifier = randomBytes(32).toString('base64url');
    const authorize = new URL('/oauth/authorize', 'http://localhost:3000');
    for (const [key, value] of Object.entries({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: CALLBACK,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      scope: 'catalog:read requirements:read',
      state: 'xyz-state',
      resource: 'http://localhost:4100/mcp',
    }))
      authorize.searchParams.set(key, value);

    // The host's callback: capture where the browser is sent.
    let callback: URL | undefined;
    await page.route(`${CALLBACK}**`, async (route) => {
      callback = new URL(route.request().url());
      await route.fulfill({ status: 200, body: 'host callback' });
    });

    await page.goto(authorize.pathname + authorize.search);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.getByLabel('Email').fill('buyer@aurelia-motors.example');
    await page.getByLabel('Password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('heading', { name: 'Connect an AI application' })).toBeVisible();
    await expect(page.getByText('Playwright MCP Host')).toBeVisible();
    await expect(page.getByText('not verified by ATX')).toBeVisible();
    await expect(page.getByText("Read your organization's private requirements")).toBeVisible();
    await page.getByRole('button', { name: 'Allow access' }).click();

    await expect.poll(() => callback?.searchParams.get('code') ?? null).not.toBeNull();
    expect(callback?.searchParams.get('state')).toBe('xyz-state');
    expect(callback?.searchParams.get('iss')).toBe(API);

    const token = await request.post(`${API}/oauth/token`, {
      form: {
        grant_type: 'authorization_code',
        code: callback?.searchParams.get('code') ?? '',
        code_verifier: verifier,
        redirect_uri: CALLBACK,
        client_id: clientId,
      },
    });
    expect(token.status()).toBe(200);
    expect((await token.json()).scope).toBe('catalog:read requirements:read');

    await page.goto('/account');
    await expect(page.getByRole('row').filter({ hasText: 'Playwright MCP Host' })).toContainText('active');
  });

  test('an unknown application is explained, never redirected', async ({ page }) => {
    await page.goto(
      `/oauth/authorize?response_type=code&client_id=atx-unknown&redirect_uri=${encodeURIComponent('https://evil.example/cb')}&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256`,
    );
    await expect(page.getByRole('heading', { name: 'Cannot connect this application' })).toBeVisible();
    expect(page.url()).toContain('localhost:3000');
  });
});
