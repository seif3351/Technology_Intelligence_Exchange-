import type { ClaimPredicate, FacetId } from '@atx/domain';

/**
 * Conservative mapping from a source sentence to a claim predicate, used when
 * drafting claims from supplier documents. When several cues match, the
 * WEAKEST predicate wins: drafting must never upgrade "designed for" into
 * "certified". Every result is a draft that a human must review.
 */
const PREDICATE_STRENGTH: readonly ClaimPredicate[] = [
  'DESIGNED_FOR',
  'TARGETS_DOMAIN',
  'SUPPORTS',
  'INTEGRATES_WITH',
  'IMPLEMENTS',
  'PROVIDES_CAPABILITY',
  'EXPERIENCE_WITH',
  'PROCESS_COMPLIANT',
  'PRODUCTION_DEPLOYMENT',
  'CERTIFIED',
];

const CUES: readonly { readonly predicate: ClaimPredicate; readonly pattern: RegExp }[] = [
  { predicate: 'DESIGNED_FOR', pattern: /\b(designed for|intended for|suitable for|ready for|prepared for|aligned with|targeting)\b/i },
  { predicate: 'CERTIFIED', pattern: /\b(certified|certification|certificate)\b/i },
  { predicate: 'PRODUCTION_DEPLOYMENT', pattern: /\b(in series production|series production|production vehicles?|in production|deployed in)\b/i },
  { predicate: 'PROCESS_COMPLIANT', pattern: /\b(compliant|compliance|in accordance with|according to)\b/i },
  { predicate: 'EXPERIENCE_WITH', pattern: /\b(experience|projects?|delivered|track record)\b/i },
  { predicate: 'IMPLEMENTS', pattern: /\b(implements|implementation of|conforms to)\b/i },
  { predicate: 'INTEGRATES_WITH', pattern: /\b(integrates? with|integration with|plug-?in for)\b/i },
  { predicate: 'SUPPORTS', pattern: /\b(supports?|supported|compatible|runs on|available for)\b/i },
];

const NEGATION = /\b(not|no|without|never|lacks?|unsupported|planned|roadmap|future|upcoming)\b/i;

export interface PredicateInference {
  readonly predicate: ClaimPredicate;
  readonly matchedCues: readonly ClaimPredicate[];
}

export const inferClaimPredicate = (sentence: string, facetId: FacetId): PredicateInference | null => {
  if (NEGATION.test(sentence)) return null;
  const matched = CUES.filter((cue) => cue.pattern.test(sentence)).map((cue) => cue.predicate);
  if (matched.length === 0) {
    const fallback: ClaimPredicate =
      facetId === 'capability' || facetId === 'ai-ml'
        ? 'PROVIDES_CAPABILITY'
        : facetId === 'application-domain'
          ? 'TARGETS_DOMAIN'
          : 'SUPPORTS';
    return { predicate: fallback, matchedCues: [] };
  }
  const weakest = [...matched].sort((a, b) => PREDICATE_STRENGTH.indexOf(a) - PREDICATE_STRENGTH.indexOf(b))[0];
  return weakest ? { predicate: weakest, matchedCues: matched } : null;
};

export const splitSentences = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+|\n{1,}/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 8);
