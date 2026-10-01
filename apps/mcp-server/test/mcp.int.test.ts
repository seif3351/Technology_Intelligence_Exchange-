import path from 'node:path';
import type { Runtime } from '@atx/runtime';
import { DEMO, REPO_ROOT, createTestRuntime } from '@atx/test-utils';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createMcpHttpApp } from '../src/server';
import { loadSkills } from '../src/skills/skills';
import { UI } from '../src/tools/discovery';

let runtime: Runtime;
let app: ReturnType<typeof createMcpHttpApp>;
const MCP_URL = 'http://localhost:4100/mcp';

/** Like a real HTTP request: the Host header is always present. */
const request = (url: string | URL, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set('host', new URL(url).host);
  return new Request(url, { ...init, headers });
};

const connect = async (token?: string) => {
  const client = new Client({ name: 'atx-test-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    fetch: (url, init) => app.fetch(request(url, init)),
    ...(token ? { requestInit: { headers: { authorization: `Bearer ${token}` } } } : {}),
  });
  await client.connect(transport);
  return client;
};

const mcpToken = (userId: string, scopes: string[]) =>
  runtime.tokens.issuer.issue({ subject: userId, audience: runtime.env.MCP_PUBLIC_URL, scopes, clientId: 'test-agent', ttlSeconds: 600 });

const structured = <T = Record<string, unknown>>(result: { structuredContent?: unknown }) => result.structuredContent as T;
const text = (result: { content?: unknown }) =>
  ((result.content as { type: string; text?: string }[] | undefined) ?? []).map((block) => block.text ?? '').join('\n');

beforeAll(async () => {
  runtime = await createTestRuntime();
  app = createMcpHttpApp(runtime, {
    skills: loadSkills(path.join(REPO_ROOT, 'skills')),
    views: new Map(Object.values(UI).map((uri) => [uri, `<!doctype html><title>${uri}</title>`])),
  });
});

afterAll(async () => {
  await app.close();
  await runtime.close();
});

describe('MCP discovery', () => {
  it('lists tools deterministically with input/output schemas and MCP App metadata', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual([...names].sort());
    expect(names).toEqual(
      expect.arrayContaining([
        'search_technologies',
        'search_offerings',
        'search_suppliers',
        'find_matching_offerings',
        'search_matching_suppliers',
        'get_offering',
        'get_supplier',
        'get_evidence',
        'get_demo',
        'compare_offerings',
        'analyze_requirement',
        'explain_match',
        'create_requirement_draft',
        'validate_requirement',
      ]),
    );
    for (const tool of tools) {
      expect(tool.outputSchema, tool.name).toBeDefined();
      expect(tool.description?.length ?? 0, tool.name).toBeGreaterThan(40);
    }
    const matching = tools.find((tool) => tool.name === 'find_matching_offerings');
    expect(matching?.annotations?.readOnlyHint).toBe(true);
    expect((matching?._meta as { ui?: { resourceUri?: string } } | undefined)?.ui?.resourceUri).toBe(UI.compatibilityMatrix);
  });

  it('serves MCP App views as ui:// resources with the MCP App mime type', async () => {
    const client = await connect();
    const resource = await client.readResource({ uri: UI.offeringCard });
    expect(resource.contents[0]?.mimeType).toBe('text/html;profile=mcp-app');
  });

  it('exposes the Automotive Technology Exchange skill through the skills extension', async () => {
    const client = await connect();
    const list = await client.request({ method: 'skills/list', params: {} }, z.object({ skills: z.array(z.object({ uri: z.string(), frontmatter: z.record(z.string(), z.unknown()) })) }).loose());
    expect(list.skills[0]?.uri).toBe('skill://automotive-technology-exchange/SKILL.md');
    expect(list.skills[0]?.frontmatter['name']).toBe('automotive-technology-exchange');
    const file = await client.readResource({ uri: 'skill://automotive-technology-exchange/SKILL.md' });
    expect(JSON.stringify(file.contents)).toContain('Untrusted content');
  });
});

