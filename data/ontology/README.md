# Ontology data

The automotive technology ontology is **data**, loaded into PostgreSQL by
`pnpm db:seed` (idempotent upsert). Add concepts by editing YAML here — no
code change or recompilation is required.

- `facets.yaml` — facet definitions (the "kind" of a concept) and the default
  constraint level used when a buyer mentions a concept of that facet.
- `concepts/*.yaml` — concepts grouped by area. Each concept may declare
  relations inline: `is_a`, `part_of`, `uses`, `related_to` (see
  `docs/domain/ontology.md` for semantics).

Rules:

- `id` is a stable, lowercase kebab-case identifier. Never rename an id —
  deprecate it (`status: deprecated`) and add a new concept.
- `is_a` must stay acyclic (validated at load).
- This ontology is intentionally incomplete. Prefer adding concepts when real
  supplier or buyer data needs them.

## Per-concept default level

A concept may set `default_level` to override its facet's `default_level` (the level assumed when a requirement names the concept without a cue such as "certified" or "experience"). Example: security mechanisms (`secoc`, `hsm`, `secure-boot`) default to `supports`, while cybersecurity standards keep the facet default `experience`.

## Ordinal qualifiers (`qualifiers:`)

A concept may declare which standardized levels a requirement can attach to it (ADR-0020):

```yaml
- id: aspice
  qualifiers: [aspiceLevel] # "ASPICE CL2" -> Experience with Automotive SPICE (CL2 or higher)
```

The known keys and their scales are defined by the standards and kept in
`packages/domain/src/qualifiers.ts`: `asil` (QM, A–D), `aspiceLevel` (1–5) and `cal` (1–4). An unknown key
fails the load. Requirement interpretation reads a level only next to a concept that declares it, so
"SAE level 3" never becomes an ASPICE capability level.

Loading also fails when one alias would name two concepts, because matching must never depend on the
order of the data files.
