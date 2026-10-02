import {
  type Offering,
  type TechnicalClaim,
  asId,
  checkExternalUrl,
  invariant,
  notFound,
  validationError,
} from '@atx/domain';
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

/**
 * Human-in-the-loop for public content: an agent (any principal acting
 * through a client) may edit drafts only. Changing what buyers already see
 * goes through a person on the website, or retract + re-publish with approval.
 */
export const assertMayEditPublicContent = (ctx: RequestContext, isPublic: boolean): void => {
  if (isPublic && ctx.principal.kind === 'user' && ctx.principal.clientId !== null)
    throw invariant(
      'Agents can only edit drafts. Published content is changed by a person on the website, or retract it and publish a corrected draft with approval.',
    );
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

/** Validates a user-supplied external URL (https, no credentials, no private hosts). Nothing is fetched. */
export const safeExternalUrl = (raw: string, field: string): string => {
  const result = checkExternalUrl(raw);
  if (!result.ok)
    throw validationError(`Invalid ${field}: ${result.reason}`, [{ path: field, message: result.reason }]);
  return result.url;
};
