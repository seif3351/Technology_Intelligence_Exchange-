# ADR-0003: Stateless remote MCP server as an adapter

## Context

AI agents are a primary channel. The MCP specification revision 2026-07-28 removed protocol sessions (`initialize`, `Mcp-Session-Id`), introduced `server/discover`, per-request `_meta` envelopes and list caching hints. The official TypeScript SDK v2 (`@modelcontextprotocol/server` 2.2) implements it with `createMcpHandler`.

## Decision

- `apps/mcp-server` builds a fresh `McpServer` per HTTP request via `createMcpHandler` (stateless; horizontally scalable). 2025-era clients are served by the SDK's stateless legacy fallback.
- Tools are thin adapters over application use cases; inputs/outputs are Zod contracts in `@atx/contracts` (`McpTools`) and are published as JSON Schema (`docs/api/json-schema/mcp-tools.json`).
- ~14 capability-level tools (search, match, explain, compare, evidence, demos, requirement drafts) instead of many tiny tools. Consequential actions (`prepare/confirm_engagement_request`) are only registered when `FEATURE_ENGAGEMENT_ACTIONS=true`.
- Results are compact (ids, short summaries, provenance, URLs); supplier text is marked `untrusted: true`; tool order is deterministic.
- MCP Apps (`io.modelcontextprotocol/ui`) are a progressive enhancement: 7 `ui://atx/*` views render structured results; every tool also returns `structuredContent` + concise text. Host support is detected from the request envelope's client capabilities.
- The Skills extension (`io.modelcontextprotocol/skills`, SEP-2640) serves `skills/` via `skills/list`, `skills/get` and `skill://` resources.

## Consequences

- No server-side session state; any instance can serve any request.
- Business rules are shared with the web/API (one application layer).
- View bundles are ~600 KiB because the Apps SDK includes its schema layer (known issue).

## Alternatives considered

Session-based Streamable HTTP (rejected: obsolete in 2026-07-28); exposing the REST API directly to agents (rejected: agents need compact, curated tools and skill guidance).
