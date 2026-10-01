import { hostname } from 'node:os';
import { type JobType, JOB_TYPES, type RequestContext } from '@atx/application';
import { asId } from '@atx/domain';
import type { ClaimedJob } from '@atx/infrastructure';
import type { Runtime } from '@atx/runtime';
import { z } from 'zod';

const SYSTEM: RequestContext = { principal: { kind: 'system', component: 'worker' }, requestId: 'worker' };

const payloads = {
  'asset.process': z.object({ assetId: z.uuid() }),
  'offering.reindex': z.object({ offeringId: z.uuid() }),
  'engagement.notify': z.object({ engagementId: z.uuid() }),
  'engagement.response_notify': z.object({ engagementId: z.uuid() }),
} satisfies Record<JobType, z.ZodType>;

/**
 * Executes one job. Payloads are re-validated: the queue is a trust boundary
 * like any other input.
 */
export const executeJob = async (runtime: Runtime, job: ClaimedJob): Promise<void> => {
  const ctx = { ...SYSTEM, requestId: `job-${job.id}` };
  switch (job.type) {
    case 'asset.process': {
      const { assetId } = payloads['asset.process'].parse(job.payload);
      await runtime.app.ingestion.processAsset(ctx, asId(assetId));
      return;
    }
    case 'offering.reindex': {
      const { offeringId } = payloads['offering.reindex'].parse(job.payload);
      await runtime.app.indexing.reindexOffering(asId(offeringId));
      return;
    }
    case 'engagement.notify': {
      const { engagementId } = payloads['engagement.notify'].parse(job.payload);
      const notified = await runtime.app.engagements.notifySupplier(ctx, engagementId);
      runtime.logger.info({ engagementId, recipients: notified }, 'supplier notified of engagement request');
      return;
    }
    case 'engagement.response_notify': {
      const { engagementId } = payloads['engagement.response_notify'].parse(job.payload);
      await runtime.app.engagements.notifyBuyer(ctx, engagementId);
      return;
    }
  }
};

export interface WorkerOptions {
  readonly pollIntervalMs?: number;
  readonly staleAfterSeconds?: number;
  readonly signal?: AbortSignal;
}

/** Processes jobs until no job is ready. Returns the number processed (useful for tests and one-shot runs). */
export const drainJobs = async (
  runtime: Runtime,
  workerId = `${hostname()}-${process.pid}`,
): Promise<number> => {
  let processed = 0;
  for (;;) {
    const job = await runtime.jobStore.claimNext(workerId, JOB_TYPES);
    if (!job) return processed;
    await runOne(runtime, job);
    processed += 1;
  }
};

const runOne = async (runtime: Runtime, job: ClaimedJob): Promise<void> => {
  const telemetry = runtime.app.deps.telemetry;
  const started = Date.now();
  try {
    await telemetry.span(
      `job ${job.type}`,
      { 'job.id': job.id, 'job.type': job.type, 'job.attempt': job.attempts },
      () => executeJob(runtime, job),
    );
    await runtime.jobStore.complete(job.id);
    telemetry.recordDuration('atx.job.duration', Date.now() - started, {
      type: job.type,
      outcome: 'succeeded',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    const outcome = await runtime.jobStore.fail(job, message);
    telemetry.recordDuration('atx.job.duration', Date.now() - started, { type: job.type, outcome });
    runtime.logger.error({ err: error, jobId: job.id, type: job.type, outcome }, 'job failed');
    if (outcome === 'dead' && job.type === 'asset.process') {
      const parsed = payloads['asset.process'].safeParse(job.payload);
      if (parsed.success)
        await runtime.app.ingestion.markFailed(asId(parsed.data.assetId), 'processing failed repeatedly');
    }
  }
};

/** Long-running polling loop with stale-lock recovery. */
export const runWorker = async (runtime: Runtime, options: WorkerOptions = {}): Promise<void> => {
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  let lastStaleCheck = 0;
  let lastPurge = 0;
  while (!options.signal?.aborted) {
    if (Date.now() - lastPurge > 3_600_000) {
      const purged = await runtime.app.maintenance.purgeExpired({ ...SYSTEM, requestId: 'retention' });
      runtime.logger.info({ purged }, 'retention purge');
      lastPurge = Date.now();
    }
    if (Date.now() - lastStaleCheck > 60_000) {
      const released = await runtime.jobStore.releaseStale(options.staleAfterSeconds ?? 600);
      if (released > 0) runtime.logger.warn({ released }, 'released stale jobs');
      lastStaleCheck = Date.now();
    }
    const processed = await drainJobs(runtime);
    if (processed === 0) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
};
