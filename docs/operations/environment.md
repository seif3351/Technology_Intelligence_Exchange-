# Environment reference

All runtime configuration comes from environment variables. They are validated once in
`packages/config` (`loadConfig`). An **empty value counts as unset.** Variables marked **secret** must
come from a secret store or a `chmod 600` env file. They must never be committed or logged, and
validation errors name variables, never values. In `infra/deploy/compose.yml` the left-hand group is
derived from the three host names, so most deployments set only the variables in
`infra/deploy/atx.env.example`.

## Production guard

`NODE_ENV=production` refuses to start in any of these cases:

- `CONFIRMATION_SECRET` or `ASSET_URL_SECRET` is left at its development default;
- there is no `AUTH_SIGNING_JWK` (or external `MCP_AUTH_JWKS_URL`);
- `MAIL_DRIVER` is `file` or `memory`;
- `CLAMAV_HOST` is missing;
- `DATABASE_SSL` is not set explicitly;
- `STORAGE_DRIVER=s3` is set without `S3_BUCKET`.

In any environment, `MAIL_DRIVER=smtp` requires `SMTP_URL`, `AI_PROVIDER=anthropic` requires
`ANTHROPIC_API_KEY`, and `EMBEDDINGS_PROVIDER=http` requires `EMBEDDINGS_URL`.

## Core

| Variable                   | Default              | Notes                                                                                     |
| -------------------------- | -------------------- | ----------------------------------------------------------------------------------------- |
| `NODE_ENV`                 | `development`        | `production` enables the guard above, secure cookies, HSTS (web over https), no demo seed |
| `LOG_LEVEL`                | `info`               | pino levels; logs are JSON on stdout                                                      |
| `DATABASE_URL`             | local dev DB         | **secret** (contains the password)                                                        |
| `DATABASE_MAX_CONNECTIONS` | `10`                 | per process (api, mcp-server, worker each hold a pool)                                    |
| `DATABASE_SSL`             | — (required in prod) | `verify` (recommended), `require`, or `off` (private network only)                        |
| `DATABASE_SSL_CA`          | —                    | PEM of the provider CA for `verify`                                                       |
| `MIGRATE_ON_START`         | `true`               | the deploy compose sets `false`; run `pnpm db:migrate` as a release step                  |

## URLs, hosts and network

| Variable                     | Default                     | Notes                                                                            |
| ---------------------------- | --------------------------- | -------------------------------------------------------------------------------- |
| `PUBLIC_WEB_URL`             | `http://localhost:3000`     | links in emails, OAuth consent page, CSV export links                            |
| `API_PUBLIC_URL`             | `http://localhost:4000`     | OAuth issuer (unless `AUTH_ISSUER`) and token audience                           |
| `MCP_PUBLIC_URL`             | `http://localhost:4100/mcp` | the protected resource; agent and OAuth tokens are bound to it                   |
| `API_PORT`/`MCP_PORT`        | `4000`/`4100`               |                                                                                  |
| `CORS_ORIGINS`               | `http://localhost:3000`     | comma-separated; also the allowed `Origin`s for browser calls to MCP             |
| `ALLOWED_HOSTS`              | `localhost,127.0.0.1`       | MCP `Host` allow-list (DNS-rebinding protection); must include the MCP host name |
| `TRUSTED_PROXIES`            | loopback                    | proxies whose `X-Forwarded-For` is trusted (rate limits use the client IP)       |
| `AUTH_RATE_LIMIT_PER_MINUTE` | `10`                        | per IP for login, registration, reset, token endpoints                           |

## Authentication and secrets

| Variable                               | Default                     | Notes                                                                                                  |
| -------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------ |
| `AUTH_SIGNING_JWK`                     | dev key file                | **secret**; private ES256 JWK (`pnpm auth:generate-key`). Rotating it signs everyone out (see runbook) |
| `AUTH_DEV_KEY_FILE`                    | `.var/dev-signing-key.json` | development only: where the auto-generated signing key is kept when `AUTH_SIGNING_JWK` is unset        |
| `AUTH_ISSUER`                          | `API_PUBLIC_URL`            |                                                                                                        |
| `MCP_AUTH_ISSUER`, `MCP_AUTH_JWKS_URL` | —                           | only to delegate MCP authorization to an external authorization server                                 |
| `MCP_REQUIRE_AUTH`                     | `false`                     | `true` in the deploy compose: anonymous MCP calls get the OAuth challenge                              |
| `CONFIRMATION_SECRET`                  | dev value                   | **secret**, ≥32 chars; binds consequential-action confirmation tokens                                  |
| `ASSET_URL_SECRET`                     | dev value                   | **secret**, ≥32 chars; signs time-limited asset URLs                                                   |

