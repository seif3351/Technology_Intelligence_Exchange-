import type { AccessGrantRepository } from '@atx/application';
import { type AccessGrant, asId } from '@atx/domain';
import type { Queryable } from '../db';

type Row = Record<string, unknown>;

const toGrant = (row: Row): AccessGrant => ({
  id: asId(row['id'] as string),
  userId: asId(row['user_id'] as string),
  kind: row['kind'] as AccessGrant['kind'],
  label: row['label'] as string,
  clientId: (row['client_id'] as string | null) ?? null,
  scopes: row['scopes'] as string[],
  createdAt: row['created_at'] as Date,
  expiresAt: row['expires_at'] as Date,
  lastUsedAt: (row['last_used_at'] as Date | null) ?? null,
  revokedAt: (row['revoked_at'] as Date | null) ?? null,
});

export const createAccessGrantRepository = (db: Queryable): AccessGrantRepository => ({
  async insert(grant) {
    await db.query(
      `INSERT INTO access_grants (id, user_id, kind, label, client_id, scopes, created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        grant.id,
        grant.userId,
        grant.kind,
        grant.label,
        grant.clientId,
        grant.scopes,
        grant.createdAt,
        grant.expiresAt,
      ],
    );
  },
  async findById(id) {
    const { rows } = await db.query('SELECT * FROM access_grants WHERE id = $1', [id]);
    return rows[0] ? toGrant(rows[0]) : null;
  },
  async listForUser(userId, kind) {
    const { rows } = await db.query(
      'SELECT * FROM access_grants WHERE user_id = $1 AND kind = $2 ORDER BY created_at DESC, id LIMIT 200',
      [userId, kind],
    );
    return rows.map(toGrant);
  },
  async revoke(id, userId, at) {
    const result = await db.query(
      'UPDATE access_grants SET revoked_at = $3 WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
      [id, userId, at],
    );
    return result.rowCount === 1;
  },
  async revokeById(id, at) {
    await db.query('UPDATE access_grants SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL', [id, at]);
  },
  async touch(id, at) {
    await db.query(
      `UPDATE access_grants SET last_used_at = $2
        WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < $2::timestamptz - interval '5 minutes')`,
      [id, at],
    );
  },
});
