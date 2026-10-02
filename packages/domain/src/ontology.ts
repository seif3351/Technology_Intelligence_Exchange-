import type { ConceptId, FacetId } from './ids';
import type { ConstraintLevel } from './requirement';
import { isOrdinalQualifierKey } from './qualifiers';
import { normalizeForMatching } from './text';

/**
 * The automotive technology ontology is DATA, not code. Facets, concepts and
 * relations are loaded from configuration/database; nothing in the codebase
 * should branch on a specific concept id such as "qnx".
 */
export interface Facet {
  readonly id: FacetId;
  readonly label: string;
  readonly description: string;
  /** Level applied when a buyer mentions a concept of this facet without qualification. */
  readonly defaultConstraintLevel: ConstraintLevel;
}

export type ConceptStatus = 'active' | 'deprecated';

export interface Concept {
  readonly id: ConceptId;
  readonly facetId: FacetId;
  readonly label: string;
  readonly description: string;
  readonly aliases: readonly string[];
  /**
   * Aliases that are also ordinary words (e.g. "CAN" vs "can") and therefore
   * only match when written with exactly this casing.
   */
  readonly caseSensitiveAliases?: readonly string[];
  /**
   * Level assumed when a buyer names this concept without a level cue,
   * overriding the facet default (e.g. a security mechanism such as SecOC in
   * the cybersecurity facet, whose standards default to "experience").
   */
  readonly defaultConstraintLevel?: ConstraintLevel;
  /**
   * Ordinal qualifiers a buyer can attach to this concept (keys of
   * ORDINAL_QUALIFIERS), e.g. ["aspiceLevel"] for Automotive SPICE. Requirement
   * interpretation only reads levels next to concepts that declare them, so
   * "SAE level 3" never becomes an ASPICE capability level.
   */
  readonly qualifierKeys?: readonly string[];
  readonly status: ConceptStatus;
}

/**
 * Relation semantics:
 *  - is_a:       subsumption. "AUTOSAR Adaptive" is_a "AUTOSAR". Used for
 *                deterministic constraint satisfaction (a claim about a
 *                narrower concept satisfies a requirement for the broader one).
 *  - part_of:    composition. "ASIL" part_of "ISO 26262".
 *  - uses:       technical dependency. "AUTOSAR Adaptive" uses "SOME/IP".
 *  - related_to: loose association; never used for satisfaction.
 */
export const RELATION_TYPES = ['is_a', 'part_of', 'uses', 'related_to'] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

export interface ConceptRelation {
  readonly fromConceptId: ConceptId;
  readonly toConceptId: ConceptId;
  readonly type: RelationType;
}

export interface OntologySnapshot {
  readonly facets: readonly Facet[];
  readonly concepts: readonly Concept[];
  readonly relations: readonly ConceptRelation[];
}

export interface AliasMatch {
  readonly conceptId: ConceptId;
  readonly matchedText: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Immutable, in-memory view of the ontology graph. Cheap to build from a
 * snapshot; callers rebuild it when the ontology version changes.
 */
export class Ontology {
  private readonly conceptsById = new Map<ConceptId, Concept>();
  private readonly facetsById = new Map<FacetId, Facet>();
  private readonly outgoing = new Map<ConceptId, ConceptRelation[]>();
  private readonly incoming = new Map<ConceptId, ConceptRelation[]>();
  private readonly aliasIndex: { readonly normalized: string; readonly conceptId: ConceptId }[] = [];
  private readonly caseSensitive: { readonly exact: string; readonly pattern: RegExp }[] = [];

