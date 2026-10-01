import path from 'node:path';
import type { Runtime } from '@atx/runtime';
import { DEMO, REPO_ROOT, contextFor, createTestRuntime } from '@atx/test-utils';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMcpHttpApp } from '../src/server';
import { loadSkills } from '../src/skills/skills';

let runtime: Runtime;
let app: ReturnType<typeof createMcpHttpApp>;
const MCP_URL = 'http://localhost:4100/mcp';

const request = (url: string | URL, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set('host', new URL(url).host);
  return new Request(url, { ...init, headers });
};

const connect = async (token: string) => {
  const client = new Client({ name: 'agent-token-test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(MCP_URL), {
      fetch: (url, init) => app.fetch(request(url, init)),
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  return client;
};

beforeAll(async () => {
  runtime = await createTestRuntime();
  app = createMcpHttpApp(runtime, { skills: loadSkills(path.join(REPO_ROOT, 'skills')), views: new Map() });
});
afterAll(async () => {
  await app.close();
  await runtime.close();
});

describe('revocable personal agent tokens on the MCP server', () => {
  it('works until revoked, then yields an invalid_token challenge', async () => {
    const session = await contextFor(runtime, DEMO.users.northstar, 'all');
    const { token, grant } = await runtime.app.agentTokens.issue(session, {
      label: 'Supplier agent',
      scopes: ['catalog:read', 'supplier:write'],
      expiresInDays: 30,
    });
    const client = await connect(token);
    const workspace = await client.callTool({ name: 'get_supplier_workspace', arguments: {} });
    expect(workspace.isError).toBeFalsy();
    const [listed] = await runtime.app.agentTokens.list(session);
    expect(listed).toMatchObject({ id: grant.id, status: 'active', lastUsedAt: expect.any(String) });

    await runtime.app.agentTokens.revoke(session, grant.id);
    const response = await app.fetch(
      request(MCP_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toMatch(/invalid_token/);
  });

  it('cannot be minted by an agent, only from a first-party session', async () => {
    const agentContext = await runtime.app.identity
      .principalFor(DEMO.users.northstar, { channel: 'mcp', clientId: 'some-agent', grantedScopes: 'all' })
      .then((principal) => ({ principal, requestId: 'agent' }));
    await expect(
      runtime.app.agentTokens.issue(agentContext, { label: 'x', scopes: ['catalog:read'], expiresInDays: 1 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
