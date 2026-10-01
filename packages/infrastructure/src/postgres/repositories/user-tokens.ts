import type { UserTokenRepository } from '@atx/application';
import { type UserToken, asId } from '@atx/domain';
import type { Queryable } from '../db';

type Row = Record<string, unknown>;

const toUserToken = (row: Row): UserToken => ({
  id: asId(row['id'] as string),
  userId: asId(row['user_id'] as string),
  purpose: row['purpose'] as UserToken['purpose'],
  tokenHash: row['token_hash'] as string,
  expiresAt: row['expires_at'] as Date,
  usedAt: (row['used_at'] as Date | null) ?? null,
  createdAt: row['created_at'] as Date,
});

export const createUserTokenRepository = (db: Queryable): UserTokenRepository => ({
  async insert(token) {
    await db.query(
      `INSERT INTO user_tokens (id, user_id, purpose, token_hash, expires_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [token.id, token.userId, token.purpose, token.tokenHash, token.expiresAt, token.createdAt],
    );
  },
  async findByTokenHash(tokenHash) {
    const { rows } = await db.query('SELECT * FROM user_tokens WHERE token_hash = $1', [tokenHash]);
    return rows[0] ? toUserToken(rows[0]) : null;
  },
  async markUsed(id, at) {
    const result = await db.query('UPDATE user_tokens SET used_at = $2 WHERE id = $1 AND used_at IS NULL', [
      id,
      at,
    ]);
    return result.rowCount === 1;
  },
  async countCreatedSince(userId, purpose, since) {
    const { rows } = await db.query(
      'SELECT count(*)::int AS n FROM user_tokens WHERE user_id = $1 AND purpose = $2 AND created_at >= $3',
      [userId, purpose, since],
    );
    return Number(rows[0]?.['n'] ?? 0);
  },
  async invalidateAll(userId, purpose, at) {
    await db.query(
      'UPDATE user_tokens SET used_at = $3 WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL',
      [userId, purpose, at],
    );
  },
});
