# ADR-0004: Authentication and token strategy

## Context

Users authenticate in the web app; AI agent hosts call the MCP server on a user's behalf. The MCP authorization spec requires the server to act as an OAuth 2.1 resource server: RFC 9728 protected resource metadata, audience-bound tokens (RFC 8707), 401/403 challenges with `WWW-Authenticate`, and no token passthrough.

## Decision

- Access tokens are ES256 JWTs (`typ: at+jwt`) with `iss`, `sub`, `aud`, `scope`, `exp`, `jti`. The API only accepts `aud = API_PUBLIC_URL`; the MCP server only `aud = MCP_PUBLIC_URL`.
- MVP identity provider: built-in email/password (scrypt) in the API; sessions carry the full scope ceiling while effective permissions are derived per request from memberships/roles.
- Agent tokens: users mint short-lived, narrowly scoped MCP tokens in the web UI (`/docs/mcp`) for hosts that accept bearer tokens.
- Production: configure `MCP_AUTH_ISSUER` + `MCP_AUTH_JWKS_URL` to an external OIDC/OAuth AS (Keycloak, Entra ID, Auth0…) supporting authorization code + PKCE and Client ID Metadata Documents; the MCP server advertises it in its protected resource metadata and validates tokens via JWKS.
- Web: Backend-for-frontend. The API token lives in an httpOnly, SameSite=Lax, Secure cookie; Server Actions provide CSRF protection (Origin/Host check); nonce-based CSP.

## Consequences

- The MCP server never forwards tokens; per-tool scope step-up via `insufficient_scope` challenges.
- Mapping external IdP subjects to platform users (just-in-time provisioning) is not implemented yet (known issue, next step).

## Alternatives considered

Opaque tokens + introspection (rejected for MVP latency/complexity); building a full OAuth AS in-house (rejected: security-critical, use a proven AS).
