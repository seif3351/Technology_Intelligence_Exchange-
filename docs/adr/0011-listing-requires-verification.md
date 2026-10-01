# ADR-0011: Public listing requires platform verification

## Context

Until now any registered organization could publish content that was immediately public, and suspending an organization did not remove its offerings from search, matching or offering pages (only the supplier page checked the state). For a pilot with real OEMs this allows impersonation ("Bosch GmbH" registered by anyone) and makes suspension ineffective.

## Decision

- One domain rule, `isPubliclyListed(org)`: an organization's published content is visible to other organizations only while its `verificationState` is `verified`.
- Unverified, pending, rejected and suspended organizations keep working on drafts and can publish internally; members and platform administrators can preview (`isInsider`).
- Enforcement points: `canViewOffering` / `canViewSupplier` policies (offering and supplier pages, compare, evidence), indexing (unlisted offerings are removed from the search index), and every public SQL read path via `listedOrganization()` (the SQL mirror of the rule: hydration of search/match results, structured candidates, supplier search, demo videos, concept counts). Defence in depth: even a stale search-index row is dropped at hydration.
- Verification changes enqueue a reindex for all published offerings of the organization.
- No configuration switch: a second policy would need a stored flag and recomputation; we add that only if open listing is ever needed (new ADR).

## Consequences

- Platform administrators must verify suppliers before buyers see them (the admin page shows the queue; `confirm_publication` tells agents when content is not yet listed).
- Synthetic demo organizations in `pending`/`unverified` state are no longer publicly visible, which demonstrates the gate.

## Alternatives considered

- Configurable policy (`verified` vs `not_suspended`): rejected for now (extra state and recomputation for no current need).
- Hiding only at the UI: rejected; MCP and API must enforce the same rule server-side.
