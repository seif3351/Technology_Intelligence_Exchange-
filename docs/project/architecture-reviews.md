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
