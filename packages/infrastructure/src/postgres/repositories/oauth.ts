import type { OAuthRepository } from '@atx/application';
import { type OAuthAuthorizationCode, type OAuthClient, type OAuthRefreshToken, asId } from '@atx/domain';
import type { Queryable } from '../db';

type Row = Record<string, unknown>;

const toClient = (row: Row): OAuthClient => ({
  clientId: row['client_id'] as string,
  clientName: row['client_name'] as string,
  redirectUris: row['redirect_uris'] as string[],
  clientUri: (row['client_uri'] as string | null) ?? null,
  createdAt: row['created_at'] as Date,
});

const toCode = (row: Row): OAuthAuthorizationCode => ({
  codeHash: row['code_hash'] as string,
  clientId: row['client_id'] as string,
  userId: asId(row['user_id'] as string),
  grantId: asId(row['grant_id'] as string),
  redirectUri: row['redirect_uri'] as string,
  codeChallenge: row['code_challenge'] as string,
  scopes: row['scopes'] as string[],
  resource: row['resource'] as string,
  expiresAt: row['expires_at'] as Date,
  usedAt: (row['used_at'] as Date | null) ?? null,
  createdAt: row['created_at'] as Date,
});

const toRefresh = (row: Row): OAuthRefreshToken => ({
  tokenHash: row['token_hash'] as string,
  grantId: asId(row['grant_id'] as string),
  clientId: row['client_id'] as string,
  userId: asId(row['user_id'] as string),
  scopes: row['scopes'] as string[],
  expiresAt: row['expires_at'] as Date,
  usedAt: (row['used_at'] as Date | null) ?? null,
  createdAt: row['created_at'] as Date,
});

export const createOAuthRepository = (db: Queryable): OAuthRepository => ({
  async insertClient(client) {
    await db.query(
      'INSERT INTO oauth_clients (client_id, client_name, redirect_uris, client_uri, created_at) VALUES ($1,$2,$3,$4,$5)',
      [client.clientId, client.clientName, client.redirectUris, client.clientUri, client.createdAt],
    );
  },
  async findClient(clientId) {
    const { rows } = await db.query('SELECT * FROM oauth_clients WHERE client_id = $1', [clientId]);
    return rows[0] ? toClient(rows[0]) : null;
  },
  async insertCode(code) {
    await db.query(
      `INSERT INTO oauth_authorization_codes (code_hash, client_id, user_id, grant_id, redirect_uri, code_challenge,
         scopes, resource, expires_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        code.codeHash,
        code.clientId,
        code.userId,
        code.grantId,
        code.redirectUri,
        code.codeChallenge,
        code.scopes,
        code.resource,
        code.expiresAt,
        code.createdAt,
      ],
    );
  },
  async findCode(codeHash) {
    const { rows } = await db.query('SELECT * FROM oauth_authorization_codes WHERE code_hash = $1', [
      codeHash,
    ]);
    return rows[0] ? toCode(rows[0]) : null;
  },
  async markCodeUsed(codeHash, at) {
    const result = await db.query(
      'UPDATE oauth_authorization_codes SET used_at = $2 WHERE code_hash = $1 AND used_at IS NULL',
      [codeHash, at],
    );
    return result.rowCount === 1;
  },
  async insertRefreshToken(token) {
    await db.query(
      `INSERT INTO oauth_refresh_tokens (token_hash, grant_id, client_id, user_id, scopes, expires_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        token.tokenHash,
        token.grantId,
        token.clientId,
        token.userId,
        token.scopes,
        token.expiresAt,
        token.createdAt,
      ],
    );
  },
  async findRefreshToken(tokenHash) {
    const { rows } = await db.query('SELECT * FROM oauth_refresh_tokens WHERE token_hash = $1', [tokenHash]);
    return rows[0] ? toRefresh(rows[0]) : null;
  },
  async markRefreshTokenUsed(tokenHash, at) {
    const result = await db.query(
      'UPDATE oauth_refresh_tokens SET used_at = $2 WHERE token_hash = $1 AND used_at IS NULL',
      [tokenHash, at],
    );
    return result.rowCount === 1;
  },
});
