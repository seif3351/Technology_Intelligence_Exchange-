# Automotive Technology Exchange

AI-native B2B technology discovery and technical matchmaking for the automotive ecosystem (software-defined vehicle, ADAS, AUTOSAR, middleware, validation & testing, functional safety, cybersecurity).

A buyer — or the buyer's own AI agent over MCP — describes a technical requirement. The platform interprets it into **hard constraints, preferences and unknown terms**, evaluates published offerings against **structured, provenance-tracked technical claims**, and explains every match: what is met, partial, unknown or not met, on what evidence (platform-verified, supplier-stated with documents, supplier-stated, public source, AI-inferred), and what to ask the supplier next.

> Discovery before procurement. ATX is not an ERP, procurement, payment or contract system. All seed data is synthetic (fictitious suppliers on reserved example domains).

## Interfaces

| Interface                                         | Path                    | Port |
| ------------------------------------------------- | ----------------------- | ---- |
| Web app (buyers, suppliers, admins)               | `apps/web` (Next.js 16) | 3000 |
| HTTP API (`/v1`, OpenAPI 3.1 at `/openapi.json`)  | `apps/api` (Fastify 5)  | 4000 |
| Remote MCP server (2026-07-28, Skills + MCP Apps) | `apps/mcp-server`       | 4100 |
| Background worker (ingestion, indexing)           | `apps/worker`           | —    |

## Quick start (from a clean checkout)

Prerequisites: Node 22.12+, pnpm 10 (`corepack enable`), PostgreSQL 16 with pgvector — e.g. `docker compose up -d postgres`.

```bash
pnpm install
cp .env.example .env                       # defaults work for local development
pnpm db:reset                              # migrate + ontology + synthetic demo data
pnpm --filter @atx/mcp-server build:views  # MCP App views
pnpm dev:api      # http://localhost:4000   (separate terminals)
pnpm dev:web      # http://localhost:3000
pnpm dev:mcp      # http://localhost:4100/mcp
pnpm dev:worker
```

Demo accounts (password `demo-password-2026`): `buyer@aurelia-motors.example`, `owner@vectorforge.example`, `owner@northstar-ai.example`, `owner@drivemesh.example`, `admin@atx.example`.

Try: `I need an AUTOSAR Adaptive middleware solution for QNX and NVIDIA Orin with SOME/IP support.`

Full stack in containers: `export AUTH_SIGNING_JWK=$(pnpm -s auth:generate-key) && docker compose --profile app up --build`.

## Quality gates

```bash
pnpm typecheck          # all workspaces (strict TS 6)
pnpm lint               # ESLint incl. architectural import rules
pnpm test               # unit + architecture tests (no I/O)
pnpm test:integration   # PostgreSQL-backed API + MCP tests (DATABASE_URL_TEST, default postgres://atx:atx@localhost:5432/atx_test)
pnpm test:e2e           # Playwright journeys (resets the DATABASE_URL database!)
pnpm contracts:check    # OpenAPI + MCP JSON Schemas up to date
```

## Documentation

- Architecture: [overview](docs/architecture/overview.md) · [C4 context](docs/architecture/c4-context.md) · [C4 containers](docs/architecture/c4-container.md) · [search & matching](docs/architecture/search-and-matching.md)
- Decisions: [ADRs](docs/adr/README.md) · Security: [threat model](docs/security/threat-model.md)
- Domain: [ontology](docs/domain/ontology.md) · [glossary](docs/domain/glossary.md)
- MCP: [server](docs/mcp/README.md) · [tools](docs/mcp/tools.md) · [skill](docs/mcp/skill.md) · API: [openapi.yaml](docs/api/openapi.yaml)
- Progress & next steps: [docs/project/progress.json](docs/project/progress.json)
