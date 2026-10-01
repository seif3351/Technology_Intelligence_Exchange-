import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { withTransaction } from './db';

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

/**
 * Minimal forward-only migration runner: applies *.sql files in name order,
 * each in its own transaction, and refuses to run if an applied migration's
 * checksum changed (migrations are immutable once applied).
 */
export const migrate = async (pool: pg.Pool, directory = MIGRATIONS_DIR): Promise<string[]> => {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  const applied = new Map(
    (await pool.query<{ id: string; checksum: string }>('SELECT id, checksum FROM schema_migrations')).rows.map((row) => [row.id, row.checksum]),
  );
  const newlyApplied: string[] = [];
  for (const file of files) {
    const sql = await readFile(path.join(directory, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const existing = applied.get(file);
    if (existing) {
      if (existing !== checksum) throw new Error(`Migration ${file} was modified after being applied`);
      continue;
    }
    await withTransaction(pool, async (client) => {
      // Serialize concurrent migrators (e.g. several app instances starting at once).
      await client.query('SELECT pg_advisory_xact_lock(727274)');
      const again = await client.query('SELECT 1 FROM schema_migrations WHERE id = $1', [file]);
      if (again.rowCount) return;
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2)', [file, checksum]);
      newlyApplied.push(file);
    });
  }
  return newlyApplied;
};
