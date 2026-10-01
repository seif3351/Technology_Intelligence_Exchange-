# ADR-0013: Account emails, password reset and token revocation

## Context

Pilot users need password recovery, the platform needs proof of email ownership before people create organizations or contact suppliers, and a compromised session or agent token must be revocable. Access tokens are stateless JWTs.

## Decision

- **Mailer port** (`OutgoingEmail`: plain text only) with adapters: SMTP via nodemailer (production), file inbox (`MAIL_DIR`, development), in-memory (tests), disabled (`MAIL_DRIVER=none`). Production refuses the file/memory drivers.
- **Secret-bearing emails** (verification, password reset, invitations) are sent directly after the database commit, never through the job queue, so raw tokens are never persisted. Tokens are 256-bit, stored as SHA-256 hashes in `user_tokens` / `invitations`, single-use (conditional updates) and short-lived (reset 1 h, verification 3 days). Delivery is best effort; users can request again; failures are counted, never logged with content.
- **Email ownership**: accepting an email-bound invitation or completing a reset proves the address; open registrations receive a verification link. Creating an organization and confirming engagement requests require a verified email.
- **Password reset** never reveals whether an address is registered (always 202) and is limited to 3 emails per account and hour.
- **Revocation**: `users.credentials_changed_at`. `principalFor` (which already loads the user on every request) rejects tokens issued before it. Our tokens carry a millisecond `iat_ms` claim because `iat` (seconds) cannot order a token against a reset within the same second; external tokens fall back to `iat × 1000`. Password reset and "sign out everywhere" set the timestamp, invalidating web sessions and MCP agent tokens alike.

## Consequences

No extra infrastructure (no token store lookups beyond the user row already read). Per-token revocation (e.g. one agent token) is a separate concern (S6).

## Alternatives considered

- Outbox jobs for all emails: would persist raw secret links in `jobs.payload`.
- Token denylist table checked per request: more state for the same effect as a per-user cut-off.
