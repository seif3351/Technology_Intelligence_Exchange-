import type { ProfileDraft, ProposedClaim, SupplierProfileDraftGenerator } from '@atx/application';
import { CLAIM_PREDICATES, type Ontology, asId, normalizeForMatching } from '@atx/domain';
import { extractOrdinalQualifiers, inferClaimPredicate, qualifierWindow, splitSentences } from '@atx/search';
import { z } from 'zod';
import type { StructuredLlm } from './llm';

const MAX_QUOTE = 400;
/** Portion of a document sent to the LLM; the deterministic pass always covers the whole text. */
const LLM_CHAR_BUDGET = 60_000;

/** Lexicon + cue-word drafting. Conservative by design: the weakest matching predicate wins. */
export const deterministicProfileDraftGenerator: SupplierProfileDraftGenerator = {
  async generate({ sourceText, ontology }) {
    return {
      claims: deterministicClaims(sourceText, ontology),
      suggestedSummary: null,
      method: 'deterministic',
    };
  },
};

const deterministicClaims = (sourceText: string, ontology: Ontology): ProposedClaim[] => {
  const proposals = new Map<string, ProposedClaim>();
  for (const sentence of splitSentences(sourceText)) {
    const mentions = ontology.findMentions(sentence);
    // findMentions reports offsets into this exact normalized form.
    const normalized = ` ${normalizeForMatching(ontology.maskCaseMismatches(sentence))} `;
    for (const [index, mention] of mentions.entries()) {
      const concept = ontology.getConcept(mention.conceptId);
      if (!concept) continue;
      const inference = inferClaimPredicate(sentence, concept.facetId);
      if (!inference) continue;
      const key = `${concept.id}:${inference.predicate}`;
      if (proposals.has(key)) continue;
      const body = /\b(TÜV|TUV|SGS|DEKRA|exida|UL)\b/i.exec(sentence)?.[1];
      proposals.set(key, {
        conceptId: concept.id,
        predicate: inference.predicate,
        qualifiers: {
          // Levels (ASIL, ASPICE CL, CAL) only where the ontology declares them, read next to the mention.
          ...extractOrdinalQualifiers(
            qualifierWindow(normalized, mention, mentions[index + 1]),
            ontology.qualifierKeysFor(concept.id),
          ),
          ...(inference.predicate === 'CERTIFIED' && body ? { certificationBody: body } : {}),
        },
        quote: sentence.slice(0, MAX_QUOTE),
      });
    }
  }
  return [...proposals.values()];
};

/**
 * Keeps an AI-proposed level (ASIL, ASPICE CL, CAL) only when the concept
 * declares it and the quote itself states exactly that level, so the model can
 * never strengthen a claim beyond its source.
 */
const groundedLevels = (
  claim: {
    readonly asil: string | null;
    readonly aspiceLevel?: string | null | undefined;
    readonly cal?: string | null | undefined;
  },
  quote: string,
  keys: readonly string[],
): Record<string, string> => {
  const proposed: Record<string, string | null> = {
    asil: claim.asil,
    aspiceLevel: claim.aspiceLevel ?? null,
    cal: claim.cal ?? null,
  };
  const stated = extractOrdinalQualifiers(` ${normalizeForMatching(quote)} `, keys);
  return Object.fromEntries(
    keys.flatMap((key) => {
      const value = proposed[key];
      return value && stated[key] === value ? [[key, value]] : [];
    }),
  );
};

const AiDraft = z.object({
  claims: z.array(
    z.object({
      conceptId: z.string(),
      predicate: z.enum(CLAIM_PREDICATES),
      quote: z.string(),
      asil: z.enum(['QM', 'A', 'B', 'C', 'D']).nullable(),
      // Optional: models often omit null fields, and an omitted level must never fail the whole draft.
      aspiceLevel: z.enum(['1', '2', '3', '4', '5']).nullish(),
      cal: z.enum(['1', '2', '3', '4']).nullish(),
      certificationBody: z.string().nullable(),
    }),
  ),
  summary: z.string().nullable(),
});

const SYSTEM = `You draft structured technical claims from supplier documentation for human review.
Every claim must be supported by a VERBATIM quote copied from the content. Use only concept ids from the catalog.
Predicate rules: DESIGNED_FOR for "designed for / suitable for / ready for"; CERTIFIED only when a third-party certificate and its issuer are explicitly stated;
PRODUCTION_DEPLOYMENT only for explicit series-production deployments; EXPERIENCE_WITH for project experience. When unsure, choose the weaker predicate or omit the claim.
The summary must be at most two neutral sentences without marketing superlatives.`;

/**
 * LLM-assisted drafting with grounding: proposals whose quote does not occur
 * in the source, whose concept is unknown, or that are stronger than the
 * quote's own wording allows are discarded. Results are merged with the
 * deterministic pass. Any failure returns the deterministic draft.
 */
export const createAiProfileDraftGenerator = (
  llm: StructuredLlm,
  onFailure?: (error: unknown) => void,
): SupplierProfileDraftGenerator => ({
  async generate({ sourceText, ontology }): Promise<ProfileDraft> {
    const baseline = deterministicClaims(sourceText, ontology);
    try {
      const output = await llm.generate({
        system: SYSTEM,
        instructions: `Concept catalog (id | label):\n${ontology.concepts.map((c) => `${c.id} | ${c.label}`).join('\n')}\n\nDraft claims from the supplier content below.`,
        untrustedContent: sourceText.slice(0, LLM_CHAR_BUDGET),
        schema: AiDraft,
        maxOutputTokens: 8000,
      });
      const normalizedSource = normalizeForMatching(sourceText);
      const grounded: ProposedClaim[] = [];
      for (const claim of output.claims) {
        if (!ontology.hasConcept(claim.conceptId)) continue;
        const quote = claim.quote.slice(0, MAX_QUOTE);
        if (normalizeForMatching(quote).length < 8 || !normalizedSource.includes(normalizeForMatching(quote)))
          continue;
        const concept = ontology.getConcept(asId(claim.conceptId));
        const cue = concept ? inferClaimPredicate(quote, concept.facetId) : null;
        if (!cue) continue; // negated or planned capability
        // Never accept a predicate the quote's own wording does not support.
        const predicate =
          cue.matchedCues.length === 0 || cue.matchedCues.includes(claim.predicate)
            ? claim.predicate
            : cue.predicate;
        grounded.push({
          conceptId: asId(claim.conceptId),
          predicate,
          qualifiers: {
            ...groundedLevels(claim, quote, ontology.qualifierKeysFor(asId(claim.conceptId))),
            ...(predicate === 'CERTIFIED' && claim.certificationBody
              ? { certificationBody: claim.certificationBody.slice(0, 120) }
              : {}),
          },
          quote,
        });
      }
      const merged = new Map<string, ProposedClaim>();
      for (const claim of [...grounded, ...baseline]) {
        const key = `${claim.conceptId}:${claim.predicate}`;
        if (!merged.has(key)) merged.set(key, claim);
      }
      return {
        claims: [...merged.values()],
        suggestedSummary: output.summary?.slice(0, 400) ?? null,
        method: 'ai_assisted',
      };
    } catch (error) {
      onFailure?.(error);
      return { claims: baseline, suggestedSummary: null, method: 'deterministic' };
    }
  },
});
