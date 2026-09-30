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
  readonly createdAt: Date;
  readonly updatedAt: Date;
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
