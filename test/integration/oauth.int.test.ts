import { createMcpHttpApp } from '@atx/mcp-server';
import type { Runtime } from '@atx/runtime';
import { DEMO, createTestRuntime } from '@atx/test-utils';
import {
  Client,
  type OAuthClientInformationMixed,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthTokens,
  StreamableHTTPClientTransport,
  auth,
} from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpHarness } from './http';

/**
 * The official MCP client SDK runs its complete OAuth flow against our
 * servers, exactly like a remote MCP host (e.g. Claude) would: protected
 * resource discovery → authorization server metadata → dynamic client
 * registration → PKCE authorization (consent by a signed-in user) → code
 * exchange with RFC 9207 issuer check → MCP calls → refresh rotation.
 */

let runtime: Runtime;
let http: Awaited<ReturnType<typeof createHttpHarness>>;
let mcp: ReturnType<typeof createMcpHttpApp>;
const PASSWORD = 'demo-password-2026';
const REDIRECT = 'http://127.0.0.1:43210/callback';

/** Routes the SDK's HTTP calls to the in-process API (authorization server) and MCP server. */
const fetchFn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  const headers = new Headers(init?.headers);
  if (url.origin === new URL(runtime.env.MCP_PUBLIC_URL).origin) {
    headers.set('host', url.host);
    return mcp.fetch(new Request(url, { ...init, headers }));
  }
  const response = await http.server.inject({
    method: (init?.method ?? 'GET') as 'GET' | 'POST',
    url: url.pathname + url.search,
    headers: Object.fromEntries(headers.entries()),
    ...(init?.body ? { payload: String(init.body) } : {}),
  });
  return new Response(response.statusCode === 204 ? null : response.body, {
    status: response.statusCode,
    headers: response.headers as Record<string, string>,
  });
};

class TestHostProvider implements OAuthClientProvider {
  client: OAuthClientInformationMixed | undefined;
  stored: OAuthTokens | undefined;
  verifier = '';
  authorizationUrl: URL | undefined;
  get redirectUrl() {
    return REDIRECT;
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Test MCP Host',
      redirect_uris: [REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }
  clientInformation() {
    return this.client;
  }
  saveClientInformation(info: OAuthClientInformationMixed) {
    this.client = info;
  }
  tokens() {
    return this.stored;
  }
  saveTokens(tokens: OAuthTokens) {
    this.stored = tokens;
  }
  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
  }
  saveCodeVerifier(verifier: string) {
    this.verifier = verifier;
  }
  codeVerifier() {
    return this.verifier;
  }
}

const consent = async (authorizationUrl: URL, email: string, approve = true) => {
  const session = await http.login(email, PASSWORD);
  const params = Object.fromEntries(authorizationUrl.searchParams.entries());
  return http.post('/v1/oauth/authorization/decision', { ...params, approve }, session);
};

const mcpClient = async (accessToken: string) => {
  const client = new Client({ name: 'oauth-test-host', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(runtime.env.MCP_PUBLIC_URL), {
      fetch: fetchFn,
      requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
    }),
  );
  return client;
};

const tokenRequest = (form: Record<string, string>) =>
  http.server.inject({
    method: 'POST',
    url: '/oauth/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(form).toString(),
  });

beforeAll(async () => {
  runtime = await createTestRuntime();
  http = await createHttpHarness(runtime);
  mcp = createMcpHttpApp(runtime, { skills: [], views: new Map() });
});
afterAll(async () => {
  await mcp.close();
  await http.server.close();
  await runtime.close();
});

