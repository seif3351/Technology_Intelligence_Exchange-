import type { OntologyProvider } from '@atx/application';
import { type ConstraintLevel, Ontology, type OntologySnapshot, type RelationType, asId } from '@atx/domain';
import type pg from 'pg';
import { type Queryable, withTransaction } from './db';

/**
 * Serves the ontology from PostgreSQL with an in-process cache. The cache is
 * revalidated against `ontology_meta.version` at most every `ttlMs`, so
 * taxonomy edits propagate to every instance without restarts.
 */
export const createPostgresOntologyProvider = (
  pool: pg.Pool,
  options: { readonly ttlMs?: number } = {},
): OntologyProvider => {
  const ttlMs = options.ttlMs ?? 30_000;
  let cached: { ontology: Ontology; version: number; checkedAt: number } | null = null;
  let loading: Promise<Ontology> | null = null;

  const load = async (): Promise<Ontology> => {
    const version = await currentVersion(pool);
    if (cached && cached.version === version) {
      cached.checkedAt = Date.now();
      return cached.ontology;
    }
    const ontology = new Ontology(await readSnapshot(pool));
    cached = { ontology, version, checkedAt: Date.now() };
    return ontology;
  };

  return {
    async current() {
      if (cached && Date.now() - cached.checkedAt < ttlMs) return cached.ontology;
      loading ??= load().finally(() => {
        loading = null;
      });
      return loading;
    },
    async replace(snapshot) {
      new Ontology(snapshot); // validate before writing
      await withTransaction(pool, async (client) => {
        for (const facet of snapshot.facets) {
          await client.query(
            `INSERT INTO ontology_facets (id, label, description, default_level) VALUES ($1,$2,$3,$4)
             ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description, default_level = EXCLUDED.default_level`,
            [facet.id, facet.label, facet.description, facet.defaultConstraintLevel],
          );
        }
        for (const concept of snapshot.concepts) {
          await client.query(
            `INSERT INTO ontology_concepts (id, facet_id, label, description, aliases, case_sensitive_aliases, status, default_level)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (id) DO UPDATE SET facet_id = EXCLUDED.facet_id, label = EXCLUDED.label, description = EXCLUDED.description,
               aliases = EXCLUDED.aliases, case_sensitive_aliases = EXCLUDED.case_sensitive_aliases, status = EXCLUDED.status,
               default_level = EXCLUDED.default_level`,
            [
              concept.id,
              concept.facetId,
              concept.label,
              concept.description,
              concept.aliases,
              concept.caseSensitiveAliases ?? [],
              concept.status,
              concept.defaultConstraintLevel ?? null,
            ],
          );
        }
        // Relations are fully owned by the snapshot source (data files); concepts are never deleted, only deprecated.
        await client.query('DELETE FROM ontology_relations');
        for (const relation of snapshot.relations) {
          await client.query(
            'INSERT INTO ontology_relations (from_concept_id, to_concept_id, type) VALUES ($1,$2,$3)',
            [relation.fromConceptId, relation.toConceptId, relation.type],
          );
        }
        await client.query('UPDATE ontology_meta SET version = version + 1');
      });
      cached = null;
    },
    async addConcept(input) {
      await withTransaction(pool, async (client) => {
        await client.query(
          'INSERT INTO ontology_concepts (id, facet_id, label, description, aliases, status) VALUES ($1,$2,$3,$4,$5,$6)',
          [input.id, input.facetId, input.label, input.description, input.aliases, 'active'],
        );
        for (const broader of input.broaderConceptIds) {
          await client.query(
            "INSERT INTO ontology_relations (from_concept_id, to_concept_id, type) VALUES ($1,$2,'is_a')",
            [input.id, broader],
          );
        }
        await client.query('UPDATE ontology_meta SET version = version + 1');
      });
      cached = null;
    },
  };
};

const currentVersion = async (db: Queryable): Promise<number> => {
  const { rows } = await db.query('SELECT version FROM ontology_meta');
  return Number(rows[0]?.['version'] ?? 0);
};

export const readSnapshot = async (db: Queryable): Promise<OntologySnapshot> => {
  const [facets, concepts, relations] = await Promise.all([
    db.query('SELECT * FROM ontology_facets ORDER BY id'),
    db.query('SELECT * FROM ontology_concepts ORDER BY id'),
    db.query('SELECT * FROM ontology_relations ORDER BY from_concept_id, to_concept_id, type'),
  ]);
  return {
    facets: facets.rows.map((row) => ({
      id: asId(row['id'] as string),
      label: row['label'] as string,
      description: row['description'] as string,
      defaultConstraintLevel: row['default_level'] as ConstraintLevel,
    })),
    concepts: concepts.rows.map((row) => ({
      id: asId(row['id'] as string),
      facetId: asId(row['facet_id'] as string),
      label: row['label'] as string,
      description: row['description'] as string,
      aliases: row['aliases'] as string[],
      caseSensitiveAliases: row['case_sensitive_aliases'] as string[],
      ...(row['default_level'] ? { defaultConstraintLevel: row['default_level'] as ConstraintLevel } : {}),
      status: row['status'] as 'active' | 'deprecated',
    })),
    relations: relations.rows.map((row) => ({
      fromConceptId: asId(row['from_concept_id'] as string),
      toConceptId: asId(row['to_concept_id'] as string),
      type: row['type'] as RelationType,
    })),
  };
};
