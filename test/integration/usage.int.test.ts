import type { Runtime } from '@atx/runtime';
import { DEMO, contextFor, createTestRuntime } from '@atx/test-utils';
import { drainJobs } from '@atx/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpHarness } from './http';

let runtime: Runtime;
let http: Awaited<ReturnType<typeof createHttpHarness>>;
const PASSWORD = 'demo-password-2026';
const mailsTo = (email: string) => (runtime.mailbox?.messages ?? []).filter((m) => m.to === email);

beforeAll(async () => {
  runtime = await createTestRuntime();
  http = await createHttpHarness(runtime);
  await drainJobs(runtime); // seed-time indexing jobs
});
afterAll(async () => {
  await http.server.close();
  await runtime.close();
});

describe('shortlist export', () => {
  it('returns a CSV with per-constraint status and evidence basis', async () => {
    const response = await http.post('/v1/matches/export', {
      text: 'AUTOSAR Adaptive middleware for QNX with SOME/IP',
      limit: 5,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/csv/);
    expect(response.headers['content-disposition']).toMatch(/attachment/);
    const [header, first] = response.body.replace(String.fromCharCode(0xfeff), '').split('\r\n');
    expect(header).toContain('"Hard constraints"');
    expect(header).toMatch(/AUTOSAR Adaptive.*\[hard\]/);
    expect(first).toContain('"VectorForge Adaptive Middleware"');
    expect(first).toMatch(/met — /);
    expect(first).toContain('/offerings/');
  });
});

describe('saved-requirement alerts', () => {
  const buyerEmail = 'buyer@aurelia-motors.example';
  let requirementId: string;

  it('emails the watcher once when a newly listed offering meets all hard constraints', async () => {
    const buyer = await contextFor(runtime, DEMO.users.buyer);
    const { requirement } = await runtime.app.requirements.createDraft(buyer, DEMO.orgs.aurelia, {
      title: 'Gateway security stack',
      description: 'Secure onboard communication for our central gateway.',
      constraints: [
        {
          kind: 'concept',
          id: 'c1',
          conceptId: 'secoc' as never,
          level: 'supports',
          priority: 'hard',
          qualifiers: {},
          origin: 'user',
        },
        {
          kind: 'concept',
          id: 'c2',
          conceptId: 'nxp-s32g' as never,
          level: 'supports',
          priority: 'hard',
          qualifiers: {},
          origin: 'user',
        },
      ],
    });
    requirementId = requirement.id;
    const session = await http.login(buyerEmail, PASSWORD);
    const enabled = await http.server.inject({
      method: 'PUT',
      url: `/v1/organizations/${DEMO.orgs.aurelia}/requirements/${requirementId}/alerts`,
      payload: { enabled: true },
      headers: { authorization: `Bearer ${session}` },
    });
    expect(enabled.json()).toEqual({ enabled: true });

    // A verified supplier publishes a matching offering.
    const supplier = await contextFor(runtime, DEMO.users.northstar);
    const offering = await runtime.app.supplier.createOffering(supplier, DEMO.orgs.northstar, {
      slug: 'northstar-secoc-gateway',
      type: 'product',
      name: 'Northstar SecOC Gateway Stack',
      summary: 'SecOC stack for NXP S32G gateways (synthetic test offering).',
      description: '',
      maturity: 'production',
      details: { type: 'product', currentVersion: null, licensingModel: null, deploymentModels: [] },
      commercial: { pricingModel: null, availability: [], notes: null },
      regions: [],
    });
    for (const conceptId of ['secoc', 'nxp-s32g']) {
      const claim = await runtime.app.supplier.addClaim(supplier, DEMO.orgs.northstar, {
        subject: { type: 'offering', id: offering.id },
        predicate: 'SUPPORTS',
        conceptId,
        statement: `Supports ${conceptId}.`,
      });
      await runtime.app.supplier.publishClaim(supplier, DEMO.orgs.northstar, claim.id, claim.version);
    }
    await runtime.app.supplier.setOfferingStatus(supplier, DEMO.orgs.northstar, offering.id, 'published', 1);

    const before = mailsTo(buyerEmail).length;
    await drainJobs(runtime); // reindex -> newly listed -> requirement.alerts
    const alerts = mailsTo(buyerEmail).slice(before);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.subject).toMatch(/New match for your saved requirement/);
    expect(alerts[0]?.text).toContain('Northstar SecOC Gateway Stack');
    expect(alerts[0]?.text).toContain(`/offerings/${offering.id}`);
    // The supplier learns nothing about the buyer's requirement.
    expect(mailsTo('owner@northstar-ai.example').some((m) => m.text.includes('Gateway security stack'))).toBe(
      false,
    );

    // Re-running the job does not alert twice.
    await runtime.app.requirementAlerts.alertForNewOffering(
      { principal: { kind: 'system', component: 'test' }, requestId: 'again' },
      offering.id,
    );
    expect(mailsTo(buyerEmail).slice(before)).toHaveLength(1);
  });

  it('is opt-in, tenant-private and can be switched off', async () => {
    const outsider = await http.login('owner@vectorforge.example', PASSWORD);
    const foreign = await http.get(
      `/v1/organizations/${DEMO.orgs.aurelia}/requirements/${requirementId}/alerts`,
      outsider,
    );
    expect(foreign.statusCode).toBe(403);
    const session = await http.login(buyerEmail, PASSWORD);
    const off = await http.server.inject({
      method: 'PUT',
      url: `/v1/organizations/${DEMO.orgs.aurelia}/requirements/${requirementId}/alerts`,
      payload: { enabled: false },
      headers: { authorization: `Bearer ${session}` },
    });
    expect(off.json()).toEqual({ enabled: false });
    await expect(
      runtime.app.requirementAlerts.alertForNewOffering(
        await contextFor(runtime, DEMO.users.buyer),
        DEMO.offerings.northstarItp,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
