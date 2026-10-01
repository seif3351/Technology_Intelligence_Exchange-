# ADR-0005: Organization-based multi-tenancy

## Decision

- The organization is the tenant. Every tenant-owned row carries `organization_id`.
- `authorizeTenant(ctx, orgId, minRole)` is the only way to mint a `TenantScope` (a branded type). Repository methods for tenant-private data (requirements, workspace listings, inserts/updates) require it, so an unchecked client-supplied organization id cannot reach a query (compile-time guarantee) and every SQL statement filters by the scope's organization.
- Cross-tenant lookups by id return 404 (no existence oracle). Platform admins moderate public catalog data but get no implicit access to private buyer requirements.
- Reads/writes of private requirements, engagement disclosures and authorization denials are audited (append-only table with a trigger forbidding updates/deletes).

## Consequences

Isolation bugs require bypassing the type system; tests cover cross-tenant reads, IDOR via foreign ids and admin restrictions. PostgreSQL row-level security is a planned defence-in-depth layer.
