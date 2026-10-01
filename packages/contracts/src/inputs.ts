import {
  CLAIM_PREDICATES,
  CONSTRAINT_LEVELS,
  DEPLOYMENT_MODELS,
  ENGAGEMENT_TYPES,
  EVIDENCE_KINDS,
  MATURITY_LEVELS,
  OFFERING_TYPES,
} from '@atx/domain';
import { z } from 'zod';
import { Cursor, Limit, Slug, Uuid } from './common';

export const ClaimPredicate = z.enum(CLAIM_PREDICATES).meta({ id: 'ClaimPredicate' });

const ConceptId = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(120);

export const ConstraintInput = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('concept'),
      conceptId: ConceptId.describe('Ontology concept id, e.g. "qnx". Use search_technologies to find ids.'),
      level: z.enum(CONSTRAINT_LEVELS).default('supports'),
      priority: z.enum(['hard', 'preference']).default('hard'),
      qualifiers: z.record(z.string().max(40), z.string().max(120)).default({}),
    }),
    z.object({
      kind: z.literal('maturity'),
      minimum: z.enum(MATURITY_LEVELS),
      priority: z.enum(['hard', 'preference']).default('hard'),
    }),
    z.object({
      kind: z.literal('production_reference'),
      priority: z.enum(['hard', 'preference']).default('hard'),
    }),
  ])
  .meta({ id: 'ConstraintInput' });

export type ConstraintInputT = z.infer<typeof ConstraintInput>;

export const MatchRequest = z
  .object({
    text: z.string().max(4000).optional().describe('Natural-language technical requirement.'),
    constraints: z.array(ConstraintInput).max(40).optional(),
    requirementId: Uuid.optional().describe("Saved private requirement of the caller's organization."),
    organizationId: Uuid.optional().describe('Buyer organization owning requirementId.'),
    confidentialTerms: z
      .array(z.string().max(120))
      .max(30)
      .optional()
      .describe('Terms that must never be processed, stored or echoed.'),
    requireAllHardConstraintsMet: z.boolean().optional(),
    limit: Limit,
    cursor: Cursor,
  })
  .meta({ id: 'MatchRequest' });

export const OfferingSearchRequest = z
  .object({
    query: z.string().max(500).optional(),
    conceptIds: z.array(ConceptId).max(20).optional(),
    types: z.array(z.enum(OFFERING_TYPES)).optional(),
    minimumMaturity: z.enum(MATURITY_LEVELS).optional(),
    limit: Limit,
    cursor: Cursor,
  })
  .meta({ id: 'OfferingSearchRequest' });

export const CompareRequest = z
  .object({
    offeringIds: z.array(Uuid).min(2).max(5),
    text: z.string().max(4000).optional(),
    constraints: z.array(ConstraintInput).max(40).optional(),
  })
  .meta({ id: 'CompareRequest' });

export const ExplainRequest = z
  .object({
    offeringId: Uuid,
    text: z.string().max(4000).optional(),
    constraints: z.array(ConstraintInput).max(40).optional(),
    requirementId: Uuid.optional(),
    organizationId: Uuid.optional(),
  })
  .meta({ id: 'ExplainRequest' });

export const RequirementCreate = z
  .object({
    title: z.string().min(3).max(200),
    description: z.string().min(10).max(8000),
    constraints: z.array(ConstraintInput).max(40).optional(),
    confidentialTerms: z.array(z.string().max(120)).max(30).optional(),
  })
  .meta({ id: 'RequirementCreate' });

export const RequirementUpdate = RequirementCreate.partial()
  .extend({
    expectedVersion: z.number().int().min(1),
    status: z.enum(['draft', 'active', 'closed']).optional(),
  })
  .meta({ id: 'RequirementUpdate' });

export const EngagementDraftInput = z
  .object({
    buyerOrganizationId: Uuid,
    offeringId: Uuid,
    type: z.enum(ENGAGEMENT_TYPES),
    message: z.string().min(10).max(3000),
    contactName: z.string().min(2).max(120),
    contactEmail: z.email().max(254),
    requirementId: Uuid.optional(),
    disclosedSummary: z.string().max(2000).optional(),
  })
  .meta({ id: 'EngagementDraft' });

export const EngagementResponse = z
  .object({
    status: z.enum(['acknowledged', 'declined', 'closed']),
    message: z.string().max(2000).nullable().optional(),
    contactName: z.string().max(120).nullable().optional(),
    contactEmail: z.email().max(254).nullable().optional(),
  })
  .meta({ id: 'EngagementResponse' });
export const EngagementConfirmInput = EngagementDraftInput.extend({
  confirmationToken: z.string().min(20).max(4000),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
}).meta({ id: 'EngagementConfirm' });

