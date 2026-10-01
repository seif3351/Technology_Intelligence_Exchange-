import type { EnqueueOptions, JobPayloads, JobQueue, JobType } from '@atx/application';
import type { Queryable } from './db';

export const createJobQueue = (db: Queryable): JobQueue => ({
  async enqueue<T extends JobType>(type: T, payload: JobPayloads[T], options: EnqueueOptions = {}) {
    await db.query(
      `INSERT INTO jobs (type, payload, status, max_attempts, run_at, dedupe_key)
       VALUES ($1, $2, 'queued', $3, coalesce($4, now()), $5)
       ON CONFLICT (dedupe_key) WHERE status = 'queued' AND dedupe_key IS NOT NULL DO NOTHING`,
      [type, JSON.stringify(payload), options.maxAttempts ?? 5, options.runAt ?? null, options.dedupeKey ?? null],
    );
  },
});

export interface ClaimedJob {
  readonly id: number;
  readonly type: JobType;
  readonly payload: unknown;
  readonly attempts: number;
  readonly maxAttempts: number;
}

/** Worker-side operations of the PostgreSQL job queue (FOR UPDATE SKIP LOCKED). */
export const createJobRunnerStore = (db: Queryable) => ({
  async claimNext(workerId: string, types: readonly JobType[]): Promise<ClaimedJob | null> {
    const { rows } = await db.query(
      `UPDATE jobs SET status = 'running', locked_at = now(), locked_by = $1, attempts = attempts + 1, updated_at = now()
        WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_at <= now() AND type = ANY($2::text[])
                     ORDER BY run_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING id, type, payload, attempts, max_attempts`,
      [workerId, types],
    );
    const row = rows[0];
    return row
      ? { id: Number(row['id']), type: row['type'] as JobType, payload: row['payload'], attempts: Number(row['attempts']), maxAttempts: Number(row['max_attempts']) }
      : null;
  },
  async complete(id: number): Promise<void> {
    await db.query("UPDATE jobs SET status = 'succeeded', completed_at = now(), updated_at = now(), locked_at = NULL WHERE id = $1", [id]);
  },
  /** Exponential backoff; jobs that exhausted their attempts become 'dead' for operator attention. */
  async fail(job: ClaimedJob, error: string): Promise<'retry' | 'dead'> {
    const dead = job.attempts >= job.maxAttempts;
    await db.query(
      `UPDATE jobs SET status = $2, last_error = $3, locked_at = NULL, updated_at = now(),
         run_at = now() + make_interval(secs => $4) WHERE id = $1`,
      [job.id, dead ? 'dead' : 'queued', error.slice(0, 2000), Math.min(3600, 2 ** job.attempts * 5)],
    );
    return dead ? 'dead' : 'retry';
  },
  /** Re-queues jobs whose worker died while holding them. */
  async releaseStale(olderThanSeconds: number): Promise<number> {
    const result = await db.query(
      `UPDATE jobs SET status = 'queued', locked_at = NULL, locked_by = NULL, updated_at = now()
        WHERE status = 'running' AND locked_at < now() - make_interval(secs => $1)`,
      [olderThanSeconds],
    );
    return result.rowCount ?? 0;
  },
  async counts(): Promise<Record<string, number>> {
    const { rows } = await db.query('SELECT status, count(*) AS n FROM jobs GROUP BY status');
    return Object.fromEntries(rows.map((row) => [row['status'] as string, Number(row['n'])]));
  },
});

export type JobRunnerStore = ReturnType<typeof createJobRunnerStore>;
