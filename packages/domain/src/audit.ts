import type { AuditEventId, OrganizationId, UserId } from './ids';

export type AuditActor =
  | { readonly type: 'user'; readonly userId: UserId; readonly clientId: string | null; readonly channel: Channel }
  | { readonly type: 'anonymous'; readonly channel: Channel }
  | { readonly type: 'system'; readonly component: string };

export type Channel = 'web' | 'api' | 'mcp' | 'worker';

export type AuditOutcome = 'success' | 'denied' | 'failure';

/**
 * Append-only audit record. `metadata` must never contain secrets, tokens,
 * private requirement text or document contents — only identifiers and
 * coarse facts (counts, statuses).
 */
export interface AuditEvent {
  readonly id: AuditEventId;
  readonly occurredAt: Date;
  readonly actor: AuditActor;
  readonly organizationId: OrganizationId | null;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly outcome: AuditOutcome;
  readonly requestId: string | null;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
}
