import { forbidden } from '@atx/domain';
import type { ApplicationDeps } from '../deps';
import type { RequestContext } from '../principal';

/** Periodic housekeeping run by the worker (system principal only). */
export class MaintenanceService {
  constructor(private readonly deps: ApplicationDeps) {}

  async purgeExpired(ctx: RequestContext): Promise<Readonly<Record<string, number>>> {
    if (ctx.principal.kind !== 'system') throw forbidden('Maintenance runs as a system task');
    const counts = await this.deps.repos.retention.purge(this.deps.clock.now());
    for (const [table, count] of Object.entries(counts))
      if (count > 0) this.deps.telemetry.increment('atx.retention.purged', { table, count });
    return counts;
  }
}
