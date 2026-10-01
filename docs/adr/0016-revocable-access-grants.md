# ADR-0016: Revocable access grants for long-lived agent tokens

## Context

Personal agent tokens were stateless JWTs capped at 24 hours: agents needed a new token every day and a leaked token could not be revoked individually (only "sign out everywhere", ADR-0013).

## Decision

- `access_grants` table (kind `agent_token`, later `oauth`): label, client id, scopes, expiry, last use, revocation. Tokens carry the grant id in a `grant` claim.
- `IdentityService.principalFor` rejects tokens whose grant is missing, foreign, revoked or expired, and records use at most every 5 minutes (keeps the hot path to one indexed read plus a rare write).
- Agent tokens: 1–90 days (default 30), scopes capped by the issuing user's current scopes, minted **only from first-party sessions** (principals without a client id), so an agent cannot mint itself further tokens. Issuance moved from the HTTP route into `AgentTokenService` behind an `AccessTokenSigner` port (business rules out of the adapter).
- The MCP server resolves the principal during token verification, so revoked grants and credential changes produce a standard 401 `invalid_token` challenge rather than a server error. Unexpected verification failures are logged (never the token).

## Consequences

Users manage tokens on the MCP page (name, scopes, status, last use, revoke). Tokens without a grant claim (operator CLI, tests) remain valid until expiry (max 90 days ceiling in the issuer).