  constructor(snapshot: OntologySnapshot) {
    for (const facet of snapshot.facets) this.facetsById.set(facet.id, facet);
    const aliasOwners = new Map<string, ConceptId>();
    for (const concept of snapshot.concepts) {
      if (!this.facetsById.has(concept.facetId)) {
        throw new Error(`Concept ${concept.id} references unknown facet ${concept.facetId}`);
      }
      for (const key of concept.qualifierKeys ?? []) {
        if (!isOrdinalQualifierKey(key))
          throw new Error(`Concept ${concept.id} declares unknown qualifier "${key}"`);
      }
      this.conceptsById.set(concept.id, concept);
      for (const exact of concept.caseSensitiveAliases ?? []) {
        this.caseSensitive.push({
          exact,
          pattern: new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(exact)}(?![A-Za-z0-9])`, 'gi'),
        });
      }
      const names = new Set(
        [concept.label, ...concept.aliases, ...(concept.caseSensitiveAliases ?? [])].map(
          normalizeForMatching,
        ),
      );
      for (const normalized of names) {
        if (normalized.length === 0) continue;
        // One name must mean one concept, otherwise matching would depend on data order.
        const owner = aliasOwners.get(normalized);
        if (owner !== undefined && owner !== concept.id)
          throw new Error(`Alias "${normalized}" is used by both ${owner} and ${concept.id}`);
        aliasOwners.set(normalized, concept.id);
        this.aliasIndex.push({ normalized, conceptId: concept.id });
      }
    }
    for (const relation of snapshot.relations) {
      if (!this.conceptsById.has(relation.fromConceptId) || !this.conceptsById.has(relation.toConceptId)) {
        throw new Error(
          `Relation ${relation.fromConceptId} -> ${relation.toConceptId} references unknown concept`,
        );
      }
      push(this.outgoing, relation.fromConceptId, relation);
      push(this.incoming, relation.toConceptId, relation);
    }
    // Longest aliases first so "autosar adaptive" wins over "autosar".
    this.aliasIndex.sort((a, b) => b.normalized.length - a.normalized.length);
    this.assertAcyclicSubsumption();
  }

  get facets(): readonly Facet[] {
    return [...this.facetsById.values()];
  }

  get concepts(): readonly Concept[] {
    return [...this.conceptsById.values()];
  }

  getConcept(id: ConceptId): Concept | undefined {
    return this.conceptsById.get(id);
  }

  getFacet(id: FacetId): Facet | undefined {
    return this.facetsById.get(id);
  }

  hasConcept(id: string): id is ConceptId {
    return this.conceptsById.has(id as ConceptId);
  }

  relationsFrom(id: ConceptId): readonly ConceptRelation[] {
    return this.outgoing.get(id) ?? [];
  }

  relationsTo(id: ConceptId): readonly ConceptRelation[] {
    return this.incoming.get(id) ?? [];
  }

  /** The concept itself plus every concept that is_a (transitively) this one. */
  narrowerOrSelf(id: ConceptId): ReadonlySet<ConceptId> {
    const result = new Set<ConceptId>([id]);
    const queue = [id];
    while (queue.length > 0) {
      const current = queue.shift() as ConceptId;
      for (const relation of this.relationsTo(current)) {
        if (relation.type === 'is_a' && !result.has(relation.fromConceptId)) {
          result.add(relation.fromConceptId);
          queue.push(relation.fromConceptId);
        }
      }
    }
    return result;
  }

  /** Transitive is_a ancestors (excluding self). */
  broader(id: ConceptId): ReadonlySet<ConceptId> {
    const result = new Set<ConceptId>();
    const queue = [id];
    while (queue.length > 0) {
      const current = queue.shift() as ConceptId;
      for (const relation of this.relationsFrom(current)) {
        if (relation.type === 'is_a' && !result.has(relation.toConceptId)) {
          result.add(relation.toConceptId);
          queue.push(relation.toConceptId);
        }
      }
    }
    return result;
  }

  /** Concepts connected by any non-subsumption relation, in either direction. */
  associated(id: ConceptId): ReadonlySet<ConceptId> {
    const result = new Set<ConceptId>();
    for (const relation of this.relationsFrom(id)) {
      if (relation.type !== 'is_a') result.add(relation.toConceptId);
    }
    for (const relation of this.relationsTo(id)) {
      if (relation.type !== 'is_a') result.add(relation.fromConceptId);
    }
    return result;
  }

  /** Ordinal qualifiers a requirement may attach to this concept (ontology data). */
  qualifierKeysFor(id: ConceptId): readonly string[] {
    return this.conceptsById.get(id)?.qualifierKeys ?? [];
  }

  /** Does a claim about `claimed` satisfy a requirement for `required`? */
  satisfies(claimed: ConceptId, required: ConceptId): boolean {
    return this.narrowerOrSelf(required).has(claimed);
  }

  /**
   * Finds concept mentions in free text using whole-token alias matching.
   * Overlapping matches are resolved in favour of the longest alias.
   */
  findMentions(text: string): AliasMatch[] {
    const normalized = ` ${normalizeForMatching(this.maskCaseMismatches(text))} `;
    const taken: boolean[] = new Array<boolean>(normalized.length).fill(false);
    const matches: AliasMatch[] = [];
    for (const entry of this.aliasIndex) {
      const needle = ` ${entry.normalized} `;
      let from = 0;
      for (;;) {
        const index = normalized.indexOf(needle, from);
        if (index < 0) break;
        const start = index + 1;
        const end = start + entry.normalized.length;
        if (!taken.slice(start, end).some(Boolean)) {
          for (let i = start; i < end; i++) taken[i] = true;
          matches.push({ conceptId: entry.conceptId, matchedText: entry.normalized, start, end });
        }
        from = index + 1;
      }
    }
    return matches.sort((a, b) => a.start - b.start);
  }

  /**
   * Removes occurrences of case-sensitive aliases whose casing differs (so
   * "solutions that can run" does not mention the CAN bus). Call this on raw
   * text BEFORE any lower-casing normalization.
   */
  maskCaseMismatches(text: string): string {
    let result = text;
    for (const { exact, pattern } of this.caseSensitive) {
      result = result.replace(pattern, (match) => (match === exact ? match : ' '));
    }
    return result;
  }

  /** Case/alias-insensitive lookup of a single term. */
  resolveTerm(term: string): Concept | undefined {
    const normalized = normalizeForMatching(term);
    if (this.hasConcept(normalized)) return this.getConcept(normalized);
    const entry = this.aliasIndex.find((candidate) => candidate.normalized === normalized);
    return entry ? this.getConcept(entry.conceptId) : undefined;
  }

  private assertAcyclicSubsumption(): void {
    const state = new Map<ConceptId, 'visiting' | 'done'>();
    const visit = (id: ConceptId): void => {
      const current = state.get(id);
      if (current === 'done') return;
      if (current === 'visiting') throw new Error(`is_a cycle detected at concept ${id}`);
      state.set(id, 'visiting');
      for (const relation of this.relationsFrom(id)) {
        if (relation.type === 'is_a') visit(relation.toConceptId);
      }
      state.set(id, 'done');
    };
    for (const id of this.conceptsById.keys()) visit(id);
  }
}

const push = <K, V>(map: Map<K, V[]>, key: K, value: V): void => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
