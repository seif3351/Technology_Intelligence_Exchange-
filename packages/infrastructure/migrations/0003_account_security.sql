-- Email ownership, password reset and session revocation.

ALTER TABLE users
  ADD COLUMN email_verified_at     timestamptz,
  -- Tokens issued before this instant are rejected (password reset, "sign out everywhere").
  ADD COLUMN credentials_changed_at timestamptz;

-- Accounts that existed before email verification (operators, seeded demo users) are treated as verified.
UPDATE users SET email_verified_at = created_at;

CREATE TABLE user_tokens (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id),
  purpose     text NOT NULL CHECK (purpose IN ('email_verification','password_reset')),
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL
);
CREATE INDEX user_tokens_user_idx ON user_tokens (user_id, purpose, created_at DESC);