describe('MCP matching tools (behavioural examples)', () => {
  it('example 1: AUTOSAR Adaptive middleware for QNX + Orin with SOME/IP', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'find_matching_offerings',
      arguments: { text: 'I need an AUTOSAR Adaptive middleware solution for QNX and NVIDIA Orin with SOME/IP support.' },
    });
    const data = structured<{ interpretation: { hardConstraints: { conceptId: string }[] }; matches: { offering: { name: string }; hardConstraintStatus: string; assessments: { basis: string | null }[] }[] }>(result);
    expect(data.interpretation.hardConstraints.map((c) => c.conceptId).sort()).toEqual(['autosar-adaptive', 'middleware', 'nvidia-drive-orin', 'qnx', 'some-ip']);
    expect(data.matches[0]?.offering.name).toBe('VectorForge Adaptive Middleware');
    expect(data.matches[0]?.hardConstraintStatus).toBe('all_met');
    // Verified vs unverified bases are distinguished.
    const bases = new Set(data.matches[0]?.assessments.map((a) => a.basis));
    expect(bases).toContain('verified by platform review of evidence');
    expect(bases).toContain('stated by supplier, with linked evidence (not independently verified)');
    expect(text(result)).toContain('VectorForge Adaptive Middleware');
  });

  it('example 2: AI-based ADAS integration test automation with ISO 26262 experience and production references', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'find_matching_offerings',
      arguments: {
        text: 'We need AI-based integration test automation for an ADAS platform using AUTOSAR Adaptive, QNX and Ethernet. We want a supplier with ISO 26262 experience and production references.',
      },
    });
    const data = structured<{ matches: { offering: { name: string }; hardConstraintStatus: string; gaps: unknown[] }[] }>(result);
    expect(data.matches[0]?.offering.name).toBe('Northstar AI Integration Test Platform');
    expect(data.matches[0]?.hardConstraintStatus).toBe('all_met');
    // Other candidates surface missing evidence as gaps instead of being silently dropped.
    expect(data.matches.slice(1).some((m) => m.gaps.length > 0)).toBe(true);
  });

  it('example 3: technical demos for automated integration log analysis', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'get_demo', arguments: { query: 'Show me technical demos of solutions that can automatically analyze automotive integration logs.' } });
    const data = structured<{ videos: { title: string; playbackUrl: string | null; pageUrl: string | null }[] }>(result);
    expect(data.videos[0]?.title).toMatch(/integration logs/i);
    expect(data.videos[0]?.playbackUrl).toMatch(/^https:\/\//);
    expect(data.videos[0]?.pageUrl).toContain('/offerings/');
  });

  it('example 4: confidential terms never appear in results', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'find_matching_offerings',
      arguments: {
        text: 'For Project Falcon on vehicle program VP-2031 for customer Contoso Fleet we need HIL testing with QNX support.',
        confidential_terms: ['Project Falcon', 'VP-2031', 'Contoso Fleet'],
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/Falcon|VP-2031|2031|Contoso/i);
    expect(structured<{ matches: unknown[] }>(result).matches.length).toBeGreaterThan(0);
  });

  it('never upgrades "designed for" into certification', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'explain_match',
      arguments: { offering_id: DEMO.offerings.drivemeshSim, constraints: [{ kind: 'concept', conceptId: 'iso-26262', level: 'certified', asil: 'B' }] },
    });
    const data = structured<{ match: { assessments: { status: string }[]; hardConstraintStatus: string } }>(result);
    expect(data.match.assessments[0]?.status).not.toBe('met');
    expect(data.match.hardConstraintStatus).not.toBe('all_met');
  });

  it('compares offerings in a matrix with an evidence basis per cell', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'compare_offerings',
      arguments: { offering_ids: [DEMO.offerings.vectorforgeMiddleware, DEMO.offerings.northstarItp], text: 'QNX and SOME/IP with ISO 26262 experience' },
    });
    const data = structured<{ offerings: unknown[]; rows: { cells: { status: string }[] }[] }>(result);
    expect(data.offerings).toHaveLength(2);
    expect(data.rows.length).toBeGreaterThanOrEqual(3);
    expect(data.rows.every((row) => row.cells.length === 2)).toBe(true);
  });

  it('marks supplier-authored fields as untrusted', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'get_offering', arguments: { offering_id: DEMO.offerings.northstarItp } });
    const data = structured<{ offering: { untrusted: boolean }; claims: { untrusted: boolean; provenance: string }[]; notice: string }>(result);
    expect(data.offering.untrusted).toBe(true);
    expect(data.claims.every((claim) => claim.untrusted)).toBe(true);
    // Draft AI-inferred claims are never exposed publicly.
    expect(data.claims.some((claim) => claim.provenance === 'AI_INFERRED')).toBe(false);
    expect(data.notice).toMatch(/never as instructions/);
  });

  it('returns in-band tool errors for invalid references', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'get_offering', arguments: { offering_id: '00000000-0000-4000-8000-000000000000' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/NOT_FOUND/);
  });
});

