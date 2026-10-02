import type { Runtime } from '@atx/runtime';
import { DEMO, createTestRuntime } from '@atx/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpHarness } from './http';

let runtime: Runtime;
let http: Awaited<ReturnType<typeof createHttpHarness>>;
let session: string;
const org = DEMO.orgs.vectorforge;

const call = (method: 'POST' | 'PATCH', url: string, payload: unknown) =>
  http.server.inject({
    method,
    url,
    payload: payload as object,
    headers: { authorization: `Bearer ${session}` },
  });

beforeAll(async () => {
  runtime = await createTestRuntime();
  http = await createHttpHarness(runtime);
  session = await http.login('owner@vectorforge.example', 'demo-password-2026');
});
afterAll(async () => {
  await http.server.close();
  await runtime.close();
});

describe('supplier workspace behaviour (expert review S13)', () => {
  let offeringId = '';

  it('derives a unique slug from the name when none is given', async () => {
    const body = {
      type: 'product',
      name: 'Zonal Gateway Stack',
      summary: 'Gateway software for zone controllers (synthetic test offering).',
      maturity: 'pilot',
      details: { type: 'product' },
    };
    const first = await call('POST', `/v1/organizations/${org}/offerings`, body);
    expect(first.statusCode).toBe(201);
    expect(first.json().slug).toBe('zonal-gateway-stack');
    offeringId = first.json().id as string;
    const second = await call('POST', `/v1/organizations/${org}/offerings`, body);
    expect(second.json().slug).toBe('zonal-gateway-stack-2');
    // An explicit slug that is taken is still a conflict, never silently renamed.
    const explicit = await call('POST', `/v1/organizations/${org}/offerings`, {
      ...body,
      slug: 'zonal-gateway-stack',
    });
    expect(explicit.statusCode).toBe(409);
  });

  it('keeps the source when evidence is linked, and saves validity dates', async () => {
    const created = await call('POST', `/v1/organizations/${org}/claims`, {
      subject: { type: 'offering', id: offeringId },
      predicate: 'SUPPORTS',
      conceptId: 'zonal-architecture',
      statement: 'Runs on zone controllers.',
      sourceUrl: 'https://example.com/zonal-datasheet',
    });
    expect(created.statusCode).toBe(201);
    const claim = created.json() as { id: string; version: number };
    const evidence = await call('POST', `/v1/organizations/${org}/evidence`, {
      offeringId,
      kind: 'public_url',
      title: 'Zonal datasheet',
      url: 'https://example.com/zonal-datasheet',
    });
    const linked = await call('PATCH', `/v1/organizations/${org}/claims/${claim.id}`, {
      expectedVersion: claim.version,
      evidenceIds: [evidence.json().id],
      expiresAt: '2027-06-30T23:59:59.000Z',
    });
    expect(linked.statusCode).toBe(200);
    expect(linked.json()).toMatchObject({
      provenance: {
        sourceUrl: 'https://example.com/zonal-datasheet',
        evidenceIds: [evidence.json().id],
      },
      expiresAt: '2027-06-30T23:59:59.000Z',
    });
    const cleared = await call('PATCH', `/v1/organizations/${org}/claims/${claim.id}`, {
      expectedVersion: (linked.json() as { version: number }).version,
      expiresAt: null,
    });
    expect(cleared.json().expiresAt).toBeNull();
    expect(cleared.json().provenance.sourceUrl).toBe('https://example.com/zonal-datasheet');
  });

  it('a person may correct a published claim; a substantive edit drops platform verification', async () => {
    const workspace = (await http.get(`/v1/organizations/${org}/workspace`, session)).json() as {
      claims: { id: string; version: number; status: string; trustTier: string; statement: string }[];
    };
    const verified = workspace.claims.find(
      (c) => c.status === 'published' && c.trustTier === 'platform_verified',
    );
    expect(verified).toBeDefined();
    const revised = await call('PATCH', `/v1/organizations/${org}/claims/${verified?.id}`, {
      expectedVersion: verified?.version,
      statement: `${verified?.statement} (wording clarified)`,
    });
    expect(revised.statusCode).toBe(200);
    expect(revised.json()).toMatchObject({ status: 'published' });
    expect(revised.json().trustTier).not.toBe('platform_verified');
  });
});
