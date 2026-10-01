-- Pilot onboarding: terms acceptance and invitations (platform sign-up invitations
-- and, later, organization membership invitations share one table).

ALTER TABLE users
  ADD COLUMN terms_version     text,
  ADD COLUMN terms_accepted_at timestamptz;

CREATE TABLE invitations (
  id               uuid PRIMARY KEY,
  email            text NOT NULL CHECK (email = lower(email)),
  organization_id  uuid REFERENCES organizations(id),
  role             text CHECK (role IN ('viewer','editor','admin','owner')),
  token_hash       text NOT NULL UNIQUE,
  invited_by       uuid NOT NULL REFERENCES users(id),
  expires_at       timestamptz NOT NULL,
  accepted_at      timestamptz,
  accepted_by      uuid REFERENCES users(id),
  revoked_at       timestamptz,
  created_at       timestamptz NOT NULL,
  -- Organization invitations always carry a role; platform invitations never do.
  CHECK ((organization_id IS NULL) = (role IS NULL)),
  CHECK (NOT (accepted_at IS NOT NULL AND revoked_at IS NOT NULL))
);
CREATE INDEX invitations_email_idx ON invitations (email) WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX invitations_org_idx ON invitations (organization_id, created_at DESC);