## Storage and content safety

| Variable                                                       | Default                       | Notes                                                                                                                                                                           |
| -------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STORAGE_DRIVER`                                               | `filesystem`                  | or `s3`                                                                                                                                                                         |
| `STORAGE_DIR`                                                  | `.var/storage`                | `/data/storage` (a volume shared by api and worker) in images                                                                                                                   |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` | —, `eu-central-1`, —, `false` | credentials come from the standard AWS provider chain                                                                                                                           |
| `CLAMAV_HOST`, `CLAMAV_PORT`                                   | —, `3310`                     | required in production; uploaded assets are processed only after a clean scan (fail closed: a scanner outage delays processing via job retries; infected files are quarantined) |

## Email

| Variable      | Default                                               | Notes                                         |
| ------------- | ----------------------------------------------------- | --------------------------------------------- |
| `MAIL_DRIVER` | `file`                                                | `smtp` in production; `none` disables mail    |
| `SMTP_URL`    | —                                                     | **secret**, e.g. `smtps://user:pass@host:465` |
| `MAIL_FROM`   | `Automotive Technology Exchange <no-reply@localhost>` | must be a domain with SPF/DKIM/DMARC          |
| `MAIL_DIR`    | `.var/mail`                                           | development inbox for `MAIL_DRIVER=file`      |

## Product policy

| Variable                     | Default         | Notes                                                                        |
| ---------------------------- | --------------- | ---------------------------------------------------------------------------- |
| `REGISTRATION_MODE`          | `invite`        | `open` lets anyone register (organizations still need verification to list)  |
| `TERMS_VERSION`              | `pilot-2026-10` | bump whenever the terms change; acceptance is recorded per user              |
| `FEATURE_ENGAGEMENT_ACTIONS` | `false`         | consequential buyer requests (demo/workshop/PoC/RFI); keep off unless agreed |

## AI and search (optional)

| Variable                                                   | Default                        | Notes                                                                     |
| ---------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------- |
| `AI_PROVIDER`                                              | `none`                         | `anthropic` enables AI drafts (always `AI_INFERRED`, never auto-verified) |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`                     | —, `claude-opus-5-5`           | **secret** key                                                            |
| `EMBEDDINGS_PROVIDER`                                      | `hashing`                      | `none`, `hashing` (deterministic, no network), or `http`                  |
| `EMBEDDINGS_URL`, `EMBEDDINGS_API_KEY`, `EMBEDDINGS_MODEL` | —, —, `text-embedding-3-small` | **secret** key                                                            |

## Observability

| Variable                      | Default | Notes                        |
| ----------------------------- | ------- | ---------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | —       | OTLP/HTTP traces and metrics |
| `OTEL_SERVICE_NAMESPACE`      | `atx`   |                              |

## Web app only

| Variable             | Default                     | Notes                                                       |
| -------------------- | --------------------------- | ----------------------------------------------------------- |
| `API_INTERNAL_URL`   | `http://localhost:4000`     | server-side BFF calls to the API (private network)          |
| `MCP_PUBLIC_URL`     | `http://localhost:4100/mcp` | shown on the MCP connection page                            |
| `PUBLIC_WEB_URL`     | —                           | HSTS is sent when it is `https://…` in production           |
| `SHOW_DEMO_ACCOUNTS` | unset                       | `true` lists the synthetic demo logins; never in production |

## Deploy compose only (`infra/deploy`)

`ATX_IMAGE_REGISTRY`, `ATX_IMAGE_TAG` (commit SHA), `ATX_WEB_HOST`, `ATX_API_HOST`, `ATX_MCP_HOST`, `ACME_EMAIL`,
`POSTGRES_PASSWORD` (with `--profile local-db`), and `ATX_SITE_SCHEME` (`http://` for local rehearsal only).
