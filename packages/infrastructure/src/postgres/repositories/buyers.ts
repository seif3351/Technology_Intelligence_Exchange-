import type { AuditLog, EngagementRepository, RequirementRepository, TenantScope } from '@atx/application';
import { type ConceptId, asId, conflict, invariant } from '@atx/domain';
import type { Queryable } from '../db';
import { toAuditEvent, toEngagement, toRequirement } from '../mappers';

const assertScope = (scope: TenantScope, organizationId: string): void => {
  if (scope.organizationId !== organizationId)
    throw invariant('Tenant scope does not match the entity organization');
};

/** Every query is constrained by the scope's organization id — there is no unscoped read path. */
const toWatch = (row: Record<string, unknown>) => ({
  requirementId: asId<'RequirementId'>(row['requirement_id'] as string),
  organizationId: asId<'OrganizationId'>(row['organization_id'] as string),
  userId: asId<'UserId'>(row['user_id'] as string),
});

export const createRequirementRepository = (db: Queryable): RequirementRepository => ({
  async setWatch(scope, requirementId, userId, at) {
    if (userId === null) {
      await db.query('DELETE FROM requirement_watches WHERE requirement_id = $1 AND organization_id = $2', [
        requirementId,
        scope.organizationId,
      ]);
      return;
    }
    await db.query(
      `INSERT INTO requirement_watches (requirement_id, organization_id, user_id, created_at)
       SELECT r.id, r.organization_id, $3, $4 FROM requirements r WHERE r.id = $1 AND r.organization_id = $2
       ON CONFLICT (requirement_id) DO UPDATE SET user_id = EXCLUDED.user_id, created_at = EXCLUDED.created_at`,
      [requirementId, scope.organizationId, userId, at],
    );
  },
  async findWatch(scope, requirementId) {
    const { rows } = await db.query(
      'SELECT * FROM requirement_watches WHERE requirement_id = $1 AND organization_id = $2',
      [requirementId, scope.organizationId],
    );
    return rows[0] ? toWatch(rows[0]) : null;
  },
  async listAllWatchesForAlerting() {
    const { rows } = await db.query('SELECT * FROM requirement_watches ORDER BY created_at, requirement_id');
    return rows.map(toWatch);
  },
  async recordAlert(requirementId, offeringId, at) {
    const result = await db.query(
      `INSERT INTO requirement_alerts (requirement_id, offering_id, notified_at) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [requirementId, offeringId, at],
    );
    return result.rowCount === 1;
  },
  async findById(scope, id) {
    const { rows } = await db.query('SELECT * FROM requirements WHERE id = $1 AND organization_id = $2', [
      id,
      scope.organizationId,
    ]);
    return rows[0] ? toRequirement(rows[0]) : null;
  },
  async listForTenant(scope) {
    const { rows } = await db.query(
      'SELECT * FROM requirements WHERE organization_id = $1 ORDER BY updated_at DESC, id',
      [scope.organizationId],
    );
    return rows.map(toRequirement);
  },
  async insert(scope, r) {
    assertScope(scope, r.organizationId);
    await db.query(
      `INSERT INTO requirements (id, organization_id, title, description, constraints, confidential_terms, visibility, status,
         created_by, version, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        r.id,
        r.organizationId,
        r.title,
        r.description,
        JSON.stringify(r.constraints),
        r.confidentialTerms,
        r.visibility,
        r.status,
        r.createdBy,
        r.version,
        r.createdAt,
        r.updatedAt,
      ],
    );
  },
  async update(scope, r, expectedVersion) {
    assertScope(scope, r.organizationId);
    const result = await db.query(
      `UPDATE requirements SET title=$4, description=$5, constraints=$6, confidential_terms=$7, visibility=$8, status=$9,
         version=$10, updated_at=$11 WHERE id=$1 AND organization_id=$2 AND version=$3`,
      [
        r.id,
        r.organizationId,
        expectedVersion,
        r.title,
        r.description,
        JSON.stringify(r.constraints),
        r.confidentialTerms,
        r.visibility,
        r.status,
        r.version,
        r.updatedAt,
      ],
    );
    if (result.rowCount !== 1) throw conflict('Requirement was modified concurrently; reload and retry');
  },
  async recordDemandSignal(scope, requirementId, conceptIds, minimumMaturity) {
    await db.query(
      `INSERT INTO demand_signals (requirement_id, concept_ids, minimum_maturity, created_at)
       SELECT id, $3, $4, now() FROM requirements WHERE id = $1 AND organization_id = $2
       ON CONFLICT (requirement_id) DO UPDATE SET concept_ids = EXCLUDED.concept_ids, minimum_maturity = EXCLUDED.minimum_maturity`,
      [requirementId, scope.organizationId, conceptIds, minimumMaturity],
    );
  },
  async listDemandSignals(limit) {
    const { rows } = await db.query(
      `SELECT concept_id, count(*) AS n FROM demand_signals, unnest(concept_ids) AS concept_id
        GROUP BY concept_id ORDER BY n DESC, concept_id LIMIT $1`,
      [limit],
    );
    return rows.map((row) => ({
      conceptId: row['concept_id'] as ConceptId,
      requirementCount: Number(row['n']),
    }));
  },
});

