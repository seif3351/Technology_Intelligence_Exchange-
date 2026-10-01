import type { OrganizationRepository, PrincipalMembership, UserRepository } from '@atx/application';
import { type Membership, type Organization, type User, asId, conflict } from '@atx/domain';
import type { Queryable } from '../db';
import { toOrganization, toUser } from '../mappers';

export const createOrganizationRepository = (db: Queryable): OrganizationRepository => ({
  async findById(id) {
    const { rows } = await db.query('SELECT * FROM organizations WHERE id = $1', [id]);
    return rows[0] ? toOrganization(rows[0]) : null;
  },
  async findBySlug(slug) {
    const { rows } = await db.query('SELECT * FROM organizations WHERE slug = $1', [slug]);
    return rows[0] ? toOrganization(rows[0]) : null;
  },
  async findManyByIds(ids) {
    if (ids.length === 0) return [];
    const { rows } = await db.query('SELECT * FROM organizations WHERE id = ANY($1::uuid[])', [ids]);
    return rows.map(toOrganization);
  },
  async searchSuppliers({ text, conceptIds, limit, offset }) {
    const { rows } = await db.query(
      `WITH q AS (SELECT CASE WHEN $1::text IS NULL THEN NULL ELSE websearch_to_tsquery('english', $1) END AS query)
       SELECT o.*, count(*) OVER () AS total_count,
              CASE WHEN q.query IS NULL THEN 0 ELSE ts_rank_cd(o.search_tsv, q.query) END AS rank
         FROM organizations o, q
        WHERE o.kind IN ('supplier','hybrid')
          AND o.verification_state <> 'suspended'
          AND (q.query IS NULL OR o.search_tsv @@ q.query)
          AND (cardinality($2::text[]) = 0 OR EXISTS (
                SELECT 1 FROM technical_claims c
                 WHERE c.organization_id = o.id AND c.status = 'published' AND c.concept_id = ANY($2::text[])))
          AND EXISTS (SELECT 1 FROM offerings f WHERE f.organization_id = o.id AND f.status = 'published')
        ORDER BY rank DESC, o.name ASC, o.id ASC
        LIMIT $3 OFFSET $4`,
      [text, conceptIds, limit, offset],
    );
    return { items: rows.map(toOrganization), total: rows[0] ? Number(rows[0]['total_count']) : 0 };
  },
  async listByVerificationState(state, limit) {
    const { rows } = await db.query(
      'SELECT * FROM organizations WHERE verification_state = $1 ORDER BY updated_at ASC LIMIT $2',
      [state, limit],
    );
    return rows.map(toOrganization);
  },
  async insert(org: Organization) {
    await db.query(
      `INSERT INTO organizations (id, slug, name, kind, summary, description, website, headquarters_country, regions,
         employee_range, contact, verification_state, verified_by, verified_at, is_demo, version, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        org.id,
        org.slug,
        org.name,
        org.kind,
        org.summary,
        org.description,
        org.website,
        org.headquartersCountry,
        org.regions,
        org.employeeRange,
        JSON.stringify(org.contact),
        org.verificationState,
        org.verifiedBy,
        org.verifiedAt,
        org.isDemo,
        org.version,
        org.createdAt,
        org.updatedAt,
      ],
    );
  },
  async update(org, expectedVersion) {
    const result = await db.query(
      `UPDATE organizations SET summary=$3, description=$4, website=$5, headquarters_country=$6, regions=$7,
         employee_range=$8, contact=$9, verification_state=$10, verified_by=$11, verified_at=$12, version=$13, updated_at=$14
       WHERE id=$1 AND version=$2`,
      [
        org.id,
        expectedVersion,
        org.summary,
        org.description,
        org.website,
        org.headquartersCountry,
        org.regions,
        org.employeeRange,
        JSON.stringify(org.contact),
        org.verificationState,
        org.verifiedBy,
        org.verifiedAt,
        org.version,
        org.updatedAt,
      ],
    );
    if (result.rowCount !== 1) throw conflict('Organization was modified concurrently; reload and retry');
  },
});

export const createUserRepository = (db: Queryable): UserRepository => ({
  async findById(id) {
    const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] ? toUser(rows[0]) : null;
  },
  async findCredentialByEmail(email) {
    const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    return rows[0] ? { user: toUser(rows[0]), passwordHash: rows[0]['password_hash'] as string } : null;
  },
  async insert(user: User, passwordHash: string) {
    await db.query(
      'INSERT INTO users (id, email, display_name, platform_role, password_hash, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [user.id, user.email, user.displayName, user.platformRole, passwordHash, user.createdAt],
    );
  },
  async setPlatformRole(userId, role) {
    await db.query('UPDATE users SET platform_role = $2 WHERE id = $1', [userId, role]);
  },
  async listMemberships(userId): Promise<PrincipalMembership[]> {
    const { rows } = await db.query(
      `SELECT m.organization_id, m.role, o.kind FROM memberships m JOIN organizations o ON o.id = m.organization_id
        WHERE m.user_id = $1 AND o.verification_state <> 'suspended' ORDER BY o.name`,
      [userId],
    );
    return rows.map((row) => ({
      organizationId: asId(row['organization_id'] as string),
      organizationKind: row['kind'] as PrincipalMembership['organizationKind'],
      role: row['role'] as PrincipalMembership['role'],
    }));
  },
  async addMembership(membership: Membership) {
    await db.query(
      `INSERT INTO memberships (organization_id, user_id, role, created_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [membership.organizationId, membership.userId, membership.role, membership.createdAt],
    );
  },
});
