import { type Offering, type Organization, asId } from '@atx/domain';
import { describe, expect, it } from 'vitest';
import { type Principal, canViewOffering, canViewSupplier } from '../src';

const orgId = asId<'OrganizationId'>('00000000-0000-4000-8000-000000000001');
const offering = { organizationId: orgId, status: 'published' } as Offering;
const org = (verificationState: Organization['verificationState']) =>
  ({ id: orgId, kind: 'supplier', verificationState }) as Organization;
const anonymous: Principal = { kind: 'anonymous', channel: 'api' };
const member = {
  kind: 'user',
  userId: asId('00000000-0000-4000-8000-000000000002'),
  displayName: 'm',
  platformRole: 'none',
  emailVerified: true,
  memberships: [{ organizationId: orgId, organizationKind: 'supplier', role: 'viewer' }],
  scopes: new Set(),
  clientId: null,
  channel: 'api',
} as Principal;

describe('visibility policies', () => {
  it('hides published content of unverified, pending and suspended organizations from outsiders', () => {
    for (const state of ['unverified', 'pending', 'rejected', 'suspended'] as const) {
      expect(canViewOffering(anonymous, offering, org(state))).toBe(false);
      expect(canViewSupplier(anonymous, org(state))).toBe(false);
    }
    expect(canViewOffering(anonymous, offering, org('verified'))).toBe(true);
    expect(canViewSupplier(anonymous, org('verified'))).toBe(true);
  });

  it('lets members preview their own unlisted organization and drafts', () => {
    expect(canViewOffering(member, { ...offering, status: 'draft' }, org('unverified'))).toBe(true);
    expect(canViewSupplier(member, org('pending'))).toBe(true);
  });

  it('never exposes buyer organizations as suppliers', () => {
    expect(canViewSupplier(anonymous, { ...org('verified'), kind: 'buyer' })).toBe(false);
  });
});
