# ADR-0010: Consequential actions need explicit, bound confirmation

## Decision

Actions that disclose information or create commitments (demo/workshop/PoC/RFI requests, publishing anonymized demand) use two steps:

1. `prepare` builds the exact disclosure (allow-listed fields; confidential-term leak checks) and returns a preview plus an HMAC-signed token binding user, organization, action and a SHA-256 digest of the canonical payload (10 min TTL).
2. `confirm` requires that token, an idempotency key (unique per buyer org) and — over MCP — `user_confirmed: true`; any change to the payload invalidates the token. In MCP Apps hosts the approval checkbox lives in the rendered form itself.
   These tools are disabled by default (`FEATURE_ENGAGEMENT_ACTIONS`).

## Consequences

An agent cannot send anything the user did not see; replays are idempotent. Supplier notification delivery (email/webhook/supplier agents) plugs into the `engagement.notify` job.
