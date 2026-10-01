# Deploying the pilot

This guide takes a clean environment to a running pilot. The reference topology is a **single VM** in
the pilot's region, plus **managed PostgreSQL** and an **SMTP relay** ([ADR-0019](../adr/0019-pilot-deployment-topology.md)).
Everything runs from the images CI publishes. The VM never builds from source.

```
            Internet (HTTPS only)
                    │
        ┌──────────── Caddy (TLS, ACME) ─────────────┐
 app.example.com      api.example.com       mcp.example.com
        │                    │                     │
      web (Next BFF) ──▶ api (Fastify) ◀── mcp-server (Streamable HTTP)
                             │      worker (jobs, retention purge)
                             ▼        │
              managed PostgreSQL 16 + pgvector     clamav (malware scan)
```

## 0. Before you start (go/no-go)

- [ ] The **terms of use and privacy notice** have been approved by counsel and replace the DRAFT pages in
      `apps/web/app/terms` and `apps/web/app/privacy`. Set `TERMS_VERSION` to the new identifier: users accept
      that version at sign-up, and acceptance is recorded.
- [ ] A **data processing agreement** is in place with each sub-processor: hosting, database, SMTP, and
      Anthropic if `AI_PROVIDER=anthropic`.
- [ ] Three DNS names exist (web, API, MCP) and point at the VM.
- [ ] All seed and demo content is synthetic. Production never loads `data/seed/demo.yaml`; `db:seed`
      skips it when `NODE_ENV=production`.
- [ ] `FEATURE_ENGAGEMENT_ACTIONS` is decided. It stays `false` unless the pilot agreement covers demo,
      workshop, PoC and RFI requests.

## 1. Images (CI)

Every push to `main` that passes typecheck, lint, unit, contract, integration and end-to-end tests
publishes two images to GHCR. Both are tagged with the full commit SHA and with `main`:

- `ghcr.io/<owner>/atx-node:<sha>`: API, MCP server, worker and operator commands (selected by `SERVICE`)
- `ghcr.io/<owner>/atx-web:<sha>`: the Next.js web app

Deploy by **SHA**, never by `main`, so that every release can be reproduced and rolled back. If the
packages are private, log the VM in with a read-only token:
`echo $TOKEN | docker login ghcr.io -u <user> --password-stdin`.

## 2. Infrastructure

| Component  | Requirement                                                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| VM         | 2 vCPU / 4 GB RAM + 2 GB swap is enough for a pilot (measured idle: ~1.5 GB total, of which ClamAV ~1 GB; ClamAV briefly doubles while reloading signatures) / 40 GB disk, Docker Engine + Compose v2, inbound 80/443 only, SSH restricted |
| PostgreSQL | 16 with the `vector` extension available (e.g. a managed service in the EU), TLS on, automated backups + point-in-time recovery, a dedicated `atx` role that owns the `atx` database                                                       |
| SMTP       | Authenticated relay with SPF, DKIM and DMARC aligned for the `MAIL_FROM` domain                                                                                                                                                            |
| Storage    | `STORAGE_DRIVER=filesystem` (a Docker volume, include it in backups) or an S3 bucket in the same region (`STORAGE_DRIVER=s3`, encryption at rest, no public access)                                                                        |

The migration runs `CREATE EXTENSION IF NOT EXISTS vector`. On managed services, either allow the `atx` role
to create it or create it once as the admin user.

## 3. Configure

On the VM:

```sh
git clone <repo> atx && cd atx/infra/deploy   # only compose.yml, Caddyfile and the env template are used
cp atx.env.example atx.env && chmod 600 atx.env
```

Fill in `atx.env`. The [environment reference](environment.md) lists every variable. Generate the secrets on a
trusted machine:

```sh
pnpm auth:generate-key          # AUTH_SIGNING_JWK: the private ES256 JWK, one line
openssl rand -base64 48         # CONFIRMATION_SECRET
openssl rand -base64 48         # ASSET_URL_SECRET (a different value)
```

Production refuses to start in any of these cases:

- development secrets are present;
- `MAIL_DRIVER` is file or memory;
- `CLAMAV_HOST` is missing;
- `DATABASE_SSL` is missing.

The error names the variables and never their values.

## 4. First release

```sh
C="docker compose --env-file atx.env"
$C pull
$C run --rm release pnpm db:seed        # migrations + ontology; no demo data in production
printf '%s' "$ADMIN_PASSWORD" | $C run --rm -T release pnpm admin:create ops@example.com "Platform Admin"
$C up -d
$C ps                                   # api should report (healthy)
```

`admin:create` reads the password from stdin or `ATX_ADMIN_PASSWORD`, never from argv. Use a password
manager entry. The administrator can then sign in at `https://app.example.com/login`.

## 5. Smoke test

```sh
curl -fsS https://api.example.com/readyz                                         # {"status":"ready"}
curl -fsS https://api.example.com/.well-known/oauth-authorization-server | head  # issuer = https://api.example.com
curl -fsS https://mcp.example.com/.well-known/oauth-protected-resource/mcp       # resource = https://mcp.example.com/mcp
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://mcp.example.com/mcp     # 401 with a WWW-Authenticate challenge
```

Then, in a browser:

1. Sign in as the administrator.
2. Create a platform invitation for a pilot supplier. Check that the email arrives and that its link points
   to `https://app.example.com`.
3. In a private window, accept the invitation. Verify the email, create the organization, and approve it in
   **Admin → Organization verification**.
4. Connect an MCP host (e.g. Claude) to `https://mcp.example.com/mcp`. The OAuth consent screen must appear,
   and `search_catalog` must work.

## 6. Subsequent releases

```sh
sed -i "s/^ATX_IMAGE_TAG=.*/ATX_IMAGE_TAG=<new sha>/" atx.env
$C pull && $C run --rm release pnpm db:migrate && $C up -d
```

Migrations are forward-only and applied migrations are never edited. Write them additively (expand, then
contract in a later release) so the previous image keeps working against the migrated schema. To **roll back**, set the previous SHA and run `$C up -d`. Do not
roll back the database except by point-in-time recovery, and only after an incident decision. When the
ontology changes (`data/ontology/*.yaml`), run `pnpm db:seed` instead of `db:migrate`. It is idempotent.

## 7. Afterwards

Follow the [runbook](runbook.md): backups and restore drills, key rotation, account and token revocation,
verification and moderation, monitoring.

## Local rehearsal

The same compose file runs locally over plain HTTP. Use images built with `docker build` and tagged
`local/atx-node:smoke` and `local/atx-web:smoke`, and add these settings to a copy of the env file:
`ATX_IMAGE_REGISTRY=local`, `ATX_IMAGE_TAG=smoke`, `ATX_SITE_SCHEME=http://`, `*.localhost` hosts,
`--profile local-db` with `DATABASE_SSL=off`. Secure cookies need HTTPS, so browser sign-in only works on
the real deployment; API, OAuth metadata and MCP can all be exercised with `curl --resolve`.
