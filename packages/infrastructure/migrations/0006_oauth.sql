-- Built-in OAuth 2.1 authorization server for MCP hosts (ADR-0017).

CREATE TABLE oauth_clients (
  client_id     text PRIMARY KEY,
  client_name   text NOT NULL,
  redirect_uris text[] NOT NULL CHECK (cardinality(redirect_uris) BETWEEN 1 AND 10),
  client_uri    text,
  created_at    timestamptz NOT NULL
);

CREATE TABLE oauth_authorization_codes (
  code_hash      text PRIMARY KEY,
  client_id      text NOT NULL REFERENCES oauth_clients(client_id),
  user_id        uuid NOT NULL REFERENCES users(id),
  grant_id       uuid NOT NULL REFERENCES access_grants(id),
  redirect_uri   text NOT NULL,
  code_challenge text NOT NULL,
  scopes         text[] NOT NULL,
  resource       text NOT NULL,
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz,
  created_at     timestamptz NOT NULL
);

CREATE TABLE oauth_refresh_tokens (
  token_hash  text PRIMARY KEY,
  grant_id    uuid NOT NULL REFERENCES access_grants(id),
  client_id   text NOT NULL REFERENCES oauth_clients(client_id),
  user_id     uuid NOT NULL REFERENCES users(id),
  scopes      text[] NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL
);
CREATE INDEX oauth_refresh_tokens_grant_idx ON oauth_refresh_tokens (grant_id);
