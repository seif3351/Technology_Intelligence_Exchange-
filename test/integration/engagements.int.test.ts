import type { Runtime } from '@atx/runtime';
import { DEMO, createTestRuntime } from '@atx/test-utils';
import { drainJobs } from '@atx/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpHarness } from './http';

let runtime: Runtime;
let http: Awaited<ReturnType<typeof createHttpHarness>>;
const PASSWORD = 'demo-password-2026';
const mailsTo = (email: string) => (runtime.mailbox?.messages ?? []).filter((m) => m.to === email);
const SECRET_MESSAGE = 'Our gateway integration timeline is confidential; please propose a demo slot.';

beforeAll(async () => {
  runtime = await createTestRuntime();
  http = await createHttpHarness(runtime);
});
afterAll(async () => {
  await http.server.close();
  await runtime.close();
});

const respond = (engagementId: string, token: string, body: Record<string, unknown>) =>
  http.post(`/v1/organizations/${DEMO.orgs.northstar}/engagements/${engagementId}/respond`, body, token);

describe('engagement notifications and contact handover', () => {
  let engagementId: string;
  let buyer: string;
  let supplier: string;

  it('emails the supplier responders about a new request, without its content', async () => {
    buyer = await http.login('buyer@aurelia-motors.example', PASSWORD);
    supplier = await http.login('owner@northstar-ai.example', PASSWORD);
    const draft = {
      buyerOrganizationId: DEMO.orgs.aurelia,
      offeringId: DEMO.offerings.northstarItp,
      type: 'demo',
      message: SECRET_MESSAGE,
      contactName: 'Sam Keller',
      contactEmail: 'sam.keller@aurelia-motors.example',
    };
    const prepared = await http.post('/v1/engagements/prepare', draft, buyer);
    expect(prepared.statusCode).toBe(200);
    const confirmed = await http.post(
      '/v1/engagements',
      { ...draft, confirmationToken: prepared.json().confirmationToken, idempotencyKey: 'notify-test-0001' },
      buyer,
    );
    expect(confirmed.statusCode).toBe(201);
    engagementId = confirmed.json().engagement.id as string;

    await drainJobs(runtime);
    const [mail] = mailsTo('owner@northstar-ai.example');
    expect(mail?.subject).toMatch(/New demo request/);
    expect(mail?.text).toContain('/workspace');
    // The email carries metadata and a link only; the request stays in the app.
    expect(mail?.text).not.toContain('confidential');
  });

  it('requires a contact person to acknowledge, and only the addressed supplier can respond', async () => {
    expect((await respond(engagementId, supplier, { status: 'acknowledged' })).statusCode).toBe(422);
    const other = await http.login('owner@vectorforge.example', PASSWORD);
    const foreign = await http.post(
      `/v1/organizations/${DEMO.orgs.vectorforge}/engagements/${engagementId}/respond`,
      { status: 'acknowledged', contactName: 'X', contactEmail: 'x@vectorforge.example' },
      other,
    );
    expect(foreign.statusCode).toBe(404);
  });

  it('hands the supplier contact over to the buyer and notifies the buyer contact', async () => {
    const acknowledged = await respond(engagementId, supplier, {
      status: 'acknowledged',
      message: 'Happy to show the platform; two slots next week.',
      contactName: 'Nora Northstar',
      contactEmail: 'Nora@Northstar-AI.example',
    });
    expect(acknowledged.statusCode).toBe(200);
    expect(acknowledged.json().supplierResponse).toMatchObject({ contactEmail: 'nora@northstar-ai.example' });

    const outgoing = await http.get(
      `/v1/organizations/${DEMO.orgs.aurelia}/engagements?direction=outgoing`,
      buyer,
    );
    const item = outgoing.json().items.find((e: { id: string }) => e.id === engagementId);
    expect(item).toMatchObject({
      status: 'acknowledged',
      supplierResponse: { contactName: 'Nora Northstar', contactEmail: 'nora@northstar-ai.example' },
    });

    await drainJobs(runtime);
    const [mail] = mailsTo('sam.keller@aurelia-motors.example');
    expect(mail?.subject).toMatch(/accepted your demo request/);
    expect(mail?.text).toContain('/buyer/requests');

    // Responding twice is rejected (no silent overwrite of what the buyer saw).
    expect(
      (await respond(engagementId, supplier, { status: 'declined', message: 'Changed our mind' })).statusCode,
    ).toBe(422);
    const { rows } = await runtime.pool.query(
      "SELECT 1 FROM audit_events WHERE action = 'engagement.acknowledged' AND resource_id = $1",
      [engagementId],
    );
    expect(rows).toHaveLength(1);
  });
});
