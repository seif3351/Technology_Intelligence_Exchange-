import { describe, expect, it } from 'vitest';
import {
  ORGANIZATION_VERIFICATION_STATES,
  type Invitation,
  asId,
  invitationStatus,
  isPubliclyListed,
  normalizeEmail,
} from '../src';

const now = new Date('2026-10-01T12:00:00Z');
const invitation = (overrides: Partial<Invitation> = {}): Invitation => ({
  id: asId('00000000-0000-4000-8000-000000000010'),
  email: 'a@example.com',
  organizationId: null,
  role: null,
  tokenHash: 'h',
  invitedBy: asId('00000000-0000-4000-8000-000000000011'),
  expiresAt: new Date('2026-10-02T12:00:00Z'),
  acceptedAt: null,
  acceptedBy: null,
  revokedAt: null,
  createdAt: new Date('2026-09-30T12:00:00Z'),
  ...overrides,
});

describe('public listing rule (ADR 0011)', () => {
  it('lists only platform-verified organizations', () => {
    const listed = ORGANIZATION_VERIFICATION_STATES.filter((state) =>
      isPubliclyListed({ verificationState: state }),
    );
    expect(listed).toEqual(['verified']);
  });
});

describe('invitations', () => {
  it('is pending until accepted, revoked or expired', () => {
    expect(invitationStatus(invitation(), now)).toBe('pending');
    expect(invitationStatus(invitation({ acceptedAt: now }), now)).toBe('accepted');
    expect(invitationStatus(invitation({ revokedAt: now }), now)).toBe('revoked');
    expect(invitationStatus(invitation({ expiresAt: now }), now)).toBe('expired');
  });

  it('normalizes emails for matching', () => {
    expect(normalizeEmail('  Founder@Helix.Example ')).toBe('founder@helix.example');
  });
});
