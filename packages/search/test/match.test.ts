import { describe, expect, it } from 'vitest';
import { loadTestOntology } from '@atx/test-utils';
import {
  type ClaimPredicate,
  type ConceptConstraint,
  type Offering,
  type ProvenanceCategory,
  type TechnicalClaim,
  asId,
  createClaim,
  publishClaim,
} from '@atx/domain';
import { type MatchCandidate, compareMatches, evaluateCandidate } from '../src';

const now = new Date('2026-09-01T00:00:00Z');
const org = asId<'OrganizationId'>('00000000-0000-4000-8000-000000000001');
const offeringId = asId<'OfferingId'>('00000000-0000-4000-8000-000000000002');
let counter = 0;

const claim = (
  conceptId: string,
  predicate: ClaimPredicate,
  options: { category?: ProvenanceCategory; qualifiers?: Record<string, string>; publish?: boolean } = {},
): TechnicalClaim => {
  const draft = createClaim({
    id: asId(`00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`),
    organizationId: org,
    subject: { type: 'offering', id: offeringId },
    predicate,
    conceptId: asId(conceptId),
    qualifiers:
      options.qualifiers ?? (predicate === 'CERTIFIED' ? { certificationBody: 'Example Cert Body' } : {}),
    statement: `${predicate} ${conceptId}`,
    provenance: {
      category: options.category ?? 'SUPPLIER_VERIFIED',
      sourceType: 'supplier_statement',
      sourceReference: null,
      sourceUrl: null,
      sourceVersion: null,
      license: null,
      evidenceIds: [],
    },
    providedBy: {
      organizationId: org,
      userId: null,
      via: options.category === 'AI_INFERRED' ? 'ai_extraction' : 'manual',
    },
    now,
  });
  return options.publish === false
    ? draft
    : { ...publishClaim(draft, asId('u'), now), provenance: draft.provenance };
};

