# Ontology data

The automotive technology ontology is **data**, loaded into PostgreSQL by
`pnpm db:seed` (idempotent upsert). Add concepts by editing YAML here — no
code change or recompilation is required.

* `facets.yaml` — facet definitions (the "kind" of a concept) and the default
  constraint level used when a buyer mentions a concept of that facet.
* `concepts/*.yaml` — concepts grouped by area. Each concept may declare
  relations inline: `is_a`, `part_of`, `uses`, `related_to` (see
  `docs/domain/ontology.md` for semantics).

Rules:
* `id` is a stable, lowercase kebab-case identifier. Never rename an id —
  deprecate it (`status: deprecated`) and add a new concept.
* `is_a` must stay acyclic (validated at load).
* This ontology is intentionally incomplete. Prefer adding concepts when real
  supplier or buyer data needs them.
