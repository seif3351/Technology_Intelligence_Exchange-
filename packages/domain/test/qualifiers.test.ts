import { describe, expect, it } from 'vitest';
import {
  Ontology,
  asId,
  describeConstraint,
  formatQualifiers,
  meetsOrdinal,
  ordinalValueProblem,
} from '../src';

describe('ordinal qualifiers', () => {
  it('treat required levels as minimums and never assume an unstated level', () => {
    expect(meetsOrdinal('asil', 'D', 'B')).toBe('yes');
    expect(meetsOrdinal('asil', 'A', 'B')).toBe('no');
    expect(meetsOrdinal('asil', 'QM', 'A')).toBe('no');
    expect(meetsOrdinal('aspiceLevel', '3', '2')).toBe('yes');
    expect(meetsOrdinal('aspiceLevel', '1', '2')).toBe('no');
    expect(meetsOrdinal('cal', undefined, '2')).toBe('unknown');
    expect(meetsOrdinal('cal', '4', '4')).toBe('yes');
  });

  it('reject values outside the standard scale', () => {
    expect(ordinalValueProblem('aspiceLevel', '7')).toMatch(/aspiceLevel must be one of 1, 2, 3, 4, 5/);
    expect(ordinalValueProblem('cal', '0')).toMatch(/cal must be one of/);
    expect(ordinalValueProblem('asil', 'B')).toBeNull();
    expect(ordinalValueProblem('certificationBody', 'anything')).toBeNull();
  });

  it('format claim qualifiers as people write them, hiding nothing', () => {
    expect(formatQualifiers({ asil: 'B', certificationBody: 'Example Body' })).toEqual([
      'ASIL B',
      'certified by Example Body',
    ]);
    expect(formatQualifiers({ aspiceLevel: '2', cal: '3' })).toEqual(['CL2', 'CAL 3']);
    expect(formatQualifiers({ release: 'R23-11', sourceDocument: 'manual' })).toEqual([
      'release R23-11',
      'source document: manual',
    ]);
  });
});

describe('describeConstraint', () => {
  const concept = (level: 'mentioned' | 'supports' | 'experience' | 'certified' | 'production', q = {}) => ({
    kind: 'concept' as const,
    id: 'c1',
    conceptId: asId<'ConceptId'>('x'),
    level,
    priority: 'hard' as const,
    qualifiers: q,
    origin: 'user' as const,
  });

  it('phrases every level without softening or strengthening it', () => {
    expect(describeConstraint(concept('supports'), 'QNX')).toBe('Supports QNX');
    expect(describeConstraint(concept('mentioned'), 'QNX')).toBe('Covers QNX');
    expect(describeConstraint(concept('experience'), 'ISO 26262')).toBe('Experience with ISO 26262');
    expect(describeConstraint(concept('certified'), 'ISO/SAE 21434')).toBe('Certified: ISO/SAE 21434');
    expect(describeConstraint(concept('production'), 'AUTOSAR Adaptive')).toBe(
      'In series production: AUTOSAR Adaptive',
    );
  });

  it('reads ordinal qualifiers as minimums', () => {
    expect(describeConstraint(concept('experience', { aspiceLevel: '2' }), 'Automotive SPICE')).toBe(
      'Experience with Automotive SPICE (CL2 or higher)',
    );
    expect(describeConstraint(concept('certified', { asil: 'B' }), 'ASIL')).toBe(
      'Certified: ASIL B or higher',
    );
  });

  it('describes maturity and production references', () => {
    expect(
      describeConstraint({
        kind: 'maturity',
        id: 'm',
        minimum: 'production',
        priority: 'hard',
        origin: 'user',
      }),
    ).toBe('Maturity: production or later');
    expect(
      describeConstraint({ kind: 'production_reference', id: 'p', priority: 'hard', origin: 'user' }),
    ).toBe('Production references');
  });
});

describe('ontology data guards', () => {
  const facet = {
    id: asId<'FacetId'>('f'),
    label: 'F',
    description: 'F',
    defaultConstraintLevel: 'supports' as const,
  };
  const concept = (id: string, extra: Record<string, unknown> = {}) => ({
    id: asId<'ConceptId'>(id),
    facetId: facet.id,
    label: id,
    description: id,
    aliases: [] as string[],
    status: 'active' as const,
    ...extra,
  });

  it('rejects unknown qualifier declarations', () => {
    expect(
      () =>
        new Ontology({
          facets: [facet],
          concepts: [concept('a', { qualifierKeys: ['sil'] })],
          relations: [],
        }),
    ).toThrow(/unknown qualifier "sil"/);
  });

  it('rejects one alias meaning two concepts', () => {
    expect(
      () =>
        new Ontology({
          facets: [facet],
          concepts: [concept('a', { aliases: ['Shared Name'] }), concept('b', { aliases: ['shared-name'] })],
          relations: [],
        }),
    ).toThrow(/Alias "shared name" is used by both a and b/);
  });

  it('exposes declared qualifiers per concept', () => {
    const ontology = new Ontology({
      facets: [facet],
      concepts: [concept('aspice', { qualifierKeys: ['aspiceLevel'] }), concept('qnx')],
      relations: [],
    });
    expect(ontology.qualifierKeysFor(asId('aspice'))).toEqual(['aspiceLevel']);
    expect(ontology.qualifierKeysFor(asId('qnx'))).toEqual([]);
  });
});
