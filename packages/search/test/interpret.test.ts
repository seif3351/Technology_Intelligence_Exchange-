import { describe, expect, it } from 'vitest';
import { loadTestOntology } from '@atx/test-utils';
import type { RequirementConstraint } from '@atx/domain';
import { interpretRequirementText } from '../src';

const conceptIds = (constraints: readonly RequirementConstraint[]) =>
  constraints.flatMap((c) => (c.kind === 'concept' ? [c.conceptId] : [])).sort();

describe('interpretRequirementText', () => {
  it('interprets the AUTOSAR Adaptive / QNX / Orin / SOME/IP middleware request', async () => {
    const ontology = await loadTestOntology();
    const result = interpretRequirementText(
      'I need an AUTOSAR Adaptive middleware solution for QNX and NVIDIA Orin with SOME/IP support.',
      ontology,
    );
    expect(conceptIds(result.constraints)).toEqual(
      ['autosar-adaptive', 'middleware', 'nvidia-drive-orin', 'qnx', 'some-ip'].sort(),
    );
    expect(result.constraints.every((c) => c.priority === 'hard')).toBe(true);
  });

  it('distinguishes experience, maturity and production references', async () => {
    const ontology = await loadTestOntology();
    const result = interpretRequirementText(
      'I need production-ready integration testing for an ADAS platform using NVIDIA Orin, QNX, AUTOSAR Adaptive, SOME/IP and Ethernet, with ISO 26262 experience. We want a supplier with production references.',
      ontology,
    );
    const iso = result.constraints.find((c) => c.kind === 'concept' && c.conceptId === 'iso-26262');
    expect(iso).toMatchObject({ level: 'experience', priority: 'hard' });
    const qnx = result.constraints.find((c) => c.kind === 'concept' && c.conceptId === 'qnx');
    expect(qnx).toMatchObject({ level: 'supports' });
    expect(result.constraints.some((c) => c.kind === 'maturity' && c.minimum === 'production')).toBe(true);
    expect(result.constraints.some((c) => c.kind === 'production_reference')).toBe(true);
    expect(conceptIds(result.constraints)).toEqual(
      expect.arrayContaining(['adas', 'integration-testing', 'automotive-ethernet', 'nvidia-drive-orin']),
    );
  });

  it('marks terms after preference cues as preferences', async () => {
    const ontology = await loadTestOntology();
    const result = interpretRequirementText(
      'We need HIL testing on QNX, ideally with SecOC experience.',
      ontology,
    );
    expect(result.constraints.find((c) => c.kind === 'concept' && c.conceptId === 'qnx')?.priority).toBe(
      'hard',
    );
    expect(result.constraints.find((c) => c.kind === 'concept' && c.conceptId === 'secoc')?.priority).toBe(
      'preference',
    );
  });

  it('captures ASIL qualifiers and certification level', async () => {
    const ontology = await loadTestOntology();
    const result = interpretRequirementText('Middleware must be ISO 26262 certified up to ASIL-B.', ontology);
    expect(result.constraints.find((c) => c.kind === 'concept' && c.conceptId === 'iso-26262')).toMatchObject(
      {
        level: 'certified',
      },
    );
    expect(result.constraints.find((c) => c.kind === 'concept' && c.conceptId === 'asil')).toMatchObject({
      qualifiers: { asil: 'B' },
    });
  });

  it('drops broader concepts implied by narrower ones and reports unknown terms', async () => {
    const ontology = await loadTestOntology();
    const result = interpretRequirementText(
      'AUTOSAR and AUTOSAR Adaptive on the ZX9000 controller',
      ontology,
    );
    expect(conceptIds(result.constraints)).toEqual(['autosar-adaptive']);
    expect(result.unrecognizedTerms).toContain('ZX9000');
  });
});

describe('per-concept default levels (ontology data)', () => {
  it('treats a named security mechanism as "supports" but a security standard as "experience"', async () => {
    const ontology = await loadTestOntology();
    const { constraints } = interpretRequirementText(
      'We need a SecOC stack for gateways and ISO/SAE 21434.',
      ontology,
    );
    const level = (conceptId: string) =>
      constraints.find((c) => c.kind === 'concept' && c.conceptId === conceptId) as
        { level: string } | undefined;
    expect(level('secoc')?.level).toBe('supports');
    expect(level('iso-21434')?.level).toBe('experience');
  });
});
