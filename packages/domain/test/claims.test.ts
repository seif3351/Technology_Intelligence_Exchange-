import { describe, expect, it } from 'vitest';
import {
  AppError,
  type Provenance,
  type TechnicalClaim,
  asId,
  createClaim,
  publishClaim,
  reviseClaim,
  trustTier,
  verifyClaim,
} from '../src';

const now = new Date('2026-09-01T00:00:00Z');
const org = asId<'OrganizationId'>('00000000-0000-4000-8000-000000000001');
const user = asId<'UserId'>('00000000-0000-4000-8000-000000000002');

const provenance = (overrides: Partial<Provenance> = {}): Provenance => ({
  category: 'SUPPLIER_VERIFIED',
  sourceType: 'supplier_statement',
  sourceReference: null,
  sourceUrl: null,
  sourceVersion: null,
  license: null,
  evidenceIds: [],
  ...overrides,
});

const draft = (overrides: Partial<Parameters<typeof createClaim>[0]> = {}): TechnicalClaim =>
  createClaim({
    id: asId('00000000-0000-4000-8000-0000000000aa'),
    organizationId: org,
    subject: { type: 'organization', id: org },
    predicate: 'SUPPORTS',
    conceptId: asId('qnx'),
    statement: 'Supports QNX 7.1',
    provenance: provenance(),
    providedBy: { organizationId: org, userId: user, via: 'manual' },
    now,
    ...overrides,
  });

const validationMessages = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error.details.map((detail) => detail.message);
    throw error;
  }
  throw new Error('expected a validation error');
};

describe('technical claims', () => {
  it('creates drafts that are never verified', () => {
    const claim = draft();
    expect(claim.status).toBe('draft');
    expect(claim.verification.status).toBe('unreviewed');
  });

  it('requires a certification body for CERTIFIED claims', () => {
    expect(validationMessages(() => draft({ predicate: 'CERTIFIED', conceptId: asId('iso-26262') }))).toEqual(
      expect.arrayContaining([expect.stringMatching(/certificationBody/)]),
    );
  });

  it('reserves AI_INFERRED provenance for AI extraction', () => {
    expect(validationMessages(() => draft({ provenance: provenance({ category: 'AI_INFERRED' }) }))).toEqual(
      expect.arrayContaining([expect.stringMatching(/AI_INFERRED/)]),
    );
  });

  it('turns an AI draft into a supplier attestation only on explicit human publish, never into platform verification', () => {
    const aiDraft = draft({
      provenance: provenance({ category: 'AI_INFERRED' }),
      providedBy: { organizationId: org, userId: null, via: 'ai_extraction' },
    });
    expect(trustTier(aiDraft.provenance, aiDraft.verification)).toBe('ai_inferred');
    const published = publishClaim(aiDraft, user, now);
    expect(published.provenance.category).toBe('SUPPLIER_VERIFIED');
    expect(published.verification.status).toBe('unreviewed');
    expect(trustTier(published.provenance, published.verification)).toBe('supplier_verified');
  });

  it('requires evidence for platform verification', () => {
    const published = publishClaim(draft(), user, now);
    expect(() => verifyClaim(published, user, 'platform_verified', null, now)).toThrow(/evidence/);
    const withEvidence = publishClaim(
      draft({ provenance: provenance({ evidenceIds: [asId('00000000-0000-4000-8000-0000000000ee')] }) }),
      user,
      now,
    );
    const verified = verifyClaim(withEvidence, user, 'platform_verified', null, now);
    expect(trustTier(verified.provenance, verified.verification)).toBe('platform_verified');
  });

  it('resets verification when a verified claim is substantively edited', () => {
    const verified = verifyClaim(
      publishClaim(
        draft({ provenance: provenance({ evidenceIds: [asId('00000000-0000-4000-8000-0000000000ee')] }) }),
        user,
        now,
      ),
      user,
      'platform_verified',
      null,
      now,
    );
    const edited = reviseClaim(verified, { statement: 'Supports QNX 8.0' }, now);
    expect(edited.verification.status).toBe('unreviewed');
    expect(edited.version).toBe(verified.version + 1);
    const notesOnly = reviseClaim(verified, { notes: 'clarified' }, now);
    expect(notesOnly.verification.status).toBe('platform_verified');
  });

  it('strips control and bidi characters from untrusted statements', () => {
    const claim = draft({ statement: `Supports${String.fromCharCode(0x202e)} QNX${String.fromCharCode(0)}` });
    expect(claim.statement).toBe('Supports QNX');
  });
});
