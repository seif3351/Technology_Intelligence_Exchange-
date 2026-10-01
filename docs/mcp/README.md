# MCP server

Remote MCP server for AI agent hosts. Protocol revision **2026-07-28** (stateless; `server/discover`; per-request envelope) via `@modelcontextprotocol/server` 2.2; 2025-era clients are served by the SDK's stateless fallback.

- Endpoint: `MCP_PUBLIC_URL` (default `http://localhost:4100/mcp`); run with `pnpm dev:mcp`.
- Authorization: OAuth 2.1 resource server. Metadata at `/.well-known/oauth-protected-resource/mcp`; invalid/missing tokens → 401 with `WWW-Authenticate: Bearer resource_metadata=…`; missing scopes → 403 `insufficient_scope` (step-up). Public catalog tools work anonymously unless `MCP_REQUIRE_AUTH=true`.
- Scopes: `catalog:read`, `requirements:read`, `requirements:write`, `engagements:write`.
- Development token: `pnpm auth:token buyer@aurelia-motors.example "catalog:read requirements:read requirements:write"` or generate one in the web app at `/docs/mcp`.
- Extensions: `io.modelcontextprotocol/ui` (MCP Apps, 7 views) and `io.modelcontextprotocol/skills` (the [ATX skill](skill.md)).
- Contracts: [tools.md](tools.md) and the generated JSON Schemas in `docs/api/json-schema/mcp-tools.json`.

## Example host configuration

```json
{
  "mcpServers": {
    "automotive-technology-exchange": {
      "type": "http",
      "url": "http://localhost:4100/mcp",
      "headers": { "Authorization": "Bearer <agent token>" }
    }
  }
}
```

## Design rules

- Tools are adapters over application use cases — no business logic in the MCP layer.
- Results are compact and stable: ids, short summaries, provenance, URLs, `nextCursor`; supplier text is `untrusted: true`.
- Errors are returned in-band (`isError: true`, `CODE: message`) so agents can recover.
- Every tool returns `structuredContent` and a concise text fallback; MCP App views are optional.
