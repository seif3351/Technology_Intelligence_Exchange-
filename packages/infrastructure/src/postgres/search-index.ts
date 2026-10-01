import type { RetrievalQuery, SearchIndex } from '@atx/application';
import type { RankedList } from '@atx/search';
import type { Queryable } from './db';

const vectorLiteral = (vector: readonly number[]): string =>
  `[${vector.map((v) => (Number.isFinite(v) ? v : 0)).join(',')}]`;
/** Cosine distance above which a semantic neighbour is considered noise. */
const MAX_COSINE_DISTANCE = 0.85;

/**
 * PostgreSQL-native hybrid retrieval: full-text (tsvector), semantic
 * (pgvector cosine) and structured (ontology concept claims). Each source
 * returns its own ranked list; fusion happens in the application.
 */
export const createPostgresSearchIndex = (db: Queryable): SearchIndex => ({
  async retrieve(query: RetrievalQuery): Promise<RankedList[]> {
    const [keyword, semantic, structured] = await Promise.all([
      query.text ? keywordList(db, query.text, query.limit) : Promise.resolve([]),
      query.embedding ? semanticList(db, query.embedding, query.limit) : Promise.resolve([]),
      query.conceptIds.length > 0 ? structuredList(db, query.conceptIds, query.limit) : Promise.resolve([]),
    ]);
    return [
      { source: 'keyword', ids: keyword },
      { source: 'semantic', ids: semantic },
      { source: 'structured', ids: structured },
    ];
  },
  async upsert(document) {
    await db.query(
      `INSERT INTO offering_search_documents (offering_id, content, tsv, embedding, embedding_model, content_hash, updated_at)
       VALUES ($1, $2, to_tsvector('english', $2), $3::vector, $4, $5, now())
       ON CONFLICT (offering_id) DO UPDATE SET content = EXCLUDED.content, tsv = EXCLUDED.tsv, embedding = EXCLUDED.embedding,
         embedding_model = EXCLUDED.embedding_model, content_hash = EXCLUDED.content_hash, updated_at = now()`,
      [
        document.offeringId,
        document.text,
        document.embedding ? vectorLiteral(document.embedding.vector) : null,
        document.embedding?.model ?? null,
        document.contentHash,
      ],
    );
  },
  async remove(offeringId) {
    await db.query('DELETE FROM offering_search_documents WHERE offering_id = $1', [offeringId]);
  },
  async currentHash(offeringId) {
    const { rows } = await db.query(
      'SELECT content_hash FROM offering_search_documents WHERE offering_id = $1',
      [offeringId],
    );
    return (rows[0]?.['content_hash'] as string | undefined) ?? null;
  },
});

/** OR-semantics full-text query built from the text's own lexemes, ranked by ts_rank_cd. */
const keywordList = async (db: Queryable, text: string, limit: number): Promise<string[]> => {
  const { rows } = await db.query(
    `WITH lex AS (SELECT string_agg(quote_literal(lexeme), ' | ') AS expr FROM unnest(to_tsvector('english', $1)))
     SELECT d.offering_id FROM offering_search_documents d, lex
      WHERE lex.expr IS NOT NULL AND d.tsv @@ to_tsquery('english', lex.expr)
      ORDER BY ts_rank_cd(d.tsv, to_tsquery('english', lex.expr), 32) DESC, d.offering_id
      LIMIT $2`,
    [text.slice(0, 2000), limit],
  );
  return rows.map((row) => row['offering_id'] as string);
};

const semanticList = async (
  db: Queryable,
  embedding: NonNullable<RetrievalQuery['embedding']>,
  limit: number,
): Promise<string[]> => {
  const { rows } = await db.query(
    `SELECT offering_id FROM offering_search_documents
      WHERE embedding_model = $2 AND embedding IS NOT NULL AND vector_dims(embedding) = vector_dims($1::vector)
        AND (embedding <=> $1::vector) < $4
      ORDER BY embedding <=> $1::vector, offering_id
      LIMIT $3`,
    [vectorLiteral(embedding.vector), embedding.model, limit, MAX_COSINE_DISTANCE],
  );
  return rows.map((row) => row['offering_id'] as string);
};

/** Offerings with published claims (offering- or organization-level) on the given concepts, most concepts first. */
const structuredList = async (
  db: Queryable,
  conceptIds: readonly string[],
  limit: number,
): Promise<string[]> => {
  const { rows } = await db.query(
    `SELECT o.id, count(DISTINCT c.concept_id) AS matched
       FROM offerings o
       JOIN technical_claims c ON c.status = 'published' AND c.concept_id = ANY($1::text[])
        AND ((c.subject_type = 'offering' AND c.subject_id = o.id)
          OR (c.subject_type IN ('organization','capability') AND c.organization_id = o.organization_id))
      WHERE o.status = 'published'
      GROUP BY o.id
      ORDER BY matched DESC, o.id
      LIMIT $2`,
    [conceptIds, limit],
  );
  return rows.map((row) => row['id'] as string);
};