describe('OAuth 2.1 for MCP hosts (official client SDK)', () => {
  const host = new TestHostProvider();
  let refreshToken = '';

  it('discovers, registers dynamically and redirects to the consent page with PKCE', async () => {
    const result = await auth(host, {
      serverUrl: runtime.env.MCP_PUBLIC_URL,
      scope: 'catalog:read requirements:read',
      fetchFn,
    });
    expect(result).toBe('REDIRECT');
    expect(host.client?.client_id).toMatch(/^atx-/);
    const url = host.authorizationUrl;
    expect(url?.origin + (url?.pathname ?? '')).toBe(
      new URL('/oauth/authorize', runtime.env.PUBLIC_WEB_URL).toString(),
    );
    expect(url?.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url?.searchParams.get('resource')).toMatch(/\/mcp$/);
  });

  it('exchanges the code after the user consents and calls MCP tools with the token', async () => {
    const decision = await consent(host.authorizationUrl!, 'buyer@aurelia-motors.example');
    expect(decision.statusCode).toBe(200);
    const redirect = new URL(decision.json().redirectTo as string);
    expect(redirect.searchParams.get('iss')).toBe(runtime.env.API_PUBLIC_URL.replace(/\/$/, ''));
    const result = await auth(host, {
      serverUrl: runtime.env.MCP_PUBLIC_URL,
      authorizationCode: redirect.searchParams.get('code') ?? '',
      iss: redirect.searchParams.get('iss') ?? '',
      fetchFn,
    });
    expect(result).toBe('AUTHORIZED');
    expect(host.stored?.scope).toBe('catalog:read requirements:read');
    refreshToken = host.stored?.refresh_token ?? '';

    const client = await mcpClient(host.stored?.access_token ?? '');
    const matches = await client.callTool({
      name: 'find_matching_offerings',
      arguments: { requirement_id: DEMO.requirement },
    });
    expect(matches.isError).toBeFalsy();
    // Scopes are what the user granted: no supplier writes.
    await expect(client.callTool({ name: 'get_supplier_workspace', arguments: {} })).rejects.toThrow();
  });

  it('rotates refresh tokens and revokes the authorization when an old one is reused', async () => {
    const clientId = host.client?.client_id ?? '';
    const first = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    });
    expect(first.statusCode).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    const rotated = first.json();
    expect(rotated.refresh_token).not.toBe(refreshToken);
    const client = await mcpClient(rotated.access_token as string);
    expect(
      (await client.callTool({ name: 'search_technologies', arguments: { query: 'QNX' } })).isError,
    ).toBeFalsy();

    const reuse = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    });
    expect(reuse.statusCode).toBe(400);
    expect(reuse.json().error).toBe('invalid_grant');
    // Theft assumed: even the newest tokens stop working.
    await expect(mcpClient(rotated.access_token as string).then((c) => c.listTools())).rejects.toThrow();
    const after = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: rotated.refresh_token as string,
      client_id: clientId,
    });
    expect(after.json().error).toBe('invalid_grant');
  });

  it('shows connected apps to the user, who can disconnect them', async () => {
    const second = new TestHostProvider();
    await auth(second, { serverUrl: runtime.env.MCP_PUBLIC_URL, fetchFn });
    const decision = await consent(second.authorizationUrl!, 'owner@northstar-ai.example');
    const redirect = new URL(decision.json().redirectTo as string);
    await auth(second, {
      serverUrl: runtime.env.MCP_PUBLIC_URL,
      authorizationCode: redirect.searchParams.get('code') ?? '',
      iss: redirect.searchParams.get('iss') ?? '',
      fetchFn,
    });
    const session = await http.login('owner@northstar-ai.example', PASSWORD);
    const { items } = (await http.get('/v1/oauth/connections', session)).json();
    const connection = items.find((c: { clientName: string; status: string }) => c.status === 'active');
    // Without a scope hint the SDK asks for every advertised scope; the grant is still capped by the user's own.
    expect(connection.clientName).toBe('Test MCP Host');
    expect(connection.scopes).toEqual(expect.arrayContaining(['catalog:read', 'supplier:write']));
    expect(connection.scopes).not.toContain('admin');
    expect((await http.post(`/v1/oauth/connections/${connection.id}/revoke`, {}, session)).statusCode).toBe(
      200,
    );
    await expect(mcpClient(second.stored?.access_token ?? '').then((c) => c.listTools())).rejects.toThrow();
  });
});

