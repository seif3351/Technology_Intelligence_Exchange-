# Architecture overview

Automotive Technology Exchange (ATX) is a **modular monolith** with ports & adapters. One application layer serves four interfaces: the web app, the HTTP API, the remote MCP server and the background worker.

```
apps/web ──HTTP (BFF)──▶ apps/api ─┐
AI agents ──MCP────────▶ apps/mcp-server ─┼─▶ packages/runtime (composition root)
apps/worker (jobs) ────────────────┘            │
                                                ▼
                      packages/application (use cases, ports, policies, read models)
                         │                 │
              packages/search        packages/domain
              (matching engine)      (entities, invariants, provenance, ontology graph)

adapters: packages/infrastructure (PostgreSQL, pgvector, jobs, storage, scanning, extraction)
          packages/ai (Anthropic, embeddings, deterministic extractors)
          packages/auth (JWT, scrypt, confirmation tokens, signed URLs)
          packages/observability (pino, OpenTelemetry)
contracts: packages/contracts (Zod schemas → OpenAPI 3.1, MCP tool JSON Schemas)
```

## Package responsibilities

| Package          | Responsibility                                                                                                                                                  | May depend on               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `domain`         | Entities, value objects, invariants (claims, provenance, requirements, ontology graph, URL policy). No I/O.                                                     | —                           |
| `search`         | Deterministic requirement interpretation, constraint evaluation, transparent scoring, RRF fusion, comparison matrix.                                            | domain                      |
| `application`    | Use cases (catalog, matching, supplier workspace, requirements, engagements, admin, ingestion, indexing, identity), authorization policies, ports, read models. | domain, search              |
| `contracts`      | Wire schemas for HTTP and MCP. Output schemas double as allow-lists.                                                                                            | domain                      |
| `infrastructure` | PostgreSQL repositories, migrations, search index, job queue, ontology provider, object storage, scanner, text extraction.                                      | application, domain, search |
| `ai`             | LLM/embedding adapters and AI-assisted extractors with deterministic fallbacks.                                                                                 | application, domain, search |
| `auth`           | Token issuing/verification, password hashing, confirmation tokens, signed URLs.                                                                                 | application, domain         |
| `observability`  | Logger with redaction, OpenTelemetry SDK and the `Telemetry` port implementation.                                                                               | application                 |
| `runtime`        | Composition root: picks adapters from configuration; demo seeding.                                                                                              | packages                    |
| `config`         | Validated environment configuration.                                                                                                                            | —                           |
| `ui`             | Presentation vocabulary (labels/tones for statuses, trust tiers).                                                                                               | —                           |

Rules are enforced by `test/architecture.test.ts` and ESLint.

## Request flow (matching)

1. Interface adapter validates input with a contract schema and resolves the principal (bearer token → `IdentityService.principalFor`).
2. `MatchingService.findMatches` interprets text into constraints (deterministic, optionally AI-assisted), after removing confidential terms.
3. Retrieval: full-text, semantic (pgvector) and structured (claims on ontology-expanded concepts) lists → reciprocal rank fusion.
4. `loadCatalogBundle` loads offerings, organizations, claims and production evidence in a constant number of queries.
5. `evaluateCandidate` assesses every constraint (met / partial / unknown / unmet) with the strongest evidence basis, computes the transparent score and gaps.
6. Deterministic ranking (hard-constraint status, score, name, id), pagination, presentation as read models; adapters validate output against contracts.

See [search-and-matching.md](search-and-matching.md), [c4-context.md](c4-context.md), [c4-container.md](c4-container.md) and the [ADRs](../adr/README.md).

## Onboarding and public listing

1. An operator creates the first platform administrator (`pnpm admin:create`).
2. Administrators issue sign-up invitations (ADR-0012); invitees register with the link, accept the terms and create their organization at `/onboarding`.
3. Suppliers prepare drafts and publish them (web, API or MCP — publication via an agent always needs explicit human approval).
4. Published supplier content becomes visible to other organizations only once an administrator verifies the organization (ADR-0011); suspension removes it again.

## Future: agent-to-agent

Supplier agents can be added as another adapter: an `engagement.notify` handler (or a new job type) can forward the **disclosure snapshot** of a confirmed engagement to a supplier agent endpoint, and a new use case can ingest structured technical responses as claims with `providedBy.via = 'import'` and provenance. Because disclosures are allow-listed snapshots, human confirmation precedes any exchange, and matching is evidence-based, no core change is required.

## Web app conventions (apps/web)

- **Refinement is links, not client state.** Search refinements (make a constraint a preference, remove it,
  reset) are plain links. The constraints travel as repeated `c` URL parameters
  (`apps/web/lib/constraints.ts`; e.g. `aspice~experience~hard~aspiceLevel=2`), so every view can be shared
  and reloaded. Comparison, CSV export and "save as private requirement" receive exactly the constraints the
  user sees.
- **Ontology data, never hard-coded labels.** Facet labels and concept lists come from `/v1/ontology`
  (`apps/web/lib/ontology.ts`, cached per request).
- **Layout.** Every table is wrapped in `TableScroll` (a labelled, focusable scroll region), so phones never
  scroll horizontally. `e2e/responsive.spec.ts` checks the main pages at 390 px for every role.
- **Errors.** `app/error.tsx` and `app/global-error.tsx` never show error internals. `lib/errors.ts` turns
  request-schema problems into per-field plain language; domain messages are already plain. Every page sets
  a title (template `%s · Automotive Technology Exchange`).
- **Supplier workspace.** `/workspace` is the overview (requests, drafts to review, offerings, uploads).
  `/workspace/offerings/[id]` edits one offering with its claims and evidence; `/workspace/organization`
  edits the profile and organization-level claims. Claim strength options come from `@atx/ui`
  `CLAIM_PREDICATE_OPTIONS`, ordered weakest first. `test/presentation.test.ts` keeps them identical to the
  domain wording.
