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
