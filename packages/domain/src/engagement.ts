import { invariant } from './errors';
import type { EngagementId, OfferingId, OrganizationId, RequirementId, UserId } from './ids';
import type { SupplierFacingRequirement } from './requirement';

export const ENGAGEMENT_TYPES = ['demo', 'workshop', 'poc', 'rfi'] as const;
export type EngagementType = (typeof ENGAGEMENT_TYPES)[number];

export const ENGAGEMENT_STATUSES = ['submitted', 'acknowledged', 'declined', 'withdrawn', 'closed'] as const;
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number];

/**
 * A buyer-initiated request that discloses information to a supplier.
 * It only exists after explicit human confirmation of exactly what is shared
 * (see the prepare/confirm flow in the application layer).
 */
export interface EngagementRequest {
  readonly id: EngagementId;
  readonly type: EngagementType;
  readonly buyerOrganizationId: OrganizationId;
  readonly supplierOrganizationId: OrganizationId;
  readonly offeringId: OfferingId | null;
  readonly requirementId: RequirementId | null;
  /** Snapshot of exactly what was disclosed at confirmation time. */
  readonly disclosure: EngagementDisclosure;
  readonly status: EngagementStatus;
  readonly idempotencyKey: string;
  readonly requestedBy: UserId;
  readonly confirmedAt: Date;
  /** What the supplier chose to share back when responding (contact handover). */
  readonly supplierResponse: SupplierResponse | null;
  readonly respondedBy: UserId | null;
  readonly respondedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * The supplier's answer. A contact is required to acknowledge a request, so
 * the buyer always learns whom to talk to; declining needs no contact.
 */
export interface SupplierResponse {
  readonly message: string | null;
  readonly contactName: string | null;
  readonly contactEmail: string | null;
}

export interface EngagementDisclosure {
  readonly buyerOrganizationName: string;
  readonly contactName: string;
  readonly contactEmail: string;
  readonly message: string;
  readonly requirement: SupplierFacingRequirement | null;
}

const TRANSITIONS: Readonly<Record<EngagementStatus, readonly EngagementStatus[]>> = {
  submitted: ['acknowledged', 'declined', 'withdrawn'],
  acknowledged: ['closed', 'withdrawn'],
  declined: [],
  withdrawn: [],
  closed: [],
};

export const respondToEngagement = (
  engagement: EngagementRequest,
  to: Extract<EngagementStatus, 'acknowledged' | 'declined'>,
  response: SupplierResponse,
  respondedBy: UserId,
  now: Date,
): EngagementRequest => {
  if (to === 'acknowledged' && (!response.contactName || !response.contactEmail))
    throw invariant('Acknowledging a request requires a contact name and email for the buyer');
  return {
    ...transitionEngagement(engagement, to, now),
    supplierResponse: response,
    respondedBy,
    respondedAt: now,
  };
};

export const transitionEngagement = (
  engagement: EngagementRequest,
  to: EngagementStatus,
  now: Date,
): EngagementRequest => {
  if (!TRANSITIONS[engagement.status].includes(to)) {
    throw invariant(`Cannot move engagement from ${engagement.status} to ${to}`);
  }
  return { ...engagement, status: to, updatedAt: now };
};
