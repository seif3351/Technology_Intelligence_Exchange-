# HTTP API

- Spec: [openapi.yaml](openapi.yaml) (OpenAPI 3.1, generated from the served route definitions by `pnpm contracts:generate`; CI fails on drift). Live: `GET /openapi.json`.
- Versioning: URL prefix `/v1`; additive changes only within a version.
- Errors: RFC 9457 `application/problem+json` with `code`, `detail`, `errors[]`, `requestId` (also in the `x-request-id` header).
- Auth: `Authorization: Bearer <JWT>` with `aud` = API URL. Obtain via `POST /v1/auth/login`; agent tokens for the MCP server via `POST /v1/auth/agent-tokens`.
- Pagination: opaque `cursor` + `limit` (≤ 50), deterministic ordering.
- Concurrency: writes take `expectedVersion`; stale writes → 409.
- Idempotency: `POST /v1/engagements` requires `idempotencyKey` (replays return the original).
- Untrusted content: supplier-authored fields are marked `untrusted: true`.
- JSON Schemas for MCP tools: [json-schema/mcp-tools.json](json-schema/mcp-tools.json).
