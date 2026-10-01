import { loadTestOntology } from '@atx/test-utils';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { createAiProfileDraftGenerator, createAiRequirementExtractor } from '../src';
import { LlmUnavailableError, type StructuredLlm } from '../src/llm';

/** Fake LLM returning a canned object (validated by the real schema, as the SDK would). */
const fakeLlm = (output: unknown, captured: { content?: string } = {}): StructuredLlm => ({
  name: 'fake',
  async generate<T extends z.ZodType>(request: {
    readonly untrustedContent: string;
    readonly schema: T;
  }): Promise<z.infer<T>> {
    captured.content = request.untrustedContent;
    return request.schema.parse(output);
  },
});

const failingLlm: StructuredLlm = {
  name: 'failing',
  generate: async () => {
    throw new LlmUnavailableError('refused');
  },
};

const SOURCE = [
  'Our stack supports QNX 7.1 on NVIDIA DRIVE Orin.',
  'The toolchain is designed for ASIL-B projects.',
  'We plan to support Zephyr in the future.',
].join('\n');

describe('AI profile draft generator', () => {
  it('keeps grounded proposals, drops hallucinated ones and never upgrades the quoted wording', async () => {
    const ontology = await loadTestOntology();
    const generator = createAiProfileDraftGenerator(
      fakeLlm({
        claims: [
          {
            conceptId: 'qnx',
            predicate: 'SUPPORTS',
            quote: 'Our stack supports QNX 7.1 on NVIDIA DRIVE Orin.',
            asil: null,
            certificationBody: null,
          },
          // Upgrade attempt: quote says "designed for", model claims certification.
          {
            conceptId: 'asil',
            predicate: 'CERTIFIED',
            quote: 'The toolchain is designed for ASIL-B projects.',
            asil: 'B',
            certificationBody: 'Made-up Body',
          },
          // Hallucination: quote not in the source.
          {
            conceptId: 'iso-26262',
            predicate: 'CERTIFIED',
            quote: 'Certified by a notified body for ISO 26262.',
            asil: null,
            certificationBody: 'X',
          },
          // Unknown concept id.
          {
            conceptId: 'warp-drive',
            predicate: 'SUPPORTS',
            quote: 'Our stack supports QNX 7.1 on NVIDIA DRIVE Orin.',
            asil: null,
            certificationBody: null,
          },
          // Planned capability (negation/roadmap cue) is not a claim.
          {
            conceptId: 'zephyr',
            predicate: 'SUPPORTS',
            quote: 'We plan to support Zephyr in the future.',
            asil: null,
            certificationBody: null,
          },
        ],
        summary: 'Middleware stack for QNX on Orin.',
      }),
    );
    const draft = await generator.generate({ sourceText: SOURCE, ontology });
    expect(draft.method).toBe('ai_assisted');
    const byConcept = new Map(draft.claims.map((c) => [`${c.conceptId}:${c.predicate}`, c]));
    expect(byConcept.has('qnx:SUPPORTS')).toBe(true);
    expect(byConcept.has('asil:DESIGNED_FOR')).toBe(true);
    expect(draft.claims.some((c) => c.predicate === 'CERTIFIED')).toBe(false);
    expect(draft.claims.some((c) => c.conceptId === 'iso-26262' || c.conceptId === 'zephyr')).toBe(false);
  });

  it('falls back to the deterministic draft when the model fails', async () => {
    const ontology = await loadTestOntology();
    const draft = await createAiProfileDraftGenerator(failingLlm).generate({ sourceText: SOURCE, ontology });
    expect(draft.method).toBe('deterministic');
    expect(draft.claims.find((c) => c.conceptId === 'asil')?.predicate).toBe('DESIGNED_FOR');
  });
});

describe('AI requirement extractor', () => {
  it('only adds valid ontology concepts on top of the deterministic baseline', async () => {
    const ontology = await loadTestOntology();
    const extractor = createAiRequirementExtractor(
      fakeLlm({
        constraints: [
          { conceptId: 'hil-testing', level: 'supports', priority: 'preference', asil: null },
          { conceptId: 'not-a-concept', level: 'supports', priority: 'hard', asil: null },
        ],
        minimumMaturity: null,
        productionReferencesRequired: false,
        unrecognizedTerms: [],
      }),
    );
    const result = await extractor.extract('Integration testing on QNX with bench automation', ontology);
    const ids = result.constraints.flatMap((c) => (c.kind === 'concept' ? [c.conceptId] : []));
    expect(result.method).toBe('ai_assisted');
    expect(ids).toEqual(expect.arrayContaining(['integration-testing', 'qnx', 'hil-testing']));
    expect(ids).not.toContain('not-a-concept');
    expect(
      result.constraints.find((c) => c.kind === 'concept' && c.conceptId === 'hil-testing')?.origin,
    ).toBe('extracted_ai');
  });

  it('degrades to deterministic interpretation when the provider is unavailable', async () => {
    const ontology = await loadTestOntology();
    const result = await createAiRequirementExtractor(failingLlm).extract(
      'AUTOSAR Adaptive on QNX',
      ontology,
    );
    expect(result.method).toBe('deterministic');
    expect(result.constraints.length).toBe(2);
  });
});
