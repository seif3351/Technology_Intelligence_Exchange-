import type { InvitationRepository } from '@atx/application';
import { type Invitation, asId } from '@atx/domain';
import type { Queryable } from '../db';

type Row = Record<string, unknown>;

const toInvitation = (row: Row): Invitation => ({
  id: asId(row['id'] as string),
  email: row['email'] as string,
  organizationId: row['organization_id'] ? asId(row['organization_id'] as string) : null,
  role: (row['role'] as Invitation['role']) ?? null,
  tokenHash: row['token_hash'] as string,
  invitedBy: asId(row['invited_by'] as string),
  expiresAt: row['expires_at'] as Date,
  acceptedAt: (row['accepted_at'] as Date | null) ?? null,
  acceptedBy: row['accepted_by'] ? asId(row['accepted_by'] as string) : null,
  revokedAt: (row['revoked_at'] as Date | null) ?? null,
  createdAt: row['created_at'] as Date,
});

/** SQL predicate for a still-usable invitation; `nowParam` is the placeholder holding the current time. */
const pending = (nowParam: string) =>
  `accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ${nowParam}`;

export const createInvitationRepository = (db: Queryable): InvitationRepository => ({
  async insert(invitation) {
    await db.query(
      `INSERT INTO invitations (id, email, organization_id, role, token_hash, invited_by, expires_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        invitation.id,
        invitation.email,
        invitation.organizationId,
        invitation.role,
        invitation.tokenHash,
        invitation.invitedBy,
        invitation.expiresAt,
        invitation.createdAt,
      ],
    );
  },
  async findById(id) {
    const { rows } = await db.query('SELECT * FROM invitations WHERE id = $1', [id]);
    return rows[0] ? toInvitation(rows[0]) : null;
  },
  async findByTokenHash(tokenHash) {
    const { rows } = await db.query('SELECT * FROM invitations WHERE token_hash = $1', [tokenHash]);
    return rows[0] ? toInvitation(rows[0]) : null;
  },
  async markAccepted(id, userId, now) {
    const result = await db.query(
      `UPDATE invitations SET accepted_at = $3, accepted_by = $2 WHERE id = $1 AND ${pending('$3')}`,
      [id, userId, now],
    );
    return result.rowCount === 1;
  },
  async revoke(id, now) {
    const result = await db.query(
      `UPDATE invitations SET revoked_at = $2 WHERE id = $1 AND ${pending('$2')}`,
      [id, now],
    );
    return result.rowCount === 1;
  },
  async listPlatform(limit) {
    const { rows } = await db.query(
      'SELECT * FROM invitations WHERE organization_id IS NULL ORDER BY created_at DESC, id LIMIT $1',
      [limit],
    );
    return rows.map(toInvitation);
  },
  async listForOrganization(scope) {
    const { rows } = await db.query(
      'SELECT * FROM invitations WHERE organization_id = $1 ORDER BY created_at DESC, id LIMIT 200',
      [scope.organizationId],
    );
    return rows.map(toInvitation);
  },
});
