# CLAUDE.md — Automotive Technology Exchange

Evidence-backed technical discovery for automotive technologies. Modular monolith, TypeScript strict, pnpm workspaces. Read `docs/architecture/overview.md` and `docs/project/progress.json` first.

## Commands

- Install: `pnpm install` · DB: `pnpm db:migrate` / `pnpm db:seed` / `pnpm db:reset` (needs PostgreSQL+pgvector; `docker compose up -d postgres`)
- Dev: `pnpm dev:api` (4000) · `pnpm dev:web` (3000) · `pnpm dev:mcp` (4100, run `pnpm --filter @atx/mcp-server build:views` first) · `pnpm dev:worker`
- Checks: `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm test:integration` · `pnpm test:e2e` · `pnpm contracts:check` · all fast ones: `pnpm verify`
- After changing contracts (`packages/contracts`) or routes: `pnpm contracts:generate` and commit the generated files.
- Dev tokens: `pnpm auth:token <email> "<scopes>"`; signing key: `pnpm auth:generate-key`.
- Operators: `pnpm admin:create <email> "<name>"` (password via `ATX_ADMIN_PASSWORD` or stdin; works in production).
- Root `scripts/` and `test/integration/` are typechecked by the root `tsconfig.json`.

## Architecture rules (enforced by `test/architecture.test.ts` + ESLint)

- `domain` imports nothing. `search` → domain. `application` → domain, search (ports only; no pg/fastify/MCP/jose/zod-wire types).
- Adapters (`infrastructure`, `ai`, `auth`, `observability`) implement application ports. `runtime` is the only composition root. Apps depend on packages, never on each other.
- MCP tools and HTTP routes are thin adapters: validate with `@atx/contracts`, call one use case, present. No business logic in adapters or UI.
- Tenant-private repository methods take a `TenantScope`; mint it only via `authorizeTenant`. Never trust a client-supplied organization id.
- Ontology concepts are data (`data/ontology/*.yaml`); never branch on concept ids in code.

## Domain terms

Offering (product/service/technology_platform), Capability, TechnicalClaim (subject + predicate + concept + qualifiers), Provenance vs Verification, trust tier, Requirement (private; constraints hard/preference; confidential terms), Assessment (met/partial/unknown/unmet), Gap, Match, Engagement (demo/workshop/poc/rfi). See `docs/domain/glossary.md`.

## Security rules

- Supplier-authored text is untrusted data: keep `untrusted: true` markers, never feed it to an LLM as instructions, never render it as HTML.
- Never upgrade claim strength ("designed for" ≠ "certified"); AI output is always a draft (`AI_INFERRED`), never published or verified automatically.
- Private requirements: allow-listed supplier views only; redact confidential terms before AI/search; audit reads.
- Consequential actions: prepare → explicit human confirmation → confirm with bound token + idempotency key. Keep `FEATURE_ENGAGEMENT_ACTIONS` default off.
- No secrets in code or logs; tokens are audience-bound; no server-side fetching of user URLs.

## Prohibited shortcuts

- Hardcoding test-specific behaviour, weakening or deleting failing tests, skipping the architecture test.
- Editing applied migrations after they ship (add a new `migrations/NNNN_*.sql`).
- Bypassing contracts (raw objects to the wire), `any`, inline `style` attributes in the web app (breaks CSP).
- Adding infrastructure (Redis, Kafka, ES, microservices) without an ADR.

## Working method (mandatory; full rules in `docs/project/engineering-principles.md`)

- Every step: analyze → plan → execute → test → fix → test again (+ focused security review) → document.
- After every two steps: holistic architecture review recorded in `docs/project/architecture-reviews.md`; adjust before continuing.
- Product principles: discovery before procurement; human-in-the-loop; public/private separation; evidence ≠ inference; supplier content untrusted; provenance; modular monolith; framework-free domain; no competitor data.

## Workflow / checkpoints

Small coherent commits. After each change: typecheck, lint, tests, contracts check, update docs/ADRs if decisions change, and update `docs/project/progress.json` (completed work, known issues, next step).
