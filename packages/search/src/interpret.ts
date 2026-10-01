import {
  type AliasMatch,
  type ConceptConstraint,
  type ConstraintLevel,
  type ConstraintPriority,
  type Ontology,
  type RequirementConstraint,
  normalizeForMatching,
} from '@atx/domain';

/**
 * Deterministic interpretation of a natural-language technical requirement
 * into structured constraints. This is the baseline that always works; an
 * LLM-based extractor may refine it, but search never depends on the LLM.
 */
export interface InterpretedRequirement {
  readonly constraints: readonly RequirementConstraint[];
  /** Technical-looking terms that could not be mapped to the ontology (the UNKNOWN bucket). */
  readonly unrecognizedTerms: readonly string[];
  /** Human-readable notes on how cues were applied, for transparency. */
  readonly notes: readonly string[];
}

const PREFERENCE_CUE =
  /\b(ideally|preferably|preferred|prefer|nice to have|would be (a )?(plus|nice)|optional(ly)?|bonus|if possible|desirable)\b/;
const PRODUCTION_REFERENCE_CUE =
  /\b(production references?|reference customers?|series production references?|production track record)\b/;
const MATURITY_PRODUCTION_CUE =
  /\b(production ready|production grade|series ready|production proven|mature)\b/;
const LEVEL_CUES: readonly { readonly level: ConstraintLevel; readonly pattern: RegExp }[] = [
  { level: 'certified', pattern: /\b(certified|certification|certificate)\b/ },
  {
    level: 'production',
    pattern: /\b(in series production|deployed in production|production deployments?)\b/,
  },
  { level: 'experience', pattern: /\b(experience|experienced|track record|proven)\b/ },
];
const CUE_WINDOW = 28;

const COMMON_UPPERCASE_WORDS = new Set([
  'I',
  'A',
  'WE',
  'OEM',
  'OEMS',
  'RFI',
  'RFQ',
  'POC',
  'SOP',
  'EU',
  'US',
  'USA',
  'UK',
  'API',
  'APIS',
  'OK',
  'IT',
  'Q1',
  'Q2',
  'Q3',
  'Q4',
]);

export const interpretRequirementText = (text: string, ontology: Ontology): InterpretedRequirement => {
  const notes: string[] = [];
  const constraints = new Map<string, RequirementConstraint>();
  const clauses = splitClauses(text);

  let constraintCounter = 0;
  const nextId = (): string => `c${++constraintCounter}`;

  for (const clause of clauses) {
    let working = canonical(ontology.maskCaseMismatches(clause));
    const priorityAt = (position: number): ConstraintPriority => {
      const preferenceIndex = working.search(PREFERENCE_CUE);
      return preferenceIndex >= 0 && position >= preferenceIndex ? 'preference' : 'hard';
    };

    const productionRef = working.search(PRODUCTION_REFERENCE_CUE);
    if (productionRef >= 0) {
      upsert(constraints, 'production_reference', {
        kind: 'production_reference',
        id: nextId(),
        priority: priorityAt(productionRef),
        origin: 'extracted_deterministic',
      });
      notes.push('"production references" interpreted as a production-reference constraint');
      working = canonical(working.replace(PRODUCTION_REFERENCE_CUE, ' '));
    }
    const maturity = working.search(MATURITY_PRODUCTION_CUE);
    if (maturity >= 0) {
      upsert(constraints, 'maturity', {
        kind: 'maturity',
        id: nextId(),
        minimum: 'production',
        priority: priorityAt(maturity),
        origin: 'extracted_deterministic',
      });
      notes.push('"production-ready" interpreted as minimum maturity = production');
      working = canonical(working.replace(MATURITY_PRODUCTION_CUE, ' '));
    }

    const mentions = ontology.findMentions(working);
    mentions.forEach((mention, index) => {
      const concept = ontology.getConcept(mention.conceptId);
      if (!concept) return;
      const facet = ontology.getFacet(concept.facetId);
      const cueLevel = detectLevelCue(working, mention, mentions[index - 1], mentions[index + 1]);
      const level = cueLevel ?? concept.defaultConstraintLevel ?? facet?.defaultConstraintLevel ?? 'supports';
      if (cueLevel)
        notes.push(`"${concept.label}" requires level "${cueLevel}" (cue found next to the term)`);
      const constraint: ConceptConstraint = {
        kind: 'concept',
        id: nextId(),
        conceptId: concept.id,
        level,
        priority: priorityAt(mention.start),
        qualifiers: extractQualifiers(mention.matchedText, working, mention),
        origin: 'extracted_deterministic',
      };
      upsert(constraints, `concept:${concept.id}`, constraint);
    });
  }

  const deduplicated = dropRedundantBroaderConcepts([...constraints.values()], ontology, notes);
  return {
    constraints: renumber(deduplicated),
    unrecognizedTerms: findUnrecognizedTerms(text, ontology),
    notes: [...new Set(notes)],
  };
};

