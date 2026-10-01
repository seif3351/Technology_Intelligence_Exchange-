# Architecture reviews

Holistic reviews required after every two implementation steps (see `engineering-principles.md`).
Each entry: scope, findings, actions taken, deferred items.

## R1 — after S1 (admin bootstrap) and S2 (invite-only onboarding, listing gate) — 2026-10-01

**Scope:** layering, coupling, duplication, file sizes, security boundaries, data classification, docs.

| #   | Finding                                                                                                     | Action                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | `services/supplier.ts` reached 1 000 lines; agent publication (prepare/confirm) is a separate concern.      | Extracted `PublicationService` (`app.publication`) and shared `supplier-access.ts` helpers (`supplierWriteScope`, `ownedOffering`, `ownedClaim`). supplier.ts now 807 lines. |
| F2  | Email syntax regex duplicated in identity, invitations and engagements.                                     | Moved to domain `email.ts` (`normalizeEmail`, `isPlausibleEmail`).                                                                                                           |
| F3  | `digest` (confirmation binding) imported by three services from `requirements.ts` (cross-service coupling). | Moved to `services/support.ts`.                                                                                                                                              |
| F4  | `contracts/src/mcp.ts` at 681 lines.                                                                        | Deferred: purely declarative schema map; splitting needs a shared-primitives module to avoid a cycle. Revisit above 800 lines.                                               |
| F5  | Listing rule exists twice (domain `isPubliclyListed`, SQL `listedOrganization`).                            | Accepted and documented in ADR-0011; behaviour covered by API, MCP and Playwright tests.                                                                                     |
| F6  | Root `scripts/` and `test/` were never typechecked.                                                         | Root `tsconfig.json` added to `pnpm typecheck` (S1).                                                                                                                         |
| F7  | Existing defect: suspended organizations stayed discoverable.                                               | Fixed by ADR-0011 enforcement.                                                                                                                                               |

**Boundaries:** application still depends only on domain/search/ports (plus `node:crypto`); no adapter contains business rules (sign-up pages call one API use case each). Architecture test green.

**Data classification:** invitation tokens are SECRET (only hashes stored, shown once); invitee emails are personal data (TENANT_PRIVATE for organization invitations, SYSTEM for platform invitations); terms acceptance is SYSTEM.

**Operational complexity:** unchanged (no new infrastructure).

## R2 — after S3 (account emails, reset, revocation) and S4 (organization membership) — 2026-10-01

**Scope:** same checklist as R1, plus the new identity/account/invitation/membership services.

