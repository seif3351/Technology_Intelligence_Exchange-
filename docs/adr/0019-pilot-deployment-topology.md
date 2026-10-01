# ADR-0019: Pilot deployment topology: one VM, published images, Caddy at the edge

## Context

The pilot needs a deployment that a small team can run, reproduce, roll back and audit. The services
are four processes: web, API, MCP server and worker. They depend on PostgreSQL with pgvector, SMTP and
ClamAV. They need public HTTPS on three origins: the web app, the API (OAuth issuer and token endpoint)
and the MCP resource, whose URL is part of every token audience. Adding infrastructure needs an ADR
(CLAUDE.md).

## Decision

- **Images**: CI publishes `atx-node` (api, mcp-server, worker and operator commands, selected by
  `SERVICE`) and `atx-web` to GHCR. Publishing happens only from `main` and only after every test suite
  passes on that commit. Images are tagged with the full commit SHA, and deployments pin a SHA. The VM
  never builds from source. Images run as a non-root user. Operator commands (`pnpm db:migrate`,
  `db:seed`, `admin:create`, `admin:revoke-access`) run from the same image with the same configuration.
- **Topology**: a single VM in the pilot's region runs `infra/deploy/compose.yml`:
  - **Caddy** terminates TLS with automatic ACME certificates for the three host names and is the only
    service that publishes ports;
  - **ClamAV** runs on the VM;
  - **PostgreSQL** is a managed service with TLS (`DATABASE_SSL=verify`), backups and PITR. A `local-db`
    profile exists for rehearsals.
- **Releases**: migrations are an explicit step (`MIGRATE_ON_START=false`, `release` service) before
  `up -d`. Migrations are additive, so image rollback is safe. A schema rollback is a point-in-time
  restore.
- **Network trust**: only the reverse proxy and the BFF may set `X-Forwarded-For` (`TRUSTED_PROXIES` is
  the private compose subnet). The MCP server keeps its own `Host` and `Origin` allow-lists
  (defence in depth: Caddy does not route unknown hosts).
- **Configuration**: `loadConfig` treats empty variables as unset, because orchestrators pass optional
  variables as `''`. The production guard still treats an empty secret as missing.

## Consequences

- Deployment, rollback and the smoke test are a handful of documented commands
  (`docs/operations/deployment.md`). A local rehearsal of the same compose file runs over HTTP.
- A single VM is a single point of failure. Recovery time is bounded by re-provisioning plus a database
  that survives independently, which is acceptable for a pilot with announced maintenance windows.
- Scaling beyond one VM needs distributed rate limiting and a shared asset store (`STORAGE_DRIVER=s3`).
  The services are already stateless apart from the filesystem storage driver.
- The image contains the full workspace with dev tooling (tsx), about 1.3 GB. It is simpler and identical
  to what CI tests. A pruned production image is a later optimisation.

## Alternatives considered

- **Kubernetes / managed container platform**: more moving parts than a pilot needs. The images and the
  release step carry over unchanged when the pilot grows.
- **nginx + certbot**: works, but needs manual renewal wiring. Caddy's automatic HTTPS is less to
  operate.
- **Building on the VM from source**: not reproducible, and it puts build tooling and source on the
  production host.
- **Migrations on API start**: races between replicas and hides failures in a restart loop. Kept only for
  development.
