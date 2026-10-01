# Architecture Decision Records

| #                                                      | Decision                                                                                            | Status   |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | -------- |
| [0001](0001-modular-monolith.md)                       | Modular monolith with ports & adapters in a pnpm/TypeScript monorepo                                | Accepted |
| [0002](0002-postgresql-hybrid-search.md)               | PostgreSQL as system of record and hybrid search engine (full-text + pgvector + structured)         | Accepted |
| [0003](0003-mcp-architecture.md)                       | Stateless remote MCP server (2026-07-28) as an adapter over application use cases                   | Accepted |
| [0004](0004-authentication.md)                         | Authentication: built-in issuer for MVP, external OIDC for production; MCP as OAuth resource server | Accepted |
| [0005](0005-multi-tenancy.md)                          | Organization as tenant boundary, enforced by unforgeable TenantScope                                | Accepted |
| [0006](0006-ai-provider-abstraction.md)                | AI behind narrow ports with deterministic baselines and schema-validated outputs                    | Accepted |
| [0007](0007-provenance-model.md)                       | Claims with closed predicates, provenance category and separate verification                        | Accepted |
| [0008](0008-asset-processing.md)                       | Asynchronous asset pipeline on a PostgreSQL job queue                                               | Accepted |
| [0009](0009-data-driven-ontology.md)                   | Data-driven ontology (YAML → PostgreSQL) instead of code enums                                      | Accepted |
| [0010](0010-consequential-actions.md)                  | Consequential actions require prepare/confirm with bound confirmation tokens                        | Accepted |
| [0011](0011-listing-requires-verification.md)          | Published content is public only while the organization is platform-verified                        | Accepted |
| [0015](0015-engagement-notifications.md)               | Engagement notifications (metadata-only, queued) and supplier contact handover                      | Accepted |
| [0014](0014-organization-membership-administration.md) | Organization invitations with roles, role ceilings and last-owner protection                        | Accepted |
| [0013](0013-account-email-and-revocation.md)           | Account emails via a Mailer port, password reset, per-user token revocation cut-off                 | Accepted |
| [0012](0012-invite-only-registration.md)               | Invite-only registration with hashed, single-use, email-bound invitations                           | Accepted |

Template: Context → Decision → Consequences → Alternatives considered. Supersede, never edit, accepted ADRs.
