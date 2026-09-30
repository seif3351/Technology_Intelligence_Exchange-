import { invariant, validationError } from './errors';
import type { OfferingId, OrganizationId, UserId } from './ids';
import { isSlug } from './ids';
import { sanitizeUntrustedText } from './text';

/**
 * Products, services and technology platforms are distinct offering types
 * with type-specific details; they share lifecycle, publication and claims.
 */
export const OFFERING_TYPES = ['product', 'service', 'technology_platform'] as const;
export type OfferingType = (typeof OFFERING_TYPES)[number];

/** Technology maturity, ordered from least to most mature. */
export const MATURITY_LEVELS = ['concept', 'prototype', 'pilot', 'production'] as const;
export type MaturityLevel = (typeof MATURITY_LEVELS)[number];

export const maturityAtLeast = (level: MaturityLevel, minimum: MaturityLevel): boolean =>
  MATURITY_LEVELS.indexOf(level) >= MATURITY_LEVELS.indexOf(minimum);

export const OFFERING_STATUSES = ['draft', 'in_review', 'published', 'archived'] as const;
export type OfferingStatus = (typeof OFFERING_STATUSES)[number];

export const DEPLOYMENT_MODELS = ['on_premise', 'cloud', 'hybrid', 'embedded', 'on_site'] as const;
export type DeploymentModel = (typeof DEPLOYMENT_MODELS)[number];

export interface ProductDetails {
  readonly type: 'product' | 'technology_platform';
  readonly currentVersion: string | null;
  readonly licensingModel: string | null;
  readonly deploymentModels: readonly DeploymentModel[];
}

export interface ServiceDetails {
  readonly type: 'service';
  readonly deliveryModel: 'onsite' | 'remote' | 'hybrid' | null;
  readonly engagementModels: readonly string[];
}

export type OfferingDetails = ProductDetails | ServiceDetails;

/** Commercial metadata only — the platform is not a pricing or contracting system. */
export interface CommercialModel {
  readonly pricingModel: string | null;
  readonly availability: readonly string[];
  readonly notes: string | null;
}

export interface Offering {
  readonly id: OfferingId;
  readonly organizationId: OrganizationId;
  readonly slug: string;
  readonly type: OfferingType;
  readonly name: string;
  readonly summary: string;
  readonly description: string;
  readonly maturity: MaturityLevel;
  readonly details: OfferingDetails;
  readonly commercial: CommercialModel;
  readonly regions: readonly string[];
  readonly status: OfferingStatus;
  readonly isDemo: boolean;
  readonly publishedAt: Date | null;
  readonly publishedBy: UserId | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface OfferingInput {
  readonly slug: string;
  readonly type: OfferingType;
  readonly name: string;
  readonly summary: string;
  readonly description: string;
  readonly maturity: MaturityLevel;
  readonly details: OfferingDetails;
  readonly commercial: CommercialModel;
  readonly regions: readonly string[];
}

export const normalizeOfferingInput = (input: OfferingInput): OfferingInput => {
  const problems: string[] = [];
  if (!isSlug(input.slug)) problems.push('slug must be lowercase kebab-case');
  if (input.name.trim().length < 2 || input.name.length > 160) problems.push('name must be 2-160 characters');
  if (input.summary.trim().length < 10) problems.push('summary must be at least 10 characters');
  const detailsTypeMatches =
    input.type === 'service' ? input.details.type === 'service' : input.details.type === input.type;
  if (!detailsTypeMatches) problems.push('details.type must match offering type');
  if (problems.length > 0) {
    throw validationError('Invalid offering', problems.map((message) => ({ message })));
  }
  return {
    ...input,
    name: sanitizeUntrustedText(input.name, 160),
    summary: sanitizeUntrustedText(input.summary, 400),
    description: sanitizeUntrustedText(input.description, 8000),
  };
};

const STATUS_TRANSITIONS: Readonly<Record<OfferingStatus, readonly OfferingStatus[]>> = {
  draft: ['in_review', 'published', 'archived'],
  in_review: ['draft', 'published', 'archived'],
  published: ['draft', 'archived'],
  archived: ['draft'],
};

export const transitionOffering = (
  offering: Offering,
  to: OfferingStatus,
  actor: UserId,
  now: Date,
): Offering => {
  if (!STATUS_TRANSITIONS[offering.status].includes(to)) {
    throw invariant(`Cannot move offering from ${offering.status} to ${to}`);
  }
  return {
    ...offering,
    status: to,
    publishedAt: to === 'published' ? now : offering.publishedAt,
    publishedBy: to === 'published' ? actor : offering.publishedBy,
    version: offering.version + 1,
    updatedAt: now,
  };
};

export const isPubliclyVisible = (offering: Offering): boolean => offering.status === 'published';