export const OfferingCreate = z
  .object({
    slug: Slug,
    type: z.enum(OFFERING_TYPES),
    name: z.string().min(2).max(160),
    summary: z.string().min(10).max(400),
    description: z.string().max(8000).default(''),
    maturity: z.enum(MATURITY_LEVELS),
    details: z.discriminatedUnion('type', [
      z.object({
        type: z.enum(['product', 'technology_platform']),
        currentVersion: z.string().max(40).nullable().default(null),
        licensingModel: z.string().max(120).nullable().default(null),
        deploymentModels: z.array(z.enum(DEPLOYMENT_MODELS)).default([]),
      }),
      z.object({
        type: z.literal('service'),
        deliveryModel: z.enum(['onsite', 'remote', 'hybrid']).nullable().default(null),
        engagementModels: z.array(z.string().max(80)).default([]),
      }),
    ]),
    commercial: z
      .object({
        pricingModel: z.string().max(120).nullable().default(null),
        availability: z.array(z.string().max(40)).default([]),
        notes: z.string().max(500).nullable().default(null),
      })
      .default({ pricingModel: null, availability: [], notes: null }),
    regions: z.array(z.string().max(40)).max(20).default([]),
  })
  .meta({ id: 'OfferingCreate' });

export const OfferingUpdate = OfferingCreate.omit({ slug: true, type: true })
  .partial()
  .extend({ expectedVersion: z.number().int().min(1) })
  .meta({ id: 'OfferingUpdate' });

export const OfferingStatusChange = z.object({
  status: z.enum(['published', 'draft', 'archived']),
  expectedVersion: z.number().int().min(1),
});

export const ClaimCreate = z
  .object({
    subject: z.object({ type: z.enum(['organization', 'offering', 'capability']), id: Uuid }),
    predicate: ClaimPredicate,
    conceptId: ConceptId,
    qualifiers: z.record(z.string().max(40), z.string().max(200)).optional(),
    statement: z.string().min(3).max(1000),
    provenanceCategory: z.enum(['SUPPLIER_VERIFIED', 'PUBLIC_SOURCE', 'UNVERIFIED']).optional(),
    sourceUrl: z.string().max(2048).nullable().optional(),
    sourceReference: z.string().max(300).nullable().optional(),
    sourceVersion: z.string().max(60).nullable().optional(),
    evidenceIds: z.array(Uuid).max(20).optional(),
    reviewAt: z.iso.datetime().nullable().optional(),
    expiresAt: z.iso.datetime().nullable().optional(),
  })
  .meta({ id: 'ClaimCreate' });

export const ClaimRevise = ClaimCreate.omit({ subject: true })
  .partial()
  .extend({ expectedVersion: z.number().int().min(1) })
  .meta({ id: 'ClaimRevise' });
export const VersionOnly = z.object({ expectedVersion: z.number().int().min(1) });

export const EvidenceCreate = z
  .object({
    offeringId: Uuid.nullable().optional(),
    kind: z.enum(EVIDENCE_KINDS).exclude(['video']),
    title: z.string().min(3).max(200),
    description: z.string().max(2000).default(''),
    url: z.string().max(2048).nullable().optional(),
    sourceReference: z.string().max(300).nullable().optional(),
    sourceVersion: z.string().max(60).nullable().optional(),
    customerDisclosure: z.enum(['named', 'anonymized']).nullable().optional(),
  })
  .meta({ id: 'EvidenceCreate' });

export const ExternalVideoCreate = z
  .object({
    offeringId: Uuid,
    title: z.string().min(3).max(200),
    description: z.string().max(2000).default(''),
    url: z.string().max(2048),
    durationSeconds: z.number().int().min(0).max(36_000).nullable().optional(),
    thumbnailUrl: z.string().max(2048).nullable().optional(),
  })
  .meta({ id: 'ExternalVideoCreate' });

export const OrganizationCreate = z
  .object({
    name: z.string().min(2).max(160),
    kind: z.enum(['supplier', 'buyer', 'hybrid']),
    summary: z.string().min(10).max(400),
    website: z.string().max(2048).nullable().optional(),
    headquartersCountry: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable()
      .optional(),
  })
  .meta({ id: 'OrganizationCreate' });

export const OrganizationUpdate = z
  .object({
    expectedVersion: z.number().int().min(1),
    summary: z.string().min(10).max(400).optional(),
    description: z.string().max(8000).optional(),
    website: z.string().max(2048).nullable().optional(),
    headquartersCountry: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable()
      .optional(),
    regions: z.array(z.string().max(60)).max(20).optional(),
    employeeRange: z.string().max(40).nullable().optional(),
  })
  .meta({ id: 'OrganizationUpdate' });

export const LoginRequest = z
  .object({ email: z.email().max(254), password: z.string().min(1).max(200) })
  .meta({ id: 'LoginRequest' });
