# ADR-0017: Built-in OAuth 2.1 authorization server for MCP hosts

Supersedes the "external OIDC for production" expectation of ADR-0004 for the pilot; the external-IdP seam (`MCP_AUTH_ISSUER`, `MCP_AUTH_JWKS_URL`) remains.

## Context

Hosted MCP clients (e.g. Claude custom connectors) authenticate users through MCP authorization (OAuth 2.1): protected resource metadata → authorization server metadata → client registration → authorization code with PKCE. Static bearer headers (agent tokens) only work in some hosts. Running an external IdP (Keycloak, Auth0, …) for the pilot adds infrastructure, operations and a user-mapping layer.

## Decision

A minimal authorization server inside the modular monolith (API service, issuer = `AUTH_ISSUER` / `API_PUBLIC_URL`), with protocol rules in `OAuthService` and the domain (`oauth.ts`):

- **Metadata** (RFC 8414) at `/.well-known/oauth-authorization-server`; the MCP server's RFC 9728 metadata points to it.
- **Clients**: public clients only, registered dynamically (RFC 7591, `/oauth/register`). Redirect URIs: https, loopback http (any port, RFC 8252) or private-use schemes; exact matching otherwise. Client names are self-asserted and labelled as such on the consent screen, which also shows the redirect origin. Client ID Metadata Documents are **not** supported: they require fetching client-supplied URLs server-side, which the security rules forbid (SSRF).
- **Authorization**: `response_type=code`, PKCE `S256` mandatory, `resource` must be the MCP server (RFC 8707), `iss` in the response (RFC 9207). Consent on the web (`/oauth/authorize`), only from a first-party session (an agent can never approve itself); granted scopes are capped by the user's scopes; `admin` is never delegable.
- **Tokens**: single-use codes (10 min, hash stored, replay revokes the grant); 1 h access tokens audience-bound to the MCP server and tied to an `oauth` access grant (ADR-0016); 30-day rotating refresh tokens (hash stored) — reuse of a rotated token revokes the grant (OAuth 2.1 §4.3.1). Grants last at most 90 days. Revocation endpoint (RFC 7009) and "Connected applications" on the account page.
- **Least privilege**: when MCP authentication is required, the initial 401 challenge asks for `catalog:read`; hosts step up through the existing per-tool `insufficient_scope` challenges.
- OAuth endpoints use RFC 6749 error bodies, `Cache-Control: no-store`, form-encoded token requests and permissive CORS (no cookies); all other API routes keep the configured CORS origins.

## Consequences

Claude-style hosts connect with only the server URL. The full flow is tested with the official MCP client SDK (`test/integration/oauth.int.test.ts`) and in the browser (Playwright). Moving to an external IdP later: set `MCP_AUTH_ISSUER`/`MCP_AUTH_JWKS_URL` and map external subjects to users (not implemented).

## Alternatives considered

- External IdP now: more infrastructure and an account-mapping layer before the first pilot user.
- CIMD with an SSRF-hardened fetcher: rejected for now by the no-server-side-fetch rule; revisit if hosts drop DCR.
