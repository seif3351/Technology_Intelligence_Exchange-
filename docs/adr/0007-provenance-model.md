# ADR-0007: Technical claims and provenance

## Decision

- A `TechnicalClaim` = subject (organization | offering | capability) + **closed predicate set** + **data-driven concept** + qualifiers (e.g. ASIL, certification body) + verbatim statement.
- Predicates encode distinctions that must never blur: `SUPPORTS`, `IMPLEMENTS`, `INTEGRATES_WITH`, `PROVIDES_CAPABILITY`, `TARGETS_DOMAIN`, `DESIGNED_FOR` (not a certification), `EXPERIENCE_WITH`, `PROCESS_COMPLIANT`, `CERTIFIED` (requires `certificationBody`), `PRODUCTION_DEPLOYMENT`.
- Requirements express a level (`mentioned < supports < experience < production < certified`) mapped to the predicates that can satisfy it (`SATISFYING_PREDICATES`).
- Provenance category (SUPPLIER_VERIFIED, PUBLIC_SOURCE, LICENSED_THIRD_PARTY, INTERNAL, AI_INFERRED, UNVERIFIED) is separate from platform verification (unreviewed, platform_verified, disputed, rejected). A derived trust tier drives display and scoring.
- Platform verification requires linked evidence and a human; substantive edits reset it; every change is versioned in `claim_revisions`. Database CHECK constraints back the critical rules.

## Consequences

"Designed for ASIL-B" can never satisfy "ASIL-B certified"; unknown is reported as unknown, not as unmet.
