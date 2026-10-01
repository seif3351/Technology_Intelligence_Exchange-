-- Persisted, individually revocable grants behind long-lived access tokens
-- (personal agent tokens now, OAuth client grants later).
CREATE TABLE access_grants (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id),
  kind         text NOT NULL CHECK (kind IN ('agent_token','oauth')),
  label        text NOT NULL,
  client_id    text,
  scopes       text[] NOT NULL,
  created_at   timestamptz NOT NULL,
  expires_at   timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX access_grants_user_idx ON access_grants (user_id, created_at DESC);
