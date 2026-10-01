# Operations runbook (pilot)

Day-2 procedures for the deployment described in [deployment.md](deployment.md). The commands below
assume you are in `infra/deploy` on the VM with `C="docker compose --env-file atx.env"`. Operator
commands run in the `release` container: same image, same configuration, nothing installed on the host.

## Routine checks (daily during the pilot)

| What                    | How                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Services up and healthy | `$C ps` (api shows `healthy`); `curl -fsS https://api.example.com/readyz`; `curl -fsS https://mcp.example.com/healthz`                              |
| Errors                  | `$C logs --since 24h api mcp-server worker \| grep '"level":50'` (JSON logs; tokens, passwords and secrets are redacted)                            |
| Mail delivery           | metric `atx.mail.sent{outcome="failure"}`, or log lines from the mailer; users can always re-request verification and reset links                   |
| Stuck or dead jobs      | `SELECT type, count(*) FROM jobs WHERE status = 'dead' GROUP BY 1;` Dead jobs exhausted their retries; read `last_error`, fix, then requeue (below) |
| Verification queue      | **Admin → Organization verification**: new organizations stay unlisted until approved                                                               |
| Moderation              | **Admin → Content moderation** (content flagged for injection signals) and **Admin → Evidence review**                                              |
| Certificates            | Caddy renews automatically; expiry notices go to `ACME_EMAIL`                                                                                       |

To requeue dead jobs once the cause is fixed:
`UPDATE jobs SET status = 'queued', attempts = 0, run_at = now() WHERE status = 'dead' AND type = '<type>';`

The worker purges expired one-time secrets, unused OAuth clients and finished jobs every hour
(`atx.retention.purged`). Audit events are never purged.

## Supplier and buyer onboarding

1. **Invite**: Admin → Pilot invitations (email-bound, single use, 14 days). Revoke unused
   invitations there.
2. The invitee registers, verifies their email and creates an organization. It appears in the
   **verification queue**.
3. **Verify** the organization only after an out-of-band check, for example a call to a known contact or a
   check that the website domain matches the email domain. Only verified organizations' published content is
   public (ADR-0011).
4. **Suspend** an organization from the same screen. Its content is unlisted immediately and its members
   lose access to the organization.

## Content moderation

- **Archive an offering** (Admin → Content moderation) when it is misleading, infringing or abusive. Archiving
  unlists it and keeps an audit trail. The supplier can still see it.
- **Claim review**: platform verification means the operator reviewed the linked evidence. It never
  means the platform certifies the technology. Never mark AI-drafted claims as verified without reading
  the evidence.
- Supplier text is untrusted. Never paste it into prompts or tools as instructions.
- Takedown requests and competitor-data complaints: archive first, investigate, record the decision in
  the ticket. The audit log (Admin → Audit log) shows who changed what.

## Access and token incidents

| Situation                                       | Action                                                                                                                                                                                                            |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A user lost a device or leaked an agent token   | The user: **Account → Sign out everywhere**, or revoke the single token (`/docs/mcp`) or connected app (Account)                                                                                                  |
| Account possibly compromised (user unreachable) | `$C run --rm release pnpm -s admin:revoke-access user@example.com`: ends all sessions, agent tokens and connected apps at once (audited). Then ask the owner to reset their password from the known email address |
| Malicious member inside an organization         | An organization owner or admin removes them (**Members**); if the organization itself is the problem, suspend it                                                                                                  |
| A platform administrator leaves                 | Revoke their access as above, and demote them: `UPDATE users SET platform_role = 'none' WHERE email = '…';` (record it in the ticket: this SQL is not audited). Keep at least two administrators                  |
| Unknown MCP client registrations                | Unused dynamically registered clients are deleted after 7 days. Clients with active grants are visible to their users under **Account → Connected AI applications**                                               |

## Secret and key rotation

| Secret                | When                         | Procedure and impact                                                                                                                                                                                                                                                                                                                                                  |
| --------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_SIGNING_JWK`    | suspected leak; yearly       | `pnpm auth:generate-key` → replace the value in `atx.env` → `$C up -d`. **Every** access token becomes invalid at once: web users sign in again, agent tokens must be re-issued (Connect an agent page, `/docs/mcp` → Authorization). OAuth hosts recover silently: their refresh tokens are not signed, so they obtain new access tokens. Announce it to pilot users |
| `CONFIRMATION_SECRET` | suspected leak               | Replace and `$C up -d`. Pending action confirmations fail; users prepare the request again                                                                                                                                                                                                                                                                            |
| `ASSET_URL_SECRET`    | suspected leak               | Replace and `$C up -d`. Signed asset links stop working; pages re-sign them on the next view                                                                                                                                                                                                                                                                          |
| Database password     | staff change; suspected leak | Create the new password in the database service → update `DATABASE_URL` → `$C up -d` → revoke the old one                                                                                                                                                                                                                                                             |
| `SMTP_URL`            | provider rotation            | Update and `$C up -d`; send yourself a password reset to check delivery                                                                                                                                                                                                                                                                                               |
| `ANTHROPIC_API_KEY`   | provider rotation            | Update and `$C up -d`                                                                                                                                                                                                                                                                                                                                                 |

After any rotation, run the smoke test from [deployment.md](deployment.md#5-smoke-test). The secrets are
also on the VM disk (`atx.env`): rotate them all if the VM itself may be compromised.

## Backups and restore

- **Database**: the managed service's automated backups with point-in-time recovery (retain ≥ 14 days), plus a
  nightly logical dump to separate, encrypted storage in the same region:
  `pg_dump --format=custom --no-owner "$DATABASE_URL" > atx-$(date +%F).dump`.
- **Assets**: with `STORAGE_DRIVER=filesystem`, archive the `atx_storage` volume nightly:
  `docker run --rm -v atx_storage:/data:ro -v "$PWD":/backup alpine tar czf /backup/storage-$(date +%F).tgz -C /data .`.
  With S3, enable bucket versioning.
- **Configuration**: keep `atx.env` in the secret store, not only on the VM.
- **Restore drill** (before the pilot starts, then quarterly):
  1. Restore the dump into a scratch database:
     `pg_restore --no-owner --dbname "$SCRATCH_URL" atx-YYYY-MM-DD.dump`.
  2. Point a rehearsal stack at it ([local rehearsal](deployment.md#local-rehearsal)).
  3. Run the smoke test.
  4. Record the time taken; this is your RTO.

## Releases and rollback

See [deployment.md §6](deployment.md#6-subsequent-releases). Before migrating, take an on-demand database
snapshot. Rolling back an image is safe. Rolling back the schema is a point-in-time restore, which loses
data written since the release, so decide on that explicitly.

## Personal data requests

Accounts hold email, display name, terms acceptance, memberships and audit entries. For an access or
erasure request, export or delete the user's rows with the database owner present. Audit events are
append-only: anonymise the actor instead of deleting it, as agreed with counsel. Record each request and
how it was handled.

## Pilot exit

1. Export the published catalog for participants if the agreement requires it.
2. Revoke all access (`admin:revoke-access` for each user), stop the stack, and take a final backup.
3. Delete the data according to the retention period agreed in the pilot terms.