| #   | Finding                                                                                                                                                                 | Action                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| G1  | Secret-token format repeated in 4 contracts and 3 web pages.                                                                                                            | Single `SecretToken` schema in contracts; web pages validate with it.                                           |
| G2  | `InvitationLookup` duplicated `SecretTokenBody`.                                                                                                                        | Removed; lookup uses `SecretTokenBody`.                                                                         |
| G3  | Each authenticated request now loads user + memberships (2 small indexed queries) to support per-request roles and token revocation.                                    | Accepted for the pilot; cache only if profiling shows a need.                                                   |
| G4  | Security: invitation emails embed user-controlled names (inviter, organization), usable to smuggle phishing links through our sender reputation.                        | `plainName()` strips URL-like text from names in all outgoing emails; unit-tested.                              |
| G5  | Web members page duplicated the role order (the web may not import the domain).                                                                                         | Uses `OrganizationRoleEnum.options` from the API contract.                                                      |
| G6  | Service cohesion: identity (registration, principals), account (self-service security), invitations (all invitation kinds, one issuing path), members (administration). | Accepted; no service over 400 lines except supplier (798) and catalog.                                          |
| G7  | e2e flakiness root causes were test races (`role=alert` also matches Next's route announcer; typing before client-side navigation completed), not timing.               | Tests wait for specific content; e2e now runs on the production web build (no on-demand compilation, real CSP). |

**Boundaries:** architecture test green; web still depends only on contracts/ui/config; secret links never enter the job queue or logs (asserted in tests).

**Data classification:** `user_tokens` and invitation tokens are SECRET (hash only); member emails are TENANT_PRIVATE (visible to fellow members only); audit metadata contains no tokens or links (tested).

**Operational complexity:** one new external dependency (SMTP provider) behind the Mailer port; the platform still runs without it (`MAIL_DRIVER=none`).

## R3 — after S5 (engagement notifications) and S6 (revocable agent tokens) — 2026-10-01

| #   | Finding                                                                                                                                                                               | Action                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | Web session issuance (scope ceiling, 8 h lifetime, audience) was still hard-coded in the HTTP route while agent tokens moved into the application. Token policy belongs in one place. | `IdentityService.issueSession` via the `AccessTokenSigner` port; the route only shapes the response. The only remaining direct issuer use is the operator dev CLI and JWKS publication. |
| H2  | An untyped SQL parameter (`$2 - interval`) made every MCP request with a grant-backed token fail as an opaque 500; verification errors were not logged.                               | Explicit cast; unexpected verifier failures are logged (without tokens); regression covered by the agent-token MCP test. Lesson recorded: cast parameters used in arithmetic.           |
| H3  | Supplier notifications send one email per responder inside one job; a partial failure retries the whole job (duplicates for earlier recipients).                                      | Accepted for the pilot (small organizations); per-recipient jobs if it becomes noisy.                                                                                                   |
| H4  | Principal resolution per request: user + memberships, plus grant lookup for agent tokens (one indexed read; last-use write at most every 5 minutes).                                  | Accepted; no caching needed at pilot scale.                                                                                                                                             |
| H5  | The MCP server previously resolved principals in the handler factory, after authentication succeeded, so account-level rejections could not produce OAuth challenges.                 | Principal now resolved inside the token verifier (S6); applies to all future token kinds (OAuth in S7).                                                                                 |

**Boundaries:** application owns all token policy (sessions, agent tokens; OAuth next) behind `AccessTokenSigner`; adapters translate only. Architecture test green.

**Security posture change:** agent tokens are long-lived (≤ 90 days) but individually revocable, scope-capped and not self-mintable by agents; sign-out-everywhere still cuts all of them.

## R4 — after S7 (built-in OAuth authorization server) and S8 (production hardening) — 2026-10-01

| #   | Finding                                                                                                                                                                                                                                                                                      | Action                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| J1  | Data minimisation: expired/used authorization codes, refresh tokens and account tokens, finished jobs and never-used dynamically registered OAuth clients accumulated forever (needless retained security material; unused registrations are an abuse vector of the open `/oauth/register`). | `RetentionRepository` port + `MaintenanceService.purgeExpired` (system principal), run hourly by the worker; audit events are never purged; integration-tested. |
| J2  | `services/oauth.ts` is 410 lines but cohesive around one protocol; domain rules (redirect policy, PKCE formats, resource canonicalisation) live in `domain/oauth.ts`.                                                                                                                        | Accepted.                                                                                                                                                       |
| J3  | Built-in authorization server and external IdP seam coexist (`MCP_AUTH_ISSUER` decides what the MCP server advertises).                                                                                                                                                                      | Consistent with ADR-0017; external subject mapping remains a known issue.                                                                                       |
| J4  | The production configuration guard adds operational friction (ClamAV and explicit DB TLS mandatory).                                                                                                                                                                                         | Accepted deliberately; documented in `.env.example` and compose.                                                                                                |
| J5  | The ontology change (per-concept `default_level`) stayed data-driven: no concept ids in code; interpreter precedence is cue → concept → facet → `supports`.                                                                                                                                  | Accepted; covered by interpreter unit test and the supplier/OEM skill test.                                                                                     |

**Boundaries:** OAuth protocol rules are in the application/domain; the HTTP adapter only maps form bodies, RFC 6749 errors and headers. Architecture test green.

**Security:** OAuth tested end to end with the official MCP client SDK (including replay, reuse and consent abuse); `pnpm audit` clean.
