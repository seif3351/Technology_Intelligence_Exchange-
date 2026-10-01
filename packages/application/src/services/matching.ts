import {
  type Ontology,
  type RequirementConstraint,
  asId,
  normalizeForMatching,
  validateConstraints,
  validationError,
} from '@atx/domain';
import {
  type FusedCandidate,
  type InterpretedRequirement,
  type RankableMatch,
  buildComparisonMatrix,
  compareMatches,
  evaluateCandidate,
  reciprocalRankFusion,
} from '@atx/search';
import type { ApplicationDeps } from '../deps';
import { authorizeTenant } from '../policies';
import type { RequestContext } from '../principal';
import { type ConstraintView, type MatchView, presentConstraint, presentMatch } from '../views';
import { expandConcepts, loadCatalogBundle, summaryFromBundle, toCandidate } from './catalog-data';
import { clampLimit, decodeCursor, paginate, recordAudit } from './support';

export interface InterpretationView {
  readonly constraints: readonly ConstraintView[];
  readonly unrecognizedTerms: readonly string[];
  readonly notes: readonly string[];
  readonly method: 'deterministic' | 'ai_assisted' | 'provided';
}

export interface MatchQuery {
  /** Free-text requirement. Interpreted into constraints unless constraints are given. */
  readonly text?: string | null;
  readonly constraints?: readonly RequirementConstraint[] | null;
  /** Saved private requirement of the caller's organization. */
  readonly requirement?: { readonly organizationId: string; readonly requirementId: string } | null;
  /**
   * Terms that must never be processed or echoed (project names, programs,
   * customers). They are removed from the text before interpretation,
   * embedding or logging.
   */
  readonly confidentialTerms?: readonly string[];
  /** Restrict evaluation to these offerings (compare/explain). */
  readonly offeringIds?: readonly string[] | null;
  readonly excludeUnmetHardConstraints?: boolean;
  readonly requireAllHardConstraintsMet?: boolean;
  readonly limit?: number;
  readonly cursor?: string | null;
}

export interface MatchResponse {
  readonly interpretation: InterpretationView;
  readonly matches: readonly MatchView[];
  readonly nextCursor: string | null;
  readonly totalCandidatesEvaluated: number;
  readonly degraded: readonly string[];
}

const CANDIDATE_POOL = 80;

/**
 * Hybrid search & matching pipeline:
 *   text -> constraints (+ ontology expansion) -> keyword/semantic/structured
 *   retrieval -> RRF fusion -> deterministic constraint evaluation ->
 *   transparent scoring -> deterministic ranking -> explanation.
 */
export class MatchingService {
  constructor(private readonly deps: ApplicationDeps) {}

  async interpret(ctx: RequestContext, text: string, confidentialTerms: readonly string[] = []): Promise<InterpretationView> {
    const ontology = await this.deps.ontology.current();
    const result = await this.interpretText(redact(text, confidentialTerms), ontology);
    return toInterpretationView(result, ontology, result.method);
  }