/** Format of every single-use secret mailed to users (invitations, verification, password reset). */
export const SecretToken = z.string().regex(/^[A-Za-z0-9_-]{20,200}$/);
export const RegisterRequest = z
  .object({
    email: z.email().max(254),
    password: z.string().min(12).max(200),
    displayName: z.string().min(1).max(120),
    acceptTerms: z.literal(true).describe('The user explicitly accepted the current terms of use.'),
    invitationToken: SecretToken.optional().describe(
      'Secret token from an invitation link (required when registration is invite-only).',
    ),
  })
  .meta({ id: 'RegisterRequest' });
export const SecretTokenBody = z.object({ token: SecretToken }).meta({ id: 'SecretTokenBody' });
export const PasswordResetRequest = z
  .object({ email: z.email().max(254) })
  .meta({ id: 'PasswordResetRequest' });
export const PasswordResetConfirm = z
  .object({ token: SecretToken, newPassword: z.string().min(12).max(200) })
  .meta({ id: 'PasswordResetConfirm' });
export const InvitationPreview = z
  .object({ email: z.string(), organizationName: z.string().nullable(), role: z.string().nullable() })
  .meta({ id: 'InvitationPreview' });
export const RegistrationPolicy = z
  .object({ mode: z.enum(['open', 'invite']), termsVersion: z.string() })
  .meta({ id: 'RegistrationPolicy' });
export const InvitationRecord = z
  .object({
    id: z.string(),
    email: z.string(),
    organizationId: z.string().nullable(),
    role: z.string().nullable(),
    status: z.enum(['pending', 'accepted', 'revoked', 'expired']),
    expiresAt: z.string(),
    createdAt: z.string(),
  })
  .meta({ id: 'InvitationRecord' });
export const OrganizationRoleEnum = z
  .enum(['viewer', 'editor', 'admin', 'owner'])
  .meta({ id: 'OrganizationRole' });
export const OrganizationInvitationCreate = z
  .object({ email: z.email().max(254), role: OrganizationRoleEnum })
  .meta({ id: 'OrganizationInvitationCreate' });
export const MemberRoleUpdate = z.object({ role: OrganizationRoleEnum }).meta({ id: 'MemberRoleUpdate' });
export const MemberRecord = z
  .object({
    userId: z.string(),
    displayName: z.string(),
    email: z.string(),
    role: OrganizationRoleEnum,
    since: z.string(),
  })
  .meta({ id: 'MemberRecord' });
export const PlatformInvitationCreate = z
  .object({ email: z.email().max(254) })
  .meta({ id: 'PlatformInvitationCreate' });
export const IssuedInvitation = z
  .object({
    invitation: InvitationRecord,
    url: z.string().describe('Secret sign-up link. Shown once; share it only with the invitee.'),
    emailed: z.boolean().describe('Whether the invitation email was delivered.'),
  })
  .meta({ id: 'IssuedInvitation' });
export const AgentTokenRequest = z
  .object({
    scopes: z
      .array(
        z.enum([
          'catalog:read',
          'requirements:read',
          'requirements:write',
          'engagements:write',
          'supplier:write',
        ]),
      )
      .min(1),
    label: z
      .string()
      .min(1)
      .max(80)
      .default('Agent token')
      .describe('Where the token is used, e.g. "Claude Code laptop".'),
    expiresInDays: z.number().int().min(1).max(90).default(30),
  })
  .meta({ id: 'AgentTokenRequest' });
export const AgentTokenRecord = z
  .object({
    id: z.string(),
    label: z.string(),
    scopes: z.array(z.string()),
    status: z.enum(['active', 'revoked', 'expired']),
    createdAt: z.string(),
    expiresAt: z.string(),
    lastUsedAt: z.string().nullable(),
  })
  .meta({ id: 'AgentTokenRecord' });
export const IssuedAgentToken = z
  .object({
    accessToken: z.string().describe('Shown once. Treat it like a password.'),
    tokenType: z.literal('Bearer'),
    audience: z.string(),
    grant: AgentTokenRecord,
  })
  .meta({ id: 'IssuedAgentToken' });
export const TokenResponse = z
  .object({
    accessToken: z.string(),
    tokenType: z.literal('Bearer'),
    expiresIn: z.number().int(),
    audience: z.string(),
    scopes: z.array(z.string()),
  })
  .meta({ id: 'TokenResponse' });

export const AdminVerificationDecision = z.object({
  state: z.enum(['verified', 'rejected', 'suspended']),
  reason: z.string().max(500).nullable().default(null),
});
export const AdminClaimReview = z.object({
  outcome: z.enum(['platform_verified', 'disputed', 'rejected']),
  notes: z.string().max(1000).nullable().default(null),
});
export const AdminConceptCreate = z.object({
  id: ConceptId,
  facetId: z.string().max(60),
  label: z.string().min(1).max(120),
  description: z.string().min(3).max(500),
  aliases: z.array(z.string().max(80)).max(30).default([]),
  broaderConceptIds: z.array(ConceptId).max(10).default([]),
});
