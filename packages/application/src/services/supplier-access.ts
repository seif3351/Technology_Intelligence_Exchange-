import { type Offering, type TechnicalClaim, asId, notFound } from '@atx/domain';
import { authorizeTenant, requireScope } from '../policies';
import type { RequestContext, TenantScope } from '../principal';
import type { ClaimRepository } from '../ports/repositories';

/** Supplier workspace writes need the `supplier:write` scope and at least the given organization role. */
export const supplierWriteScope = (
  ctx: RequestContext,
  organizationId: string,
  role: 'editor' | 'admin' = 'editor',
): TenantScope => {
  requireScope(ctx.principal, 'supplier:write');
  return authorizeTenant(ctx, asId(organizationId), role);
};

/** Same error for "missing" and "belongs to another tenant" to avoid IDOR probing. */
export const ownedOffering = async (
  pending: Promise<Offering | null>,
  scope: TenantScope,
): Promise<Offering> => {
  const offering = await pending;
  if (!offering || offering.organizationId !== scope.organizationId) throw notFound('Offering');
  return offering;
};

export const ownedClaim = async (
  claims: ClaimRepository,
  scope: TenantScope,
  claimId: string,
): Promise<TechnicalClaim> => {
  const claim = await claims.findById(asId(claimId));
  if (!claim || claim.organizationId !== scope.organizationId) throw notFound('Claim');
  return claim;
};
