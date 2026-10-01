import type { RetentionRepository } from '@atx/application';
import type { Queryable } from '../db';

/**
 * Retention rules (ADR-0017/0013 follow-up): secrets are useless once expired
 * or used, so their hashes are deleted after a short grace period; unused
 * dynamically registered OAuth clients are removed after 7 days; finished
 * jobs after 30 days. Audit events are never purged here.
 */
const RULES: readonly (readonly [string, string])[] = [
  [
    'oauthCodes',
    "DELETE FROM oauth_authorization_codes WHERE expires_at < $1::timestamptz - interval '1 day'",
  ],
  [
    'oauthRefreshTokens',
    "DELETE FROM oauth_refresh_tokens WHERE expires_at < $1::timestamptz OR used_at < $1::timestamptz - interval '7 days'",
  ],
  ['userTokens', "DELETE FROM user_tokens WHERE expires_at < $1::timestamptz - interval '7 days'"],
  [
    'unusedOAuthClients',
    `DELETE FROM oauth_clients c WHERE c.created_at < $1::timestamptz - interval '7 days'
       AND NOT EXISTS (SELECT 1 FROM access_grants g WHERE g.client_id = c.client_id)
       AND NOT EXISTS (SELECT 1 FROM oauth_authorization_codes a WHERE a.client_id = c.client_id)
       AND NOT EXISTS (SELECT 1 FROM oauth_refresh_tokens r WHERE r.client_id = c.client_id)`,
  ],
  [
    'finishedJobs',
    "DELETE FROM jobs WHERE status IN ('succeeded','dead') AND updated_at < $1::timestamptz - interval '30 days'",
  ],
];

export const createRetentionRepository = (db: Queryable): RetentionRepository => ({
  async purge(now) {
    const counts: Record<string, number> = {};
    for (const [name, sql] of RULES) counts[name] = (await db.query(sql, [now])).rowCount ?? 0;
    return counts;
  },
});
