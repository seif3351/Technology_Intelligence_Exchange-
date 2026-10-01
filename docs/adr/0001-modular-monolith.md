# ADR-0001: Modular monolith with ports & adapters

## Context

The product needs a web app, an HTTP API, a remote MCP server and background processing over one domain. Team size and traffic do not justify distributed services, but the domain must stay independent of frameworks so interfaces (MCP, A2A later) can be added without rewriting business logic.

## Decision

- One pnpm workspace, TypeScript (strict, TS 6.0) everywhere.
- `packages/domain` (pure model and invariants) ← `packages/search` (pure matching engine) ← `packages/application` (use cases + ports) ← adapters (`infrastructure`, `ai`, `auth`, `observability`) ← `packages/runtime` (single composition root) ← apps (`api`, `mcp-server`, `worker`, `web`).
- Dependency direction is enforced by `test/architecture.test.ts` and ESLint `no-restricted-imports`.
- Apps run with `tsx` (no separate build step for Node services); the web app uses Next.js.

## Consequences

- The core is testable without HTTP, MCP, PostgreSQL or an LLM (unit tests run in ~1 s).
- Any app can be extracted into its own deployable later; they already share nothing but packages.
- Running TypeScript through `tsx` in production trades a little startup time for simplicity; bundling with esbuild is a straightforward later optimization.

## Alternatives considered

Microservices (rejected: operational cost without a scaling need); NestJS-style framework DI (rejected: framework-driven domain, hidden service location).
