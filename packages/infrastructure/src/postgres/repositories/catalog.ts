import type {
  AssetRepository,
  CapabilityRepository,
  ClaimRepository,
  EvidenceRepository,
  OfferingRepository,
  TenantScope,
} from '@atx/application';
import { type ConceptId, type OfferingId, type TechnicalClaim, asId, conflict, invariant } from '@atx/domain';
import type { Queryable } from '../db';
import { claimParams, toAsset, toCapability, toClaim, toEvidence, toOffering } from '../mappers';
import { listedOrganization } from '../listing';

const assertScope = (scope: TenantScope, organizationId: string): void => {
  if (scope.organizationId !== organizationId)
    throw invariant('Tenant scope does not match the entity organization');
};

export const createOfferingRepository = (db: Queryable): OfferingRepository => ({
  async findById(id) {
    const { rows } = await db.query('SELECT * FROM offerings WHERE id = $1', [id]);
    return rows[0] ? toOffering(rows[0]) : null;
  },
  async findPublishedByIds(ids) {
    if (ids.length === 0) return [];
    const { rows } = await db.query(
      `SELECT * FROM offerings WHERE id = ANY($1::uuid[]) AND status = 'published' AND ${listedOrganization('organization_id')}`,
      [ids],
    );
    return rows.map(toOffering);
  },
  async listPublishedByOrganization(organizationId) {
    const { rows } = await db.query(
      `SELECT * FROM offerings WHERE organization_id = $1 AND status = 'published' AND ${listedOrganization('organization_id')}
        ORDER BY name, id`,
      [organizationId],
    );
    return rows.map(toOffering);
  },
  async listForTenant(scope, statuses) {
    const { rows } = await db.query(
      `SELECT * FROM offerings WHERE organization_id = $1 AND ($2::text[] IS NULL OR status = ANY($2::text[]))
        ORDER BY updated_at DESC, id`,
      [scope.organizationId, statuses ?? null],
    );
    return rows.map(toOffering);
  },
  async listAllPublishedIds() {
    const { rows } = await db.query("SELECT id FROM offerings WHERE status = 'published' ORDER BY id");
    return rows.map((row) => asId<'OfferingId'>(row['id'] as string));
  },
  async insert(scope, o) {
    assertScope(scope, o.organizationId);
    await db.query(
      `INSERT INTO offerings (id, organization_id, slug, type, name, summary, description, maturity, details, commercial,
         regions, status, is_demo, published_at, published_by, version, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        o.id,
        o.organizationId,
        o.slug,
        o.type,
        o.name,
        o.summary,
        o.description,
        o.maturity,
        JSON.stringify(o.details),
        JSON.stringify(o.commercial),
        o.regions,
        o.status,
        o.isDemo,
        o.publishedAt,
        o.publishedBy,
        o.version,
        o.createdAt,
        o.updatedAt,
      ],
    );
  },
  async update(scope, o, expectedVersion) {
    assertScope(scope, o.organizationId);
    const result = await db.query(
      `UPDATE offerings SET name=$4, summary=$5, description=$6, maturity=$7, details=$8, commercial=$9, regions=$10,
         status=$11, published_at=$12, published_by=$13, version=$14, updated_at=$15
       WHERE id=$1 AND organization_id=$2 AND version=$3`,
      [
        o.id,
        o.organizationId,
        expectedVersion,
        o.name,
        o.summary,
        o.description,
        o.maturity,
        JSON.stringify(o.details),
        JSON.stringify(o.commercial),
        o.regions,
        o.status,
        o.publishedAt,
        o.publishedBy,
        o.version,
        o.updatedAt,
      ],
    );
    if (result.rowCount !== 1) throw conflict('Offering was modified concurrently; reload and retry');
  },
});

const CLAIM_COLUMNS = `id, organization_id, subject_type, subject_id, predicate, concept_id, qualifiers, statement,
  provenance_category, source_type, source_reference, source_url, source_version, license, evidence_ids,
  provided_by_org, provided_by_user, provided_via, verification_status, verified_by, verified_at, verification_notes,
  confidence, status, review_at, expires_at, notes, version, created_at, updated_at`;

const recordRevision = (db: Queryable, claim: TechnicalClaim) =>
  db.query(
    'INSERT INTO claim_revisions (claim_id, version, snapshot, changed_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
    [claim.id, claim.version, JSON.stringify(claim), claim.updatedAt],
  );

export const createClaimRepository = (db: Queryable): ClaimRepository => ({
  async findById(id) {
    const { rows } = await db.query('SELECT * FROM technical_claims WHERE id = $1', [id]);
    return rows[0] ? toClaim(rows[0]) : null;
  },
  async listPublishedForOfferings(offeringIds) {
    if (offeringIds.length === 0) return [];
    const { rows } = await db.query(
      `SELECT c.* FROM technical_claims c
        WHERE c.status = 'published'
          AND ((c.subject_type = 'offering' AND c.subject_id = ANY($1::uuid[]))
            OR (c.subject_type IN ('organization','capability')
                AND c.organization_id IN (SELECT organization_id FROM offerings WHERE id = ANY($1::uuid[]))))
        ORDER BY c.concept_id, c.id`,
      [offeringIds],
    );
    return rows.map(toClaim);
  },
  async listPublishedForOrganization(organizationId) {
    const { rows } = await db.query(
      "SELECT * FROM technical_claims WHERE organization_id = $1 AND status = 'published' ORDER BY concept_id, id",
      [organizationId],
    );
    return rows.map(toClaim);
  },
  async listForTenant(scope, filter) {
    const { rows } = await db.query(
      `SELECT * FROM technical_claims
        WHERE organization_id = $1
          AND ($2::text IS NULL OR status = $2)
          AND ($3::uuid IS NULL OR (subject_type = 'offering' AND subject_id = $3))
        ORDER BY updated_at DESC, id`,
      [scope.organizationId, filter.status ?? null, filter.offeringId ?? null],
    );
    return rows.map(toClaim);
  },
  async listAwaitingPlatformReview(limit) {
    const { rows } = await db.query(
      `SELECT * FROM technical_claims WHERE status = 'published' AND verification_status = 'unreviewed'
        ORDER BY cardinality(evidence_ids) DESC, updated_at ASC LIMIT $1`,
      [limit],
    );
    return rows.map(toClaim);
  },
  async countPublishedOfferingsByConcept(conceptIds) {
    if (conceptIds.length === 0) return new Map();
    const { rows } = await db.query(
      `SELECT c.concept_id, count(DISTINCT o.id) AS n
         FROM technical_claims c
         JOIN offerings o ON o.status = 'published'
          AND ((c.subject_type = 'offering' AND c.subject_id = o.id) OR (c.subject_type <> 'offering' AND c.organization_id = o.organization_id))
        WHERE c.status = 'published' AND c.concept_id = ANY($1::text[]) AND ${listedOrganization('o.organization_id')}
        GROUP BY c.concept_id`,
      [conceptIds],
    );
    return new Map(rows.map((row) => [row['concept_id'] as ConceptId, Number(row['n'])]));
  },
  async insert(scope, claim) {
    assertScope(scope, claim.organizationId);
    await db.query(
      `INSERT INTO technical_claims (${CLAIM_COLUMNS}) VALUES (${claimParams(claim)
        .map((_, i) => `$${i + 1}`)
        .join(',')})`,
      claimParams(claim),
    );
    await recordRevision(db, claim);
  },
  async update(scope, claim, expectedVersion) {
    assertScope(scope, claim.organizationId);
    const params = claimParams(claim);
    const assignments = CLAIM_COLUMNS.split(',')
      .map((column) => column.trim())
      .map((column, index) => ({ column, index }))
      // id and organization_id are only used in the WHERE clause; created_at is immutable
      // but must still be referenced so PostgreSQL can infer every parameter's type.
      .filter(({ column }) => !['id', 'organization_id'].includes(column))
      .map(({ column, index }) => `${column} = $${index + 1}`)
      .join(', ');
    params.push(expectedVersion);
    const result = await db.query(
      `UPDATE technical_claims SET ${assignments} WHERE id = $1 AND organization_id = $2 AND version = $${params.length}`,
      params,
    );
    if (result.rowCount !== 1) throw conflict('Claim was modified concurrently; reload and retry');
    await recordRevision(db, claim);
  },
});

export const createCapabilityRepository = (db: Queryable): CapabilityRepository => ({
  async listPublishedByOrganization(organizationId) {
    const { rows } = await db.query(
      "SELECT * FROM capabilities WHERE organization_id = $1 AND status = 'published' ORDER BY name, id",
      [organizationId],
    );
    return rows.map(toCapability);
  },
  async listForTenant(scope) {
    const { rows } = await db.query(
      'SELECT * FROM capabilities WHERE organization_id = $1 ORDER BY name, id',
      [scope.organizationId],
    );
    return rows.map(toCapability);
  },
  async insert(scope, c) {
    assertScope(scope, c.organizationId);
    await db.query(
      `INSERT INTO capabilities (id, organization_id, concept_id, name, description, status, version, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        c.id,
        c.organizationId,
        c.conceptId,
        c.name,
        c.description,
        c.status,
        c.version,
        c.createdAt,
        c.updatedAt,
      ],
    );
  },
});