export const createEngagementRepository = (db: Queryable): EngagementRepository => ({
  async findById(id) {
    const { rows } = await db.query('SELECT * FROM engagement_requests WHERE id = $1', [id]);
    return rows[0] ? toEngagement(rows[0]) : null;
  },
  async findByIdempotencyKey(scope, key) {
    const { rows } = await db.query(
      'SELECT * FROM engagement_requests WHERE buyer_organization_id = $1 AND idempotency_key = $2',
      [scope.organizationId, key],
    );
    return rows[0] ? toEngagement(rows[0]) : null;
  },
  async listForBuyer(scope) {
    const { rows } = await db.query(
      'SELECT * FROM engagement_requests WHERE buyer_organization_id = $1 ORDER BY created_at DESC, id',
      [scope.organizationId],
    );
    return rows.map(toEngagement);
  },
  async listForSupplier(scope) {
    const { rows } = await db.query(
      'SELECT * FROM engagement_requests WHERE supplier_organization_id = $1 ORDER BY created_at DESC, id',
      [scope.organizationId],
    );
    return rows.map(toEngagement);
  },
  async insert(scope, e) {
    assertScope(scope, e.buyerOrganizationId);
    const result = await db.query(
      `INSERT INTO engagement_requests (id, type, buyer_organization_id, supplier_organization_id, offering_id, requirement_id,
         disclosure, status, idempotency_key, requested_by, confirmed_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (buyer_organization_id, idempotency_key) DO NOTHING`,
      [
        e.id,
        e.type,
        e.buyerOrganizationId,
        e.supplierOrganizationId,
        e.offeringId,
        e.requirementId,
        JSON.stringify(e.disclosure),
        e.status,
        e.idempotencyKey,
        e.requestedBy,
        e.confirmedAt,
        e.createdAt,
        e.updatedAt,
      ],
    );
    if (result.rowCount !== 1) throw conflict('A request with this idempotency key already exists');
  },
  async updateStatus(e, from) {
    const result = await db.query(
      `UPDATE engagement_requests
          SET status = $2, updated_at = $3, supplier_response = $4, responded_by = $5, responded_at = $6
        WHERE id = $1 AND status = $7`,
      [
        e.id,
        e.status,
        e.updatedAt,
        e.supplierResponse ? JSON.stringify(e.supplierResponse) : null,
        e.respondedBy,
        e.respondedAt,
        from,
      ],
    );
    if (result.rowCount !== 1) throw conflict('The request was updated by someone else; reload and retry');
  },
});

export const createAuditLog = (db: Queryable): AuditLog => ({
  async record(event) {
    await db.query(
      `INSERT INTO audit_events (id, occurred_at, actor, organization_id, action, resource_type, resource_id, outcome, request_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        event.id,
        event.occurredAt,
        JSON.stringify(event.actor),
        event.organizationId,
        event.action,
        event.resourceType,
        event.resourceId,
        event.outcome,
        event.requestId,
        JSON.stringify(event.metadata),
      ],
    );
  },
  async list({ organizationId, action, limit, before }) {
    const { rows } = await db.query(
      `SELECT * FROM audit_events
        WHERE ($1::uuid IS NULL OR organization_id = $1) AND ($2::text IS NULL OR action = $2)
          AND ($3::timestamptz IS NULL OR occurred_at < $3)
        ORDER BY occurred_at DESC, id LIMIT $4`,
      [organizationId, action, before, limit],
    );
    return rows.map(toAuditEvent);
  },
});
