import type { RequirementExtractor } from '@atx/application';
import {
  CONSTRAINT_LEVELS,
  type ConceptConstraint,
  type Ontology,
  type RequirementConstraint,
  asId,
} from '@atx/domain';
import { type InterpretedRequirement, interpretRequirementText } from '@atx/search';
import { z } from 'zod';
import type { StructuredLlm } from './llm';

/** Always-available baseline: ontology lexicon + cue rules. */
export const deterministicRequirementExtractor: RequirementExtractor = {
  async extract(text, ontology) {
    return { ...interpretRequirementText(text, ontology), method: 'deterministic' };
  },
};

const AiConstraints = z.object({
  constraints: z.array(
    z.object({
      conceptId: z.string(),
      level: z.enum(CONSTRAINT_LEVELS),
      priority: z.enum(['hard', 'preference']),
      asil: z.enum(['A', 'B', 'C', 'D']).nullable(),
    }),
  ),
  minimumMaturity: z.enum(['prototype', 'pilot', 'production']).nullable(),
  productionReferencesRequired: z.boolean(),
  unrecognizedTerms: z.array(z.string()),
});

const SYSTEM = `You convert automotive engineering requirements into structured constraints for a technology matching engine.
Use ONLY concept ids from the provided catalog. If a technical term has no matching concept, list it in unrecognizedTerms.
Levels: mentioned (relevant), supports (works with / provides), experience (project experience or process compliance),
certified (third-party certification explicitly required), production (series-production deployment explicitly required).
Mark a constraint "preference" only when the text signals it is optional (ideally, preferably, nice to have).`;

/**
 * LLM-assisted extraction layered on the deterministic baseline. The model can
 * only ADD constraints for valid catalog concepts; deterministic results are
 * kept. Any failure returns the deterministic interpretation.
 */
export const createAiRequirementExtractor = (
  llm: StructuredLlm,
  onFailure?: (error: unknown) => void,
): RequirementExtractor => ({
  async extract(text, ontology) {
    const baseline = interpretRequirementText(text, ontology);
    try {
      const output = await llm.generate({
        system: SYSTEM,
        instructions: `Concept catalog (id | label | facet):\n${catalog(ontology)}\n\nExtract constraints from the requirement below.`,
        untrustedContent: text,
        schema: AiConstraints,
        maxOutputTokens: 4000,
      });
      return { ...merge(baseline, output, ontology), method: 'ai_assisted' };
    } catch (error) {
      onFailure?.(error);
      return { ...baseline, method: 'deterministic' };
    }
  },
});

const catalog = (ontology: Ontology): string =>
  ontology.concepts
    .filter((concept) => concept.status === 'active')
    .map((concept) => `${concept.id} | ${concept.label} | ${concept.facetId}`)
    .join('\n');

const merge = (
  baseline: InterpretedRequirement,
  ai: z.infer<typeof AiConstraints>,
  ontology: Ontology,
): InterpretedRequirement => {
  const constraints: RequirementConstraint[] = [...baseline.constraints];
  const notes = [...baseline.notes];
  const has = (conceptId: string) =>
    constraints.some(
      (c) =>
        c.kind === 'concept' &&
        (c.conceptId === conceptId || ontology.broader(c.conceptId).has(asId(conceptId))),
    );
  for (const item of ai.constraints) {
    if (!ontology.hasConcept(item.conceptId) || has(item.conceptId)) continue;
    const constraint: ConceptConstraint = {
      kind: 'concept',
      id: `c${constraints.length + 1}`,
      conceptId: item.conceptId,
      level: item.level,
      priority: item.priority,
      qualifiers: item.asil ? { asil: item.asil } : {},
      origin: 'extracted_ai',
    };
    constraints.push(constraint);
    notes.push(
      `AI-assisted interpretation added "${ontology.getConcept(item.conceptId)?.label ?? item.conceptId}"`,
    );
  }
  if (ai.minimumMaturity && !constraints.some((c) => c.kind === 'maturity')) {
    constraints.push({
      kind: 'maturity',
      id: `c${constraints.length + 1}`,
      minimum: ai.minimumMaturity,
      priority: 'hard',
      origin: 'extracted_ai',
    });
  }
  if (ai.productionReferencesRequired && !constraints.some((c) => c.kind === 'production_reference')) {
    constraints.push({
      kind: 'production_reference',
      id: `c${constraints.length + 1}`,
      priority: 'hard',
      origin: 'extracted_ai',
    });
  }
  const unrecognized = new Set(
    [...baseline.unrecognizedTerms, ...ai.unrecognizedTerms.map((t) => t.slice(0, 60))].filter(
      (t) => !ontology.resolveTerm(t),
    ),
  );
  return { constraints, unrecognizedTerms: [...unrecognized].slice(0, 20), notes };
};
