/**
 * Branded identifier types. Branding prevents accidentally passing an
 * OfferingId where an OrganizationId is expected — a cheap guard against
 * a whole class of object-level authorization bugs.
 */
declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type OrganizationId = Brand<string, 'OrganizationId'>;
export type UserId = Brand<string, 'UserId'>;
export type OfferingId = Brand<string, 'OfferingId'>;
export type CapabilityId = Brand<string, 'CapabilityId'>;
export type ClaimId = Brand<string, 'ClaimId'>;
export type EvidenceId = Brand<string, 'EvidenceId'>;
export type AssetId = Brand<string, 'AssetId'>;
export type RequirementId = Brand<string, 'RequirementId'>;
export type EngagementId = Brand<string, 'EngagementId'>;
export type ConceptId = Brand<string, 'ConceptId'>;
export type FacetId = Brand<string, 'FacetId'>;
export type AuditEventId = Brand<string, 'AuditEventId'>;
export type DraftId = Brand<string, 'DraftId'>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const isUuid = (value: string): boolean => UUID_PATTERN.test(value);
export const isSlug = (value: string): boolean => SLUG_PATTERN.test(value) && value.length <= 120;

/** Random, non-enumerable identifiers (UUID v4) for every persisted entity. */
export const newId = <T extends string>(): Brand<string, T> =>
  globalThis.crypto.randomUUID() as Brand<string, T>;

export const asId = <T extends string>(value: string): Brand<string, T> => value as Brand<string, T>;

export const slugify = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