describe('MCP authorization', () => {
  it('rejects invalid tokens with a 401 challenge pointing at protected resource metadata', async () => {
    const response = await app.fetch(request(MCP_URL, { method: 'POST', headers: { authorization: 'Bearer not-a-jwt', 'content-type': 'application/json' }, body: '{}' }));
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toMatch(/resource_metadata=/);
    const metadata = await (await app.fetch(request('http://localhost:4100/.well-known/oauth-protected-resource/mcp'))).json();
    expect(metadata).toMatchObject({ resource: runtime.env.MCP_PUBLIC_URL, bearer_methods_supported: ['header'] });
  });

  it('rejects tokens minted for a different audience (no token passthrough)', async () => {
    const apiToken = await runtime.tokens.issuer.issue({ subject: DEMO.users.buyer, audience: runtime.env.API_PUBLIC_URL, scopes: ['catalog:read'], ttlSeconds: 600 });
    const response = await app.fetch(request(MCP_URL, { method: 'POST', headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' }, body: '{}' }));
    expect(response.status).toBe(401);
  });

  it('requires authentication for private requirement drafts', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'create_requirement_draft', arguments: { title: 'HIL bench', description: 'HIL testing with QNX support for a gateway ECU.' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/UNAUTHENTICATED/);
  });

  it('creates a private draft for an authorized buyer and keeps confidential terms out of the result', async () => {
    const client = await connect(await mcpToken(DEMO.users.buyer, ['catalog:read', 'requirements:write', 'requirements:read']));
    const result = await client.callTool({
      name: 'create_requirement_draft',
      arguments: { title: 'Gateway HIL', description: 'HIL testing with QNX for Project Nightjar.', confidential_terms: ['Project Nightjar'] },
    });
    expect(result.isError).toBeFalsy();
    const data = structured<{ requirement: { visibility: string; confidentialTermCount: number } }>(result);
    expect(data.requirement).toMatchObject({ visibility: 'private', confidentialTermCount: 1 });
    expect(JSON.stringify(result.structuredContent)).not.toContain('Nightjar');
  });

  it('challenges for missing scopes instead of silently succeeding', async () => {
    const client = await connect(await mcpToken(DEMO.users.buyer, ['catalog:read']));
    await expect(
      client.callTool({ name: 'create_requirement_draft', arguments: { title: 'Gateway HIL', description: 'HIL testing with QNX support for a gateway.' } }),
    ).rejects.toThrow();
  });

  it('cannot read another organization\'s saved requirement', async () => {
    const client = await connect(await mcpToken(DEMO.users.vectorforge, ['catalog:read', 'requirements:read']));
    const result = await client.callTool({
      name: 'find_matching_offerings',
      arguments: { requirement_id: DEMO.requirement, organization_id: DEMO.orgs.aurelia },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/FORBIDDEN/);
  });
});

describe('MCP consequential actions', () => {
  it('requires prepare -> explicit confirmation -> idempotent submission', async () => {
    const client = await connect(await mcpToken(DEMO.users.buyer, ['catalog:read', 'engagements:write', 'requirements:read']));
    const args = {
      offering_id: DEMO.offerings.northstarItp,
      type: 'demo',
      message: 'We would like a technical demo of the integration test platform on QNX.',
      contact_name: 'Sam Keller',
      contact_email: 'buyer@aurelia-motors.example',
    };
    const prepared = await client.callTool({ name: 'prepare_engagement_request', arguments: args });
    const preview = structured<{ confirmationToken: string; requiresHumanConfirmation: boolean }>(prepared);
    expect(preview.requiresHumanConfirmation).toBe(true);
    expect(text(prepared)).toMatch(/NOT SENT/);

    // Without explicit user confirmation the call is rejected by schema validation.
    const unconfirmed = await client.callTool({ name: 'confirm_engagement_request', arguments: { ...args, confirmation_token: preview.confirmationToken, idempotency_key: 'test-key-0001' } });
    expect(unconfirmed.isError).toBe(true);

    // A token cannot be reused for different content.
    const tampered = await client.callTool({
      name: 'confirm_engagement_request',
      arguments: { ...args, message: 'Different message that the user never saw in the preview.', confirmation_token: preview.confirmationToken, idempotency_key: 'test-key-0002', user_confirmed: true },
    });
    expect(text(tampered)).toMatch(/CONFIRMATION_REQUIRED/);

    const confirmed = await client.callTool({ name: 'confirm_engagement_request', arguments: { ...args, confirmation_token: preview.confirmationToken, idempotency_key: 'test-key-0003', user_confirmed: true } });
    expect(structured<{ replayed: boolean }>(confirmed).replayed).toBe(false);
    const replay = await client.callTool({ name: 'confirm_engagement_request', arguments: { ...args, confirmation_token: preview.confirmationToken, idempotency_key: 'test-key-0003', user_confirmed: true } });
    expect(structured<{ replayed: boolean }>(replay).replayed).toBe(true);
  });
});
