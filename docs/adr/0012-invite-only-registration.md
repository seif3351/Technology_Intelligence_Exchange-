# ADR-0012: Invite-only registration and invitations

## Context

Pilot users must be able to create accounts and organizations themselves through the web app, but open registration plus immediate publication would let anyone join. The operator also needs terms acceptance on record.

## Decision

- `REGISTRATION_MODE` = `invite` (default) | `open`. In invite mode `register` requires an invitation token; any mode requires `acceptTerms: true`, and the accepted `TERMS_VERSION` and time are stored on the user.
- One `invitations` table for platform sign-up invitations (organization null, issued by platform admins) and organization membership invitations (organization + role, issued by organization admins — see S4). Tokens are 256-bit random, URL-safe, shown once; only their SHA-256 hash is stored. Invitations are bound to the invited email, expire after 14 days and are single-use (conditional `UPDATE … WHERE pending` inside the registration transaction).
- Token lookup is a POST with the token in the body (kept out of access logs), rate-limited, and returns the same 404 for unknown, used, revoked and expired tokens. The web sign-up page receives the token in the link (`/signup?invite=…`); `Referrer-Policy: strict-origin-when-cross-origin` prevents leaking it to other sites.
- Operators create the first administrator with `pnpm admin:create` (S1).

## Consequences

Admins share invitation links manually until email delivery exists (S3), after which invitations are also emailed. Registration remains enumeration-resistant (uniform failures).
