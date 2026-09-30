import { invariant, validationError } from './errors';
import type { OrganizationId, UserId } from './ids';
import { isSlug } from './ids';
import { sanitizeUntrustedText } from './text';

export const ORGANIZATION_KINDS = ['supplier', 'buyer', 'hybrid', 'platform'] as const;
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];

export const ORGANIZATION_VERIFICATION_STATES = [
  'unverified',
  'pending',
  'verified',
  'rejected',
  'suspended',
] as const;
export type OrganizationVerificationState = (typeof ORGANIZATION_VERIFICATION_STATES)[number];

export interface ContactPoint {
  readonly name: string | null;
  readonly email: string | null;
  readonly url: string | null;
}

export interface Organization {
  readonly id: OrganizationId;
  readonly slug: string;
  readonly name: string;
  readonly kind: OrganizationKind;
  readonly summary: string;
  readonly description: string;
  readonly website: string | null;
  readonly headquartersCountry: string | null;
  readonly regions: readonly string[];
  readonly employeeRange: string | null;
  readonly contact: ContactPoint;
  readonly verificationState: OrganizationVerificationState;
  readonly verifiedBy: UserId | null;
  readonly verifiedAt: Date | null;
  /** Synthetic demo data is always labelled as such everywhere it is displayed. */
  readonly isDemo: boolean;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export const isSupplierOrganization = (org: Organization): boolean =>
  org.kind === 'supplier' || org.kind === 'hybrid';

export const isBuyerOrganization = (org: Organization): boolean =>
  org.kind === 'buyer' || org.kind === 'hybrid';

export const validateOrganizationProfile = (org: Pick<Organization, 'slug' | 'name' | 'website' | 'headquartersCountry'>): void => {
  const problems: string[] = [];
  if (!isSlug(org.slug)) problems.push('slug must be lowercase kebab-case');
  if (org.name.trim().length < 2 || org.name.length > 160) problems.push('name must be 2-160 characters');
  if (org.headquartersCountry !== null && !/^[A-Z]{2}$/.test(org.headquartersCountry)) {
    problems.push('headquartersCountry must be an ISO 3166-1 alpha-2 code');
  }
  if (problems.length > 0) {
    throw validationError('Invalid organization profile', problems.map((message) => ({ message })));
  }
};

export const sanitizeProfileText = (value: string, max = 4000): string => sanitizeUntrustedText(value, max);

const VERIFICATION_TRANSITIONS: Readonly<Record<OrganizationVerificationState, readonly OrganizationVerificationState[]>> = {
  unverified: ['pending'],
  pending: ['verified', 'rejected'],
  verified: ['suspended', 'pending'],
  rejected: ['pending'],
  suspended: ['verified', 'rejected'],
};

export const transitionOrganizationVerification = (
  org: Organization,
  to: OrganizationVerificationState,
  actor: UserId,
  now: Date,
): Organization => {
  if (!VERIFICATION_TRANSITIONS[org.verificationState].includes(to)) {
    throw invariant(`Cannot move organization verification from ${org.verificationState} to ${to}`);
  }
  return {
    ...org,
    verificationState: to,
    verifiedBy: to === 'verified' ? actor : org.verifiedBy,
    verifiedAt: to === 'verified' ? now : org.verifiedAt,
    version: org.version + 1,
    updatedAt: now,
  };
};