export const createEvidenceRepository = (db: Queryable): EvidenceRepository => ({
  async findById(id) {
    const { rows } = await db.query('SELECT * FROM evidence WHERE id = $1', [id]);
    return rows[0] ? toEvidence(rows[0]) : null;
  },
  async findManyByIds(ids) {
    if (ids.length === 0) return [];
    const { rows } = await db.query('SELECT * FROM evidence WHERE id = ANY($1::uuid[]) ORDER BY id', [ids]);
    return rows.map(toEvidence);
  },
  async listPublicForOfferings(offeringIds) {
    if (offeringIds.length === 0) return [];
    const { rows } = await db.query(
      `SELECT e.* FROM evidence e
         LEFT JOIN assets a ON a.id = e.asset_id
        WHERE e.offering_id = ANY($1::uuid[]) AND e.visibility = 'public'
          AND (a.id IS NULL OR a.processing_state = 'ready')
        ORDER BY e.kind, e.title, e.id`,
      [offeringIds],
    );
    return rows.map(toEvidence);
  },
  async listPublicForOrganization(organizationId) {
    const { rows } = await db.query(
      `SELECT e.* FROM evidence e LEFT JOIN assets a ON a.id = e.asset_id
        WHERE e.organization_id = $1 AND e.offering_id IS NULL AND e.visibility = 'public'
          AND (a.id IS NULL OR a.processing_state = 'ready')
        ORDER BY e.kind, e.title, e.id`,
      [organizationId],
    );
    return rows.map(toEvidence);
  },
  async listForTenant(scope) {
    const { rows } = await db.query(
      'SELECT * FROM evidence WHERE organization_id = $1 ORDER BY created_at DESC, id',
      [scope.organizationId],
    );
    return rows.map(toEvidence);
  },
  async offeringsWithProductionReferences(offeringIds) {
    if (offeringIds.length === 0) return new Set();
    const { rows } = await db.query(
      `SELECT DISTINCT o.id FROM offerings o JOIN evidence e
          ON e.kind = 'production_reference' AND e.visibility = 'public'
         AND (e.offering_id = o.id OR (e.offering_id IS NULL AND e.organization_id = o.organization_id))
        WHERE o.id = ANY($1::uuid[])`,
      [offeringIds],
    );
    return new Set(rows.map((row) => asId<'OfferingId'>(row['id'] as string))) as Set<OfferingId>;
  },
  async findByAsset(assetId) {
    const { rows } = await db.query(
      'SELECT * FROM evidence WHERE asset_id = $1 ORDER BY created_at LIMIT 1',
      [assetId],
    );
    return rows[0] ? toEvidence(rows[0]) : null;
  },
  async insert(scope, e) {
    assertScope(scope, e.organizationId);
    await db.query(
      `INSERT INTO evidence (id, organization_id, offering_id, kind, title, description, asset_id, url, provenance_category,
         source_type, source_reference, source_url, source_version, license, visibility, customer_disclosure, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        e.id,
        e.organizationId,
        e.offeringId,
        e.kind,
        e.title,
        e.description,
        e.assetId,
        e.url,
        e.provenance.category,
        e.provenance.sourceType,
        e.provenance.sourceReference,
        e.provenance.sourceUrl,
        e.provenance.sourceVersion,
        e.provenance.license,
        e.visibility,
        e.customerDisclosure,
        e.createdBy,
        e.createdAt,
        e.updatedAt,
      ],
    );
  },
});

const ASSET_COLUMNS = `id, organization_id, offering_id, kind, title, description, content_type, byte_size, storage_key,
  external_url, sha256, duration_seconds, thumbnail_url, visibility, processing_state, extraction_state, failure_reason,
  created_by, is_demo, created_at, updated_at`;

export const createAssetRepository = (db: Queryable): AssetRepository => {
  const params = (a: Parameters<AssetRepository['save']>[0]) => [
    a.id,
    a.organizationId,
    a.offeringId,
    a.kind,
    a.title,
    a.description,
    a.contentType,
    a.byteSize,
    a.storageKey,
    a.externalUrl,
    a.sha256,
    a.durationSeconds,
    a.thumbnailUrl,
    a.visibility,
    a.processingState,
    a.extractionState,
    a.failureReason,
    a.createdBy,
    a.isDemo,
    a.createdAt,
    a.updatedAt,
  ];
  return {
    async findById(id) {
      const { rows } = await db.query('SELECT * FROM assets WHERE id = $1', [id]);
      return rows[0] ? toAsset(rows[0]) : null;
    },
    async listPublicVideos({ offeringIds, text, limit }) {
      const { rows } = await db.query(
        `SELECT a.* FROM assets a JOIN offerings o ON o.id = a.offering_id AND o.status = 'published'
          WHERE ${listedOrganization('o.organization_id')} AND a.kind = 'video' AND a.visibility = 'public' AND a.processing_state = 'ready'
            AND ($1::uuid[] IS NULL OR a.offering_id = ANY($1::uuid[]))
            AND ($2::text IS NULL OR to_tsvector('english', a.title || ' ' || a.description) @@ websearch_to_tsquery('english', $2))
          ORDER BY a.title, a.id LIMIT $3`,
        [offeringIds, text, limit],
      );
      return rows.map(toAsset);
    },
    async listPublicForOfferings(offeringIds) {
      if (offeringIds.length === 0) return [];
      const { rows } = await db.query(
        `SELECT * FROM assets WHERE offering_id = ANY($1::uuid[]) AND visibility = 'public' AND processing_state = 'ready'
          ORDER BY kind, title, id`,
        [offeringIds],
      );
      return rows.map(toAsset);
    },
    async listForTenant(scope) {
      const { rows } = await db.query(
        'SELECT * FROM assets WHERE organization_id = $1 ORDER BY created_at DESC, id',
        [scope.organizationId],
      );
      return rows.map(toAsset);
    },
    async insert(scope, asset) {
      assertScope(scope, asset.organizationId);
      const values = params(asset);
      await db.query(
        `INSERT INTO assets (${ASSET_COLUMNS}) VALUES (${values.map((_, i) => `$${i + 1}`).join(',')})`,
        values,
      );
    },
    async save(asset) {
      await db.query(
        `UPDATE assets SET processing_state=$2, extraction_state=$3, failure_reason=$4, sha256=$5, updated_at=$6 WHERE id=$1`,
        [
          asset.id,
          asset.processingState,
          asset.extractionState,
          asset.failureReason,
          asset.sha256,
          asset.updatedAt,
        ],
      );
    },
  };
};
