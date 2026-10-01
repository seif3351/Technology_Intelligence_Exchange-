# ADR-0009: Data-driven ontology

## Decision

Facets, concepts, aliases (incl. case-sensitive aliases such as `CAN`) and relations (`is_a`, `part_of`, `uses`, `related_to`) live in `data/ontology/*.yaml`, are validated (unique ids, acyclic `is_a`, known references) and loaded into PostgreSQL by `pnpm db:seed`; admins can add concepts at runtime. Code never branches on specific concept ids. Only `is_a` participates in constraint satisfaction (a claim on a narrower concept satisfies a broader requirement, never the reverse).

## Consequences

New technologies need no deployment. Concept ids are permanent; deprecate instead of renaming.
