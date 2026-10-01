# ADR-0015: Engagement notifications and contact handover

## Context

Engagement requests (ADR-0010) were only visible inside the supplier workspace; nobody was told about them, and the buyer never learned whom to talk to at the supplier.

## Decision

- **Supplier notification** (`engagement.notify` job, payload = engagement id only): every supplier member with role ≥ editor receives an email with metadata only (buyer organization, request type, offering, workspace link). The request message stays in the application. Delivery failures throw, so the job queue retries.
- **Contact handover**: acknowledging a request requires a supplier contact (name + email, prefilled with the responding user) and allows a reply; declining allows a note. The response is stored on the request (`supplier_response`, `responded_by`, `responded_at`), shown to the buyer, sanitized as untrusted text and audited. Status changes are guarded (`UPDATE … WHERE status = <previous>`), so a request cannot be answered twice.
- **Buyer notification** (`engagement.response_notify` job): the request's contact email is told that the supplier accepted or declined, with a link to `/buyer/requests`.
- Responding requires role ≥ editor and a verified email.

## Consequences

`FEATURE_ENGAGEMENT_ACTIONS` can be enabled for the pilot once SMTP is configured. Residual risk: a buyer can name any address as request contact, which then receives one status email; mitigated by invite-only registration and verified emails.