const offering = (overrides: Partial<Offering> = {}): Offering => ({
  id: offeringId,
  organizationId: org,
  slug: 'mw',
  type: 'product',
  name: 'Middleware X',
  summary: 'A middleware product',
  description: '',
  maturity: 'production',
  details: { type: 'product', currentVersion: null, licensingModel: null, deploymentModels: [] },
  commercial: { pricingModel: null, availability: [], notes: null },
  regions: [],
  status: 'published',
  isDemo: true,
  publishedAt: now,
  publishedBy: null,
  version: 1,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const candidate = (claims: TechnicalClaim[], overrides: Partial<MatchCandidate> = {}): MatchCandidate => ({
  offering: offering(),
  organization: { id: org, name: 'Org', verificationState: 'verified' },
  claims,
  hasProductionReferenceEvidence: false,
  textRelevance: 0.5,
  ...overrides,
});

const constraint = (
  conceptId: string,
  level: ConceptConstraint['level'] = 'supports',
  priority: ConceptConstraint['priority'] = 'hard',
  qualifiers: Record<string, string> = {},
): ConceptConstraint => ({
  kind: 'concept',
  id: `c-${conceptId}`,
  conceptId: asId(conceptId),
  level,
  priority,
  qualifiers,
  origin: 'user',
});

describe('evaluateCandidate', () => {
  it('never lets "designed for" satisfy a certification requirement', async () => {
    const ontology = await loadTestOntology();
    const result = evaluateCandidate(
      candidate([claim('asil', 'DESIGNED_FOR', { qualifiers: { asil: 'B' } })]),
      [constraint('asil', 'certified', 'hard', { asil: 'B' })],
      ontology,
      now,
    );
    expect(result.assessments[0]?.status).toBe('partial');
    expect(result.hardConstraintStatus).toBe('some_unknown');
    expect(result.gaps[0]?.kind).toBe('weaker_than_required');
  });

  it('satisfies a broad requirement with a narrower claim but not the reverse', async () => {
    const ontology = await loadTestOntology();
    const narrow = evaluateCandidate(
      candidate([claim('autosar-adaptive', 'IMPLEMENTS')]),
      [constraint('autosar')],
      ontology,
      now,
    );
    expect(narrow.assessments[0]?.status).toBe('met');
    const broad = evaluateCandidate(
      candidate([claim('autosar', 'SUPPORTS')]),
      [constraint('autosar-adaptive')],
      ontology,
      now,
    );
    expect(broad.assessments[0]?.status).toBe('partial');
  });

  it('reports unknown (not unmet) when there is no information', async () => {
    const ontology = await loadTestOntology();
    const result = evaluateCandidate(candidate([]), [constraint('qnx')], ontology, now);
    expect(result.assessments[0]?.status).toBe('unknown');
    expect(result.gaps[0]?.kind).toBe('missing_information');
  });

  it('ignores draft claims', async () => {
    const ontology = await loadTestOntology();
    const result = evaluateCandidate(
      candidate([claim('qnx', 'SUPPORTS', { publish: false })]),
      [constraint('qnx')],
      ontology,
      now,
    );
    expect(result.assessments[0]?.status).toBe('unknown');
  });

  it('marks maturity below minimum as unmet and ranks it below unknowns', async () => {
    const ontology = await loadTestOntology();
    const prototype = evaluateCandidate(
      candidate([claim('qnx', 'SUPPORTS')], {
        offering: offering({ maturity: 'prototype' }),
        textRelevance: 1,
      }),
      [
        constraint('qnx'),
        { kind: 'maturity', id: 'm', minimum: 'production', priority: 'hard', origin: 'user' },
      ],
      ontology,
      now,
    );
    expect(prototype.hardConstraintStatus).toBe('some_unmet');
    const unknown = evaluateCandidate(
      candidate([], { textRelevance: 0 }),
      [
        constraint('qnx'),
        { kind: 'maturity', id: 'm', minimum: 'production', priority: 'hard', origin: 'user' },
      ],
      ontology,
      now,
    );
    const ranked = [
      { match: prototype, tieBreakName: 'A' },
      { match: unknown, tieBreakName: 'B' },
    ].sort(compareMatches);
    expect(ranked[0]?.match).toBe(unknown);
  });

  it('exposes a score that is exactly the weighted sum of its components', async () => {
    const ontology = await loadTestOntology();
    const result = evaluateCandidate(
      candidate([claim('qnx', 'SUPPORTS'), claim('some-ip', 'IMPLEMENTS', { category: 'AI_INFERRED' })]),
      [constraint('qnx'), constraint('some-ip'), constraint('secoc', 'supports', 'preference')],
      ontology,
      now,
    );
    const sum = result.scoreComponents.reduce((acc, c) => acc + c.weight * c.value, 0);
    expect(result.score).toBeCloseTo(sum, 2);
    expect(result.gaps.some((gap) => gap.kind === 'unverified')).toBe(true);
    expect(result.confidence).not.toBe('high');
  });
});

describe('ordinal qualifiers in matching', () => {
  const aspiceCl2 = () => constraint('aspice', 'experience', 'hard', { aspiceLevel: '2' });

  it('meets "ASPICE CL2 or higher" only with a claim that states CL2 or higher', async () => {
    const ontology = await loadTestOntology();
    const cl3 = evaluateCandidate(
      candidate([claim('aspice', 'PROCESS_COMPLIANT', { qualifiers: { aspiceLevel: '3' } })]),
      [aspiceCl2()],
      ontology,
      now,
    );
    expect(cl3.assessments[0]).toMatchObject({
      status: 'met',
      description: 'Experience with Automotive SPICE (CL2 or higher)',
    });
  });

  it('is partial (never met) when the claim states a lower level or none', async () => {
    const ontology = await loadTestOntology();
    const cl1 = evaluateCandidate(
      candidate([claim('aspice', 'PROCESS_COMPLIANT', { qualifiers: { aspiceLevel: '1' } })]),
      [aspiceCl2()],
      ontology,
      now,
    );
    expect(cl1.assessments[0]?.status).toBe('partial');
    expect(cl1.assessments[0]?.explanation).toContain('the claim states CL1, not CL2 or higher');
    const unstated = evaluateCandidate(
      candidate([claim('aspice', 'PROCESS_COMPLIANT')]),
      [aspiceCl2()],
      ontology,
      now,
    );
    expect(unstated.assessments[0]?.status).toBe('partial');
    expect(unstated.assessments[0]?.explanation).toContain(
      'does not state the Automotive SPICE capability level',
    );
    expect(unstated.gaps[0]?.suggestedQuestion).toContain(
      '"Experience with Automotive SPICE (CL2 or higher)"',
    );
  });

  it('phrases unknowns briefly and asks suppliers plain questions', async () => {
    const ontology = await loadTestOntology();
    const result = evaluateCandidate(candidate([]), [constraint('qnx')], ontology, now);
    expect(result.assessments[0]?.explanation).toBe(
      'No published information about QNX (unknown, not unsupported).',
    );
    expect(result.gaps[0]?.suggestedQuestion).toBe(
      'Does Middleware X meet "Supports QNX"? Please share supporting documentation.',
    );
  });
});
