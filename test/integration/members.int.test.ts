import type { Runtime } from '@atx/runtime';
import { DEMO, createTestRuntime } from '@atx/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpHarness, linkToken } from './http';

let runtime: Runtime;
let http: Awaited<ReturnType<typeof createHttpHarness>>;
let owner: string;
const org = DEMO.orgs.vectorforge;
const PASSWORD = 'demo-password-2026';
const lastMailTo = (email: string) =>
  [...(runtime.mailbox?.messages ?? [])].reverse().find((m) => m.to === email);

beforeAll(async () => {
  runtime = await createTestRuntime();
  http = await createHttpHarness(runtime);
  owner = await http.login('owner@vectorforge.example', PASSWORD);
});
afterAll(async () => {
  await http.server.close();
  await runtime.close();
});

const members = async (token: string) =>
  (await http.get(`/v1/organizations/${org}/members`, token)).json().items as {
    userId: string;
    email: string;
    role: string;
  }[];

describe('organization invitations', () => {
  let editorToken: string;

  it('lets an owner invite a new colleague, who joins by registering with the emailed link', async () => {
    const invited = await http.post(
      `/v1/organizations/${org}/invitations`,
      { email: 'engineer@vectorforge.example', role: 'editor' },
      owner,
    );
    expect(invited.statusCode).toBe(201);
    expect(invited.json().emailed).toBe(true);
    const mail = lastMailTo('engineer@vectorforge.example');
    expect(mail?.subject).toContain('VectorForge');

    const preview = await http.post('/v1/invitations/lookup', { token: linkToken(mail?.text ?? '') });
    expect(preview.json()).toMatchObject({
      organizationName: expect.stringContaining('VectorForge'),
      role: 'editor',
    });

    const registered = await http.post('/v1/auth/register', {
      email: 'engineer@vectorforge.example',
      password: 'an-engineer-password',
      displayName: 'Engineer',
      acceptTerms: true,
      invitationToken: linkToken(mail?.text ?? ''),
    });
    expect(registered.statusCode).toBe(201);
    editorToken = registered.json().accessToken as string;
    const me = (await http.get('/v1/me', editorToken)).json();
    expect(me.user.emailVerified).toBe(true);
    expect(me.memberships).toEqual([expect.objectContaining({ organizationId: org, role: 'editor' })]);
  });

  it('refuses invitations from non-admins and above the inviter’s own role', async () => {
    const byEditor = await http.post(
      `/v1/organizations/${org}/invitations`,
      { email: 'x@example.com', role: 'viewer' },
      editorToken,
    );
    expect(byEditor.statusCode).toBe(403);

    const engineer = (await members(owner)).find((m) => m.email === 'engineer@vectorforge.example');
    await http.server.inject({
      method: 'PATCH',
      url: `/v1/organizations/${org}/members/${engineer?.userId}`,
      payload: { role: 'admin' },
      headers: { authorization: `Bearer ${owner}` },
    });
    const ownerByAdmin = await http.post(
      `/v1/organizations/${org}/invitations`,
      { email: 'boss@example.com', role: 'owner' },
      editorToken,
    );
    expect(ownerByAdmin.statusCode).toBe(403);
  });

  it('lets an existing user accept an invitation addressed to their email only', async () => {
    const invited = await http.post(
      `/v1/organizations/${org}/invitations`,
      { email: 'owner@northstar-ai.example', role: 'viewer' },
      owner,
    );
    const token = new URL(invited.json().url as string).searchParams.get('invite') ?? '';

    const someoneElse = await http.login('owner@drivemesh.example', PASSWORD);
    expect((await http.post('/v1/invitations/accept', { token }, someoneElse)).statusCode).toBe(403);

    const northstar = await http.login('owner@northstar-ai.example', PASSWORD);
    const accepted = await http.post('/v1/invitations/accept', { token }, northstar);
    expect(accepted.statusCode).toBe(200);
    const me = (await http.get('/v1/me', northstar)).json();
    expect(me.memberships.map((m: { organizationId: string }) => m.organizationId)).toContain(org);
    expect((await http.post('/v1/invitations/accept', { token }, northstar)).statusCode).toBe(403);
  });

  it('can be revoked by admins of the same organization only', async () => {
    const invited = await http.post(
      `/v1/organizations/${org}/invitations`,
      { email: 'temp@example.com', role: 'viewer' },
      owner,
    );
    const id = invited.json().invitation.id as string;
    const outsider = await http.login('owner@drivemesh.example', PASSWORD);
    expect(
      (await http.post(`/v1/organizations/${org}/invitations/${id}/revoke`, {}, outsider)).statusCode,
    ).toBe(403);
    expect(
      (await http.post(`/v1/organizations/${DEMO.orgs.drivemesh}/invitations/${id}/revoke`, {}, outsider))
        .statusCode,
    ).toBe(404);
    expect((await http.post(`/v1/organizations/${org}/invitations/${id}/revoke`, {}, owner)).statusCode).toBe(
      200,
    );
    const list = (await http.get(`/v1/organizations/${org}/invitations`, owner)).json().items;
    expect(list.find((i: { id: string }) => i.id === id).status).toBe('revoked');
  });
});

describe('member administration', () => {
  const patch = (userId: string, role: string, token: string) =>
    http.server.inject({
      method: 'PATCH',
      url: `/v1/organizations/${org}/members/${userId}`,
      payload: { role },
      headers: { authorization: `Bearer ${token}` },
    });
  const remove = (userId: string, token: string) =>
    http.server.inject({
      method: 'DELETE',
      url: `/v1/organizations/${org}/members/${userId}`,
      headers: { authorization: `Bearer ${token}` },
    });

  it('hides the member list from other organizations', async () => {
    const outsider = await http.login('buyer@aurelia-motors.example', PASSWORD);
    expect((await http.get(`/v1/organizations/${org}/members`, outsider)).statusCode).toBe(403);
  });

  it('always keeps at least one owner', async () => {
    expect((await patch(DEMO.users.vectorforge, 'admin', owner)).statusCode).toBe(422);
    expect((await remove(DEMO.users.vectorforge, owner)).statusCode).toBe(422);
  });

  it('only lets owners change owners, then lets a former owner leave', async () => {
    const engineer = (await members(owner)).find((m) => m.email === 'engineer@vectorforge.example');
    const admin = await http.login('engineer@vectorforge.example', 'an-engineer-password');
    expect((await patch(DEMO.users.vectorforge, 'viewer', admin)).statusCode).toBe(403);
    expect((await patch(engineer?.userId ?? '', 'owner', owner)).statusCode).toBe(200);
    expect((await remove(DEMO.users.vectorforge, owner)).statusCode).toBe(200);
    // The change applies to the next request: no stale role in old sessions.
    expect((await http.get(`/v1/organizations/${org}/members`, owner)).statusCode).toBe(403);
    const { rows } = await runtime.pool.query(
      "SELECT action FROM audit_events WHERE organization_id = $1 AND action LIKE 'membership.%' ORDER BY occurred_at",
      [org],
    );
    expect(rows.map((r) => r['action'])).toEqual(
      expect.arrayContaining(['membership.role_change', 'membership.leave']),
    );
  });
});