  async findMatches(ctx: RequestContext, query: MatchQuery): Promise<MatchResponse> {
    return this.deps.telemetry.span('atx.matching.find', {}, async () => {
      const started = Date.now();
      const ontology = await this.deps.ontology.current();
      const degraded: string[] = [];
      const { constraints, interpretation, retrievalText } = await this.resolveConstraints(ctx, query, ontology);
      validateConstraints(constraints);
      for (const constraint of constraints) {
        if (constraint.kind === 'concept' && !ontology.hasConcept(constraint.conceptId)) {
          throw validationError(`Unknown concept "${constraint.conceptId}"`, [{ path: 'constraints', message: 'unknown concept' }]);
        }
      }
      if (constraints.length === 0 && !retrievalText) {
        throw validationError('Provide requirement text, constraints or a saved requirement');
      }

      const fused = query.offeringIds
        ? query.offeringIds.map((id) => ({ id, rrf: 0, relevance: 0.5, sources: ['explicit'] }) as FusedCandidate)
        : await this.retrieve(retrievalText, constraints, ontology, degraded);

      const bundle = await loadCatalogBundle(this.deps, fused.map((candidate) => asId<'OfferingId'>(candidate.id)));
      const now = this.deps.clock.now();
      const evaluated: RankableMatch[] = [];
      for (const candidate of fused) {
        const input = toCandidate(bundle, asId(candidate.id), candidate.relevance);
        if (!input) continue;
        const match = evaluateCandidate(input, constraints, ontology, now);
        if (query.excludeUnmetHardConstraints !== false && match.hardConstraintStatus === 'some_unmet' && !query.offeringIds) continue;
        if (query.requireAllHardConstraintsMet && match.hardConstraintStatus !== 'all_met') continue;
        evaluated.push({ match, tieBreakName: input.offering.name });
      }
      evaluated.sort(compareMatches);

      const offset = decodeCursor(query.cursor);
      const page = paginate(evaluated, offset, clampLimit(query.limit, 10));
      const matches = page.items.flatMap((item, index) => {
        const summary = summaryFromBundle(bundle, item.match.offeringId, ontology);
        return summary ? [presentMatch(offset + index + 1, item.match, summary, ontology)] : [];
      });

      this.deps.telemetry.recordDuration('atx.search.duration', Date.now() - started, {
        degraded: degraded.length > 0,
      });
      this.deps.telemetry.increment('atx.search.results', { hasResults: matches.length > 0 });
      return { interpretation, matches, nextCursor: page.nextCursor, totalCandidatesEvaluated: evaluated.length, degraded };
    });
  }

  /** Side-by-side comparison of 2–5 offerings against constraints (or their combined claimed concepts). */
  async compare(ctx: RequestContext, query: MatchQuery & { readonly offeringIds: readonly string[] }) {
    if (query.offeringIds.length < 2 || query.offeringIds.length > 5) {
      throw validationError('Compare between 2 and 5 offerings');
    }
    const ontology = await this.deps.ontology.current();
    let effective: MatchQuery = { ...query, limit: 5, cursor: null };
    if (!query.text && !query.constraints?.length && !query.requirement) {
      effective = { ...effective, constraints: await this.claimedConceptConstraints(query.offeringIds, ontology) };
    }
    const response = await this.findMatches(ctx, effective);
    const order = new Map(query.offeringIds.map((id, index) => [id, index]));
    const matches = [...response.matches].sort(
      (a, b) => (order.get(a.offering.id) ?? 0) - (order.get(b.offering.id) ?? 0),
    );
    const matrix = buildComparisonMatrix(
      matches.map((match) => ({ offeringId: match.offering.id, assessments: match.assessments })),
    );
    return { ...response, matches, matrix };
  }

  private async claimedConceptConstraints(offeringIds: readonly string[], ontology: Ontology): Promise<RequirementConstraint[]> {
    const claims = await this.deps.repos.claims.listPublishedForOfferings(offeringIds.map((id) => asId<'OfferingId'>(id)));
    const conceptIds = [...new Set(claims.map((claim) => claim.conceptId))]
      .filter((id) => ontology.hasConcept(id))
      .sort((a, b) => (ontology.getConcept(a)?.facetId ?? '').localeCompare(ontology.getConcept(b)?.facetId ?? '') || a.localeCompare(b))
      .slice(0, 30);
    return conceptIds.map((conceptId, index) => ({
      kind: 'concept',
      id: `c${index + 1}`,
      conceptId,
      level: 'mentioned',
      priority: 'preference',
      qualifiers: {},
      origin: 'user',
    }));
  }