describe('authorization server hardening', () => {
  const register = async (redirectUris: string[]) =>
    http.post('/oauth/register', {
      client_name: 'Probe',
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none',
    });

  it('rejects unsafe redirect URIs and confidential-client registrations', async () => {
    expect((await register(['http://attacker.example/cb'])).json().error).toBe('invalid_redirect_uri');
    expect((await register(['javascript:alert(1)'])).statusCode).toBe(400);
    const confidential = await http.post('/oauth/register', {
      redirect_uris: ['https://host.example/cb'],
      token_endpoint_auth_method: 'client_secret_basic',
    });
    expect(confidential.json().error).toBe('invalid_client_metadata');
  });

  it('never sends codes to unregistered redirects, requires PKCE and the MCP resource', async () => {
    const client = (await register(['https://host.example/cb'])).json();
    const base = {
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: 'https://host.example/cb',
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      code_challenge_method: 'S256',
    };
    const describe = (body: object) => http.post('/v1/oauth/authorization/describe', body);
    expect((await describe(base)).statusCode).toBe(200);
    expect((await describe({ ...base, redirect_uri: 'https://evil.example/cb' })).json().error).toBe(
      'invalid_redirect_uri',
    );
    expect((await describe({ ...base, code_challenge_method: 'plain' })).json().error).toBe(
      'invalid_request',
    );
    expect((await describe({ ...base, resource: 'https://other.example/mcp' })).json().error).toBe(
      'invalid_target',
    );
    expect((await describe({ ...base, scope: 'admin' })).json().error).toBe('invalid_scope');
  });

  it('rejects a wrong PKCE verifier and treats a replayed code as theft', async () => {
    const host = new TestHostProvider();
    await auth(host, { serverUrl: runtime.env.MCP_PUBLIC_URL, fetchFn });
    const redirect = new URL(
      (await consent(host.authorizationUrl!, 'buyer@aurelia-motors.example')).json().redirectTo as string,
    );
    const code = redirect.searchParams.get('code') ?? '';
    const exchange = (verifier: string) =>
      tokenRequest({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT,
        client_id: host.client?.client_id ?? '',
      });
    expect((await exchange('x'.repeat(43))).json().error).toBe('invalid_grant');
    const ok = await exchange(host.verifier);
    expect(ok.statusCode).toBe(200);
    const replay = await exchange(host.verifier);
    expect(replay.json().error).toBe('invalid_grant');
    await expect(mcpClient(ok.json().access_token as string).then((c) => c.listTools())).rejects.toThrow();
  });

  it('only lets a signed-in user on the website give consent (not an agent token)', async () => {
    const host = new TestHostProvider();
    await auth(host, { serverUrl: runtime.env.MCP_PUBLIC_URL, fetchFn });
    const params = Object.fromEntries(host.authorizationUrl!.searchParams.entries());
    expect(
      (await http.post('/v1/oauth/authorization/decision', { ...params, approve: true })).statusCode,
    ).toBe(401);
    const user = await runtime.app.identity.principalFor(DEMO.users.buyer, {
      channel: 'mcp',
      clientId: 'some-agent',
      grantedScopes: 'all',
    });
    await expect(
      runtime.app.oauth.decide(
        { principal: user, requestId: 'agent' },
        {
          responseType: 'code',
          clientId: params['client_id'] ?? '',
          redirectUri: params['redirect_uri'] ?? '',
          codeChallenge: params['code_challenge'] ?? '',
          codeChallengeMethod: 'S256',
          scope: null,
          state: null,
          resource: null,
        },
        true,
      ),
    ).rejects.toMatchObject({ error: 'access_denied' });
  });
});

describe('least-privilege start when MCP authentication is required', () => {
  it('the initial 401 challenge asks for catalog:read only, so hosts start minimal and step up', async () => {
    const strict = await createTestRuntime({ MCP_REQUIRE_AUTH: 'true' });
    const app = createMcpHttpApp(strict, { skills: [], views: new Map() });
    try {
      const response = await app.fetch(
        new Request(strict.env.MCP_PUBLIC_URL, {
          method: 'POST',
          headers: {
            host: new URL(strict.env.MCP_PUBLIC_URL).host,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
        }),
      );
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toMatch(/scope="catalog:read"/);
      expect(response.headers.get('www-authenticate')).toMatch(/resource_metadata=/);
    } finally {
      await app.close();
      await strict.close();
    }
  });
});