/** Normalized text padded with single spaces; findMentions offsets refer to exactly this form. */
const canonical = (text: string): string => ` ${normalizeForMatching(text)} `;

const splitClauses = (text: string): string[] =>
  text
    .split(/(?<=[.;!?])\s+|\n+|\s+but\s+/i)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);

const detectLevelCue = (
  text: string,
  mention: AliasMatch,
  previous: AliasMatch | undefined,
  next: AliasMatch | undefined,
): ConstraintLevel | undefined => {
  const beforeStart = Math.max(previous ? previous.end : 0, mention.start - CUE_WINDOW);
  const afterEnd = Math.min(next ? next.start : text.length, mention.end + CUE_WINDOW);
  const window = `${text.slice(beforeStart, mention.start)} ${text.slice(mention.end, afterEnd)}`;
  return LEVEL_CUES.find((cue) => cue.pattern.test(window))?.level;
};

const extractQualifiers = (matched: string, text: string, mention: AliasMatch): Record<string, string> => {
  const around = `${matched} ${text.slice(mention.end, mention.end + 4)}`;
  const asil = /\basil[ -]?([abcd])\b/.exec(around);
  return asil?.[1] ? { asil: asil[1].toUpperCase() } : {};
};

const PRIORITY_RANK: Readonly<Record<ConstraintPriority, number>> = { preference: 0, hard: 1 };
const LEVEL_RANK: Readonly<Record<ConstraintLevel, number>> = {
  mentioned: 0,
  supports: 1,
  experience: 2,
  production: 3,
  certified: 4,
};

/** Keeps the strictest variant when the same constraint is mentioned several times. */
const upsert = (map: Map<string, RequirementConstraint>, key: string, next: RequirementConstraint): void => {
  const existing = map.get(key);
  if (!existing) {
    map.set(key, next);
    return;
  }
  const priority =
    PRIORITY_RANK[next.priority] > PRIORITY_RANK[existing.priority] ? next.priority : existing.priority;
  if (existing.kind === 'concept' && next.kind === 'concept') {
    const level = LEVEL_RANK[next.level] > LEVEL_RANK[existing.level] ? next.level : existing.level;
    map.set(key, {
      ...existing,
      priority,
      level,
      qualifiers: { ...existing.qualifiers, ...next.qualifiers },
    });
  } else {
    map.set(key, { ...existing, priority });
  }
};

const dropRedundantBroaderConcepts = (
  constraints: RequirementConstraint[],
  ontology: Ontology,
  notes: string[],
): RequirementConstraint[] => {
  const conceptIds = constraints.flatMap((c) => (c.kind === 'concept' ? [c.conceptId] : []));
  return constraints.filter((constraint) => {
    if (constraint.kind !== 'concept') return true;
    const narrower = conceptIds.find(
      (other) => other !== constraint.conceptId && ontology.broader(other).has(constraint.conceptId),
    );
    if (narrower) {
      const broad = ontology.getConcept(constraint.conceptId)?.label ?? constraint.conceptId;
      const specific = ontology.getConcept(narrower)?.label ?? narrower;
      notes.push(`"${broad}" is implied by the more specific "${specific}"`);
      return false;
    }
    return true;
  });
};

const renumber = (constraints: RequirementConstraint[]): RequirementConstraint[] =>
  constraints.map((constraint, index) => ({ ...constraint, id: `c${index + 1}` }));

const findUnrecognizedTerms = (text: string, ontology: Ontology): string[] => {
  const recognized = ontology.findMentions(text).map((mention) => mention.matchedText);
  const candidates =
    text.match(/\b(?:[A-Z][A-Z0-9]{1,11}(?:[-/][A-Z0-9]+)*|[A-Za-z]+[0-9][A-Za-z0-9-]*)\b/g) ?? [];
  const unknown = new Set<string>();
  for (const candidate of candidates) {
    if (COMMON_UPPERCASE_WORDS.has(candidate.toUpperCase())) continue;
    const normalized = normalizeForMatching(candidate);
    if (ontology.resolveTerm(candidate)) continue;
    if (recognized.some((match) => ` ${match} `.includes(` ${normalized} `))) continue;
    unknown.add(candidate);
  }
  return [...unknown];
};