  private async resolveConstraints(ctx: RequestContext, query: MatchQuery, ontology: Ontology) {
    if (query.requirement) {
      const scope = authorizeTenant(ctx, asId(query.requirement.organizationId), 'viewer');
      const requirement = await this.deps.repos.requirements.findById(scope, asId(query.requirement.requirementId));
      await recordAudit(this.deps.repos.audit, ctx, this.deps.clock.now(), {
        action: 'requirement.match',
        resourceType: 'requirement',
        resourceId: query.requirement.requirementId,
        organizationId: scope.organizationId,
        outcome: requirement ? 'success' : 'failure',
      });
      if (!requirement) throw validationError('Requirement not found');
      // Retrieval text is built from constraint labels only; private title and
      // description are never sent to the search index or an embedding provider.
      return {
        constraints: requirement.constraints,
        interpretation: toInterpretationView(
          { constraints: requirement.constraints, unrecognizedTerms: [], notes: [] },
          ontology,
          'provided',
        ),
        retrievalText: labelsText(requirement.constraints, ontology),
      };
    }
    if (query.constraints && query.constraints.length > 0) {
      return {
        constraints: query.constraints,
        interpretation: toInterpretationView({ constraints: query.constraints, unrecognizedTerms: [], notes: [] }, ontology, 'provided'),
        retrievalText: [redact(query.text ?? '', query.confidentialTerms ?? []), labelsText(query.constraints, ontology)].join(' ').trim(),
      };
    }
    const text = redact(query.text ?? '', query.confidentialTerms ?? []);
    if (text.trim().length === 0) return { constraints: [], interpretation: emptyInterpretation, retrievalText: '' };
    const result = await this.interpretText(text, ontology);
    return { constraints: result.constraints, interpretation: toInterpretationView(result, ontology, result.method), retrievalText: text };
  }

  private async interpretText(text: string, ontology: Ontology) {
    if (text.length > 4000) throw validationError('Requirement text must be at most 4000 characters');
    return this.deps.requirementExtractor.extract(text, ontology);
  }

  private async retrieve(
    text: string,
    constraints: readonly RequirementConstraint[],
    ontology: Ontology,
    degraded: string[],
  ): Promise<FusedCandidate[]> {
    const conceptIds = expandConcepts(
      ontology,
      constraints.flatMap((constraint) => (constraint.kind === 'concept' ? [constraint.conceptId] : [])),
    );
    let embedding: { model: string; vector: number[] } | null = null;
    if (this.deps.embeddings && text) {
      try {
        const started = Date.now();
        const [vector] = await this.deps.embeddings.embed([text]);
        this.deps.telemetry.recordDuration('atx.embedding.duration', Date.now() - started, { model: this.deps.embeddings.model });
        if (vector) embedding = { model: this.deps.embeddings.model, vector };
      } catch {
        degraded.push('semantic_search_unavailable');
      }
    } else if (!this.deps.embeddings) {
      degraded.push('semantic_search_not_configured');
    }
    const lists = await this.deps.searchIndex.retrieve({ text: text || null, embedding, conceptIds, limit: CANDIDATE_POOL });
    return reciprocalRankFusion(lists).slice(0, CANDIDATE_POOL);
  }
}

const emptyInterpretation: InterpretationView = { constraints: [], unrecognizedTerms: [], notes: [], method: 'provided' };

const toInterpretationView = (
  result: InterpretedRequirement,
  ontology: Ontology,
  method: InterpretationView['method'],
): InterpretationView => ({
  constraints: result.constraints.map((constraint) => presentConstraint(constraint, ontology)),
  unrecognizedTerms: result.unrecognizedTerms,
  notes: result.notes,
  method,
});

const labelsText = (constraints: readonly RequirementConstraint[], ontology: Ontology): string =>
  constraints
    .flatMap((constraint) =>
      constraint.kind === 'concept' ? [ontology.getConcept(constraint.conceptId)?.label ?? constraint.conceptId] : [],
    )
    .join(' ');

/** Removes confidential terms (token-aware, case/punctuation-insensitive) before any processing. */
export const redact = (text: string, confidentialTerms: readonly string[]): string => {
  let result = text;
  for (const term of confidentialTerms) {
    const tokens = normalizeForMatching(term).split(' ').filter(Boolean);
    if (tokens.length === 0) continue;
    const pattern = new RegExp(tokens.map(escapeRegExp).join('[\\s\\-_./:]*'), 'gi');
    result = result.replace(pattern, '[redacted]');
  }
  return result;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
