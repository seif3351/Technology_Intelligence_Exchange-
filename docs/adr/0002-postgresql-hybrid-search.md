# ADR-0002: PostgreSQL for system of record and hybrid search

## Context

Matching must combine structured technical constraints (deterministic), keyword relevance and semantic similarity. Canonical facts must stay relational and auditable; derived search data must be rebuildable.

## Decision

- PostgreSQL 16 is the only datastore. Normalized tables for organizations, offerings, claims, evidence, assets, requirements, engagements, audit, jobs; JSONB only for genuinely flexible shapes (claim qualifiers, offering type details, disclosure snapshots).
- Retrieval in `offering_search_documents` (derived, disposable): `tsvector` full-text (OR-semantics over query lexemes), `pgvector` cosine similarity (model-tagged, dimension-agnostic column), and a structured query over published claims with ontology-expanded concept ids.
- The three ranked lists are fused with Reciprocal Rank Fusion in the application; candidates are then evaluated deterministically against constraints (`packages/search`).
- Embeddings default to a local deterministic hashing model; an OpenAI-compatible HTTP provider can be configured. Rebuild with `pnpm --filter @atx/worker reindex`.

## Consequences

- No Elasticsearch/vector DB to operate; transactional consistency for canonical data.
- Exact (non-indexed) vector scan is fine for the MVP catalog size; add an HNSW index per fixed-dimension model when the catalog grows.
- Similarity never decides compatibility: hard constraints are evaluated against claims.

## Alternatives considered

External vector DB or OpenSearch (rejected for now: second source of truth, ops cost); graph DB for the ontology (rejected: the ontology is small and loaded in memory).
