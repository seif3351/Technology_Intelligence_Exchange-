import { createHash, randomBytes } from 'node:crypto';
import { type AuditActor, type AuditOutcome, type OrganizationId, newId, validationError } from '@atx/domain';
import type { RequestContext } from '../principal';
import type { AuditLog } from '../ports/repositories';

export const auditActor = (ctx: RequestContext): AuditActor => {
  const { principal } = ctx;
  switch (principal.kind) {
    case 'user':
      return {
        type: 'user',
        userId: principal.userId,
        clientId: principal.clientId,
        channel: principal.channel,
      };
    case 'anonymous':
      return { type: 'anonymous', channel: principal.channel };
    case 'system':
      return { type: 'system', component: principal.component };
  }
};

export interface AuditInput {
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly organizationId: OrganizationId | null;
  readonly outcome?: AuditOutcome;
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

/** A random, URL-safe secret (256 bits) for single-use links; only its hash is persisted. */
export const generateSecretToken = (): string => randomBytes(32).toString('base64url');
export const hashSecretToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export const recordAudit = (
  log: AuditLog,
  ctx: RequestContext,
  now: Date,
  input: AuditInput,
): Promise<void> =>
  log.record({
    id: newId(),
    occurredAt: now,
    actor: auditActor(ctx),
    organizationId: input.organizationId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    outcome: input.outcome ?? 'success',
    requestId: ctx.requestId,
    metadata: input.metadata ?? {},
  });

// ------------------------------------------------------------------ pagination

export const MAX_PAGE_SIZE = 50;

export const clampLimit = (limit: number | undefined, fallback = 10): number =>
  Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(limit ?? fallback)));

/** Opaque offset cursor. Ordering is deterministic, so offsets are stable for unchanged data. */
export const encodeCursor = (offset: number): string =>
  Buffer.from(JSON.stringify({ o: offset })).toString('base64url');

export const decodeCursor = (cursor: string | null | undefined): number => {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o?: unknown };
    if (typeof parsed.o === 'number' && Number.isInteger(parsed.o) && parsed.o >= 0 && parsed.o < 10_000)
      return parsed.o;
  } catch {
    // fall through
  }
  throw validationError('Invalid pagination cursor');
};

export const paginate = <T>(items: readonly T[], offset: number, limit: number) => ({
  items: items.slice(offset, offset + limit),
  nextCursor: offset + limit < items.length ? encodeCursor(offset + limit) : null,
  total: items.length,
});
