import { z } from 'zod';
import { ClaimView, EvidenceView } from './views';

/** Owner-facing records (supplier workspace). Never served to other tenants. */
export const OrganizationRecord = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    kind: z.string(),
    summary: z.string(),
    description: z.string(),
    website: z.string().nullable(),
    headquartersCountry: z.string().nullable(),
    regions: z.array(z.string()),
    employeeRange: z.string().nullable(),
    verificationState: z.string(),
    isDemo: z.boolean(),
    version: z.number().int(),
    updatedAt: z.string(),
  })
  .meta({ id: 'OrganizationRecord' });

export const OfferingRecord = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    slug: z.string(),
    type: z.string(),
    name: z.string(),
    summary: z.string(),
    description: z.string(),
    maturity: z.string(),
    details: z.record(z.string(), z.unknown()),
    commercial: z.record(z.string(), z.unknown()),
    regions: z.array(z.string()),
    status: z.string(),
    isDemo: z.boolean(),
    publishedAt: z.string().nullable(),
    version: z.number().int(),
    updatedAt: z.string(),
  })
  .meta({ id: 'OfferingRecord' });

export const AssetRecord = z
  .object({
    id: z.string(),
    offeringId: z.string().nullable(),
    kind: z.string(),
    title: z.string(),
    contentType: z.string(),
    byteSize: z.number().nullable(),
    externalUrl: z.string().nullable(),
    durationSeconds: z.number().nullable(),
    processingState: z.string(),
    extractionState: z.string(),
    failureReason: z.string().nullable(),
    createdAt: z.string(),
  })
  .meta({ id: 'AssetRecord' });

export const CapabilityRecord = z
  .object({
    id: z.string(),
    conceptId: z.string(),
    name: z.string(),
    description: z.string(),
    status: z.string(),
  })
  .meta({ id: 'CapabilityRecord' });

export const Workspace = z
  .object({
    organization: OrganizationRecord,
    offerings: z.array(OfferingRecord),
    claims: z.array(ClaimView),
    evidence: z.array(EvidenceView),
    assets: z.array(AssetRecord),
    capabilities: z.array(CapabilityRecord),
  })
  .meta({ id: 'Workspace' });

export const Me = z
  .object({
    user: z.object({
      id: z.string(),
      displayName: z.string(),
      platformRole: z.string(),
      emailVerified: z.boolean(),
    }),
    memberships: z.array(
      z.object({
        organizationId: z.string(),
        organizationName: z.string(),
        organizationSlug: z.string(),
        organizationKind: z.string(),
        role: z.string(),
      }),
    ),
    scopes: z.array(z.string()),
  })
  .meta({ id: 'Me' });

export const AuditEventRecord = z
  .object({
    id: z.string(),
    occurredAt: z.string(),
    actor: z.record(z.string(), z.unknown()),
    organizationId: z.string().nullable(),
    action: z.string(),
    resourceType: z.string(),
    resourceId: z.string().nullable(),
    outcome: z.string(),
    requestId: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()),
  })
  .meta({ id: 'AuditEvent' });
