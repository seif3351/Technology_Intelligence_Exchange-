import { describe, expect, it } from 'vitest';
import { type ConceptId, Ontology, asId } from '../src';

const facet = { id: asId<'FacetId'>('f'), label: 'F', description: 'F', defaultConstraintLevel: 'supports' as const };
const concept = (id: string, aliases: string[] = []) => ({
  id: asId<'ConceptId'>(id),
  facetId: facet.id,
  label: id,
  description: id,
  aliases,
  status: 'active' as const,
});
const rel = (from: string, to: string, type: 'is_a' | 'part_of' = 'is_a') => ({
  fromConceptId: asId<'ConceptId'>(from),
  toConceptId: asId<'ConceptId'>(to),
  type,
});

describe('Ontology', () => {
  const ontology = new Ontology({
    facets: [facet],
    concepts: [concept('autosar'), concept('autosar-adaptive', ['AUTOSAR Adaptive', 'adaptive autosar']), concept('some-ip', ['SOME/IP'])],
    relations: [rel('autosar-adaptive', 'autosar')],
  });

  it('treats narrower concepts as satisfying broader requirements, not vice versa', () => {
    expect(ontology.satisfies(asId('autosar-adaptive'), asId('autosar'))).toBe(true);
    expect(ontology.satisfies(asId('autosar'), asId('autosar-adaptive'))).toBe(false);
  });

  it('prefers the longest alias when mentions overlap', () => {
    const mentions = ontology.findMentions('We need AUTOSAR Adaptive with SOME/IP.');
    expect(mentions.map((m) => m.conceptId)).toEqual(['autosar-adaptive', 'some-ip'] as ConceptId[]);
  });

  it('rejects is_a cycles and dangling relations', () => {
    expect(
      () =>
        new Ontology({ facets: [facet], concepts: [concept('a'), concept('b')], relations: [rel('a', 'b'), rel('b', 'a')] }),
    ).toThrow(/cycle/);
    expect(() => new Ontology({ facets: [facet], concepts: [concept('a')], relations: [rel('a', 'zzz')] })).toThrow(
      /unknown concept/,
    );
  });
});
