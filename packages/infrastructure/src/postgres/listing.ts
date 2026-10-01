/**
 * SQL mirror of the domain rule `isPubliclyListed` (ADR 0011): content of an
 * organization is public only while it is platform-verified. Keep both in sync.
 */
export const listedOrganization = (organizationIdColumn: string): string =>
  `EXISTS (SELECT 1 FROM organizations lo WHERE lo.id = ${organizationIdColumn} AND lo.verification_state = 'verified')`;
