import { CONSTRAINT_LEVELS, ENGAGEMENT_TYPES, MATURITY_LEVELS, OFFERING_TYPES } from '@atx/domain';
import { z } from 'zod';
import { Untrusted } from './common';

/**
 * MCP tool contracts. Results are deliberately compact (agent context is
 * expensive): stable ids, short human-readable summaries, provenance and
 * URLs — never whole documents. Full detail is one `get_*` call away.
 */
const id = z.string().describe('Stable identifier');
const conceptId = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(120);
const limit = (max: number, fallback: number) => z.number().int().min(1).max(max).default(fallback);
const cursor = z.string().max(200).optional().describe('Opaque cursor from a previous result (nextCursor).');
const confidentialTerms = z
  .array(z.string().max(120))
  .max(30)
  .optional()
  .describe(
    'Project names, vehicle programs, customer names or internal identifiers that must never be processed, stored or echoed. They are removed before any processing.',
  );

export const McpConstraintInput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('concept'),
    conceptId: conceptId.describe(
      'Ontology concept id (find with search_technologies), e.g. "qnx", "autosar-adaptive".',
    ),
    level: z
      .enum(CONSTRAINT_LEVELS)
      .default('supports')
      .describe(
        'mentioned < supports < experience < production < certified. "certified" requires explicit third-party certification.',
      ),
    priority: z.enum(['hard', 'preference']).default('hard'),
    asil: z.enum(['A', 'B', 'C', 'D']).optional().describe('Minimum ASIL for safety constraints.'),
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
]);

const requirementSource = {
  text: z
    .string()
    .max(4000)
    .optional()
    .describe('Natural-language technical requirement. Interpreted into constraints server-side.'),
  constraints: z
    .array(McpConstraintInput)
    .max(40)
    .optional()
    .describe('Explicit structured constraints (take precedence over text interpretation).'),
  requirement_id: z
    .uuid()
    .optional()
    .describe("A saved private requirement of the caller's organization (requires authentication)."),
  organization_id: z
    .uuid()
    .optional()
    .describe('Buyer organization id; only needed if the user belongs to several organizations.'),
  confidential_terms: confidentialTerms,
};

// ------------------------------------------------------------------ outputs

export const McpOffering = z.object({
  id,
  name: z.string(),
  type: z.string(),
  maturity: z.string(),
  supplier: z.object({ id, name: z.string(), verificationState: z.string() }),
  summary: z.string(),
  untrusted: Untrusted,
  keyConcepts: z.array(z.string()),
  url: z.string(),
  isDemo: z.boolean(),
});

export const McpConstraint = z.object({
  id: z.string(),
  kind: z.string(),
  description: z.string(),
  priority: z.string(),
  level: z.string().nullable(),
  conceptId: z.string().nullable(),
});

export const McpInterpretation = z.object({
  hardConstraints: z.array(McpConstraint),
  preferences: z.array(McpConstraint),
  unknownTerms: z
    .array(z.string())
    .describe(
      'Terms not in the ontology; used only for text relevance. Ask the user only if they are critical.',
    ),
  notes: z.array(z.string()),
  method: z.string(),
});

export const McpAssessment = z.object({
  constraintId: z.string(),
  description: z.string(),
  priority: z.string(),
  status: z
    .enum(['met', 'partial', 'unmet', 'unknown'])
    .describe('unknown = no information (NOT the same as unmet)'),
  basis: z
    .string()
    .nullable()
    .describe('Strongest evidence basis, e.g. "stated by supplier (not independently verified)"'),
  supportingClaimIds: z.array(z.string()),
  explanation: z.string(),
});

export const McpMatch = z.object({
  rank: z.number().int(),
  offering: McpOffering,
  hardConstraintStatus: z.enum(['all_met', 'some_unknown', 'some_unmet', 'none_specified']),
  score: z.number().describe('Weighted sum of scoreBreakdown; orders candidates, does not certify them.'),
  scoreBreakdown: z.array(z.object({ name: z.string(), weight: z.number(), value: z.number() })),
  confidence: z.enum(['high', 'medium', 'low']),
  summary: z.string(),
  assessments: z.array(McpAssessment),
  gaps: z.array(z.object({ description: z.string(), suggestedQuestion: z.string() })),
});

export const McpClaim = z.object({
  id,
  subject: z.string(),
  concept: z.object({ id: z.string(), label: z.string() }),
  predicate: z
    .string()
    .describe('Exact strength of the statement, e.g. "designed for (not a certification)"'),
  statement: z.string(),
  untrusted: Untrusted,
  provenance: z
    .string()
    .describe(
      'SUPPLIER_VERIFIED | PUBLIC_SOURCE | LICENSED_THIRD_PARTY | INTERNAL | AI_INFERRED | UNVERIFIED',
    ),
  trust: z.string(),
  verification: z.string(),
  sourceUrl: z.string().nullable(),
  evidenceIds: z.array(z.string()),
  qualifiers: z.record(z.string(), z.string()),
});

export const McpEvidence = z.object({
  id,
  kind: z.string(),
  title: z.string(),
  untrusted: Untrusted,
  url: z.string().nullable(),
  provenance: z.string(),
  sourceReference: z.string().nullable(),
});

export const McpVideo = z.object({
  id,
  title: z.string(),
  description: z.string(),
  untrusted: Untrusted,
  offeringId: z.string().nullable(),
  offeringName: z.string().nullable(),
  durationSeconds: z.number().nullable(),
  playbackUrl: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  pageUrl: z.string().nullable(),
});

const notice = z.string().describe('How to treat this data.');

// -------------------------------------------------------------------- tools

export const McpTools = {
  search_technologies: {
    input: z.object({
      query: z
        .string()
        .max(200)
        .optional()
        .describe('Technology name or alias, e.g. "Orin", "SOME/IP", "ISO 26262".'),
      facet: z
        .string()
        .max(60)
        .optional()
        .describe('Restrict to a facet such as "operating-system" or "functional-safety".'),
      limit: limit(25, 10),
    }),
    output: z.object({
      items: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          facet: z.string(),
          description: z.string(),
          aliases: z.array(z.string()),
          broader: z.array(z.string()),
          narrower: z.array(z.string()),
          related: z.array(z.string()),
          publishedOfferingCount: z.number().int(),
        }),
      ),
    }),
  },
  search_offerings: {
    input: z.object({
      query: z.string().max(500).optional().describe('Keywords or a short description.'),
      concept_ids: z
        .array(conceptId)
        .max(20)
        .optional()
        .describe('Hard filter: offerings must have a published claim on each concept (or a narrower one).'),
      types: z.array(z.enum(OFFERING_TYPES)).optional(),
      minimum_maturity: z.enum(MATURITY_LEVELS).optional(),
      limit: limit(20, 8),
      cursor,
    }),
    output: z.object({
      items: z.array(McpOffering.extend({ matchedConcepts: z.array(z.string()) })),
      nextCursor: z.string().nullable(),
      degraded: z.array(z.string()),
      notice,
    }),
  },
  search_suppliers: {
    input: z.object({
      query: z.string().max(200).optional(),
      concept_ids: z.array(conceptId).max(20).optional(),
      limit: limit(20, 8),
      cursor,
    }),
    output: z.object({
      items: z.array(
        z.object({
          id,
          name: z.string(),
          verificationState: z.string(),
          summary: z.string(),
          untrusted: Untrusted,
          country: z.string().nullable(),
          url: z.string(),
          isDemo: z.boolean(),
        }),
      ),
      nextCursor: z.string().nullable(),
      notice,
    }),
  },
  analyze_requirement: {
    input: z.object({ text: z.string().min(3).max(4000), confidential_terms: confidentialTerms }),
    output: z.object({ interpretation: McpInterpretation }),
  },
  validate_requirement: {
    input: z.object({
      description: z.string().min(3).max(8000),
      title: z.string().max(200).optional(),
      constraints: z.array(McpConstraintInput).max(40).optional(),
      confidential_terms: confidentialTerms,
    }),
    output: z.object({
      valid: z.boolean(),
      issues: z.array(z.object({ severity: z.string(), code: z.string(), message: z.string() })),
      constraints: z.array(McpConstraint),
      unknownTerms: z.array(z.string()),
    }),
  },
  find_matching_offerings: {
    input: z.object({
      ...requirementSource,
      require_all_hard_met: z.boolean().default(false),
      limit: limit(10, 5),
      cursor,
    }),
    output: z.object({
      interpretation: McpInterpretation,
      matches: z.array(McpMatch),
      nextCursor: z.string().nullable(),
      totalCandidatesEvaluated: z.number().int(),
      degraded: z.array(z.string()),
      notice,
    }),
  },
  search_matching_suppliers: {
    input: z.object({ ...requirementSource, limit: limit(10, 5) }),
    output: z.object({
      interpretation: McpInterpretation,
      suppliers: z.array(
        z.object({
          supplier: z.object({
            id,
            name: z.string(),
            verificationState: z.string(),
            url: z.string(),
            isDemo: z.boolean(),
          }),
          bestMatch: McpMatch,
          otherOfferingIds: z.array(z.string()),
        }),
      ),
      notice,
    }),
  },
  get_offering: {
    input: z.object({ offering_id: z.uuid() }),
    output: z.object({
      offering: McpOffering.extend({
        description: z.string(),
        regions: z.array(z.string()),
        commercial: z.record(z.string(), z.unknown()),
      }),
      claims: z.array(McpClaim),
      organizationClaims: z.array(McpClaim),
      evidence: z.array(McpEvidence),
      videos: z.array(McpVideo),
      notice,
    }),
  },
  get_supplier: {
    input: z.object({ supplier: z.string().min(1).max(120).describe('Supplier id or slug.') }),
    output: z.object({
      supplier: z.object({
        id,
        name: z.string(),
        slug: z.string(),
        verificationState: z.string(),
        summary: z.string(),
        untrusted: Untrusted,
        country: z.string().nullable(),
        regions: z.array(z.string()),
        website: z.string().nullable(),
        url: z.string(),
        isDemo: z.boolean(),
      }),
      offerings: z.array(McpOffering),
      capabilities: z.array(z.object({ name: z.string(), concept: z.string() })),
      organizationClaims: z.array(McpClaim),
      notice,
    }),
  },
  get_evidence: {
    input: z.object({
      offering_id: z.uuid().optional(),
      claim_id: z.uuid().optional(),
      evidence_id: z.uuid().optional(),
    }),
    output: z.object({ claims: z.array(McpClaim), evidence: z.array(McpEvidence), notice }),
  },
  get_demo: {
    input: z.object({
      offering_id: z.uuid().optional(),
      query: z
        .string()
        .max(500)
        .optional()
        .describe('Capability description, e.g. "automatic analysis of integration logs".'),
      limit: limit(10, 5),
    }),
    output: z.object({ videos: z.array(McpVideo), notice }),
  },
  compare_offerings: {
    input: z.object({
      offering_ids: z.array(z.uuid()).min(2).max(5),
      text: z.string().max(4000).optional(),
      constraints: z.array(McpConstraintInput).max(40).optional(),
    }),
    output: z.object({
      offerings: z.array(McpOffering),
      rows: z.array(
        z.object({
          constraintId: z.string(),
          description: z.string(),
          priority: z.string(),
          cells: z.array(
            z.object({ offeringId: z.string(), status: z.string(), basis: z.string().nullable() }),
          ),
        }),
      ),
      matches: z.array(McpMatch),
      notice,
    }),
  },
  explain_match: {
    input: z.object({ offering_id: z.uuid(), ...requirementSource }),
    output: z.object({ interpretation: McpInterpretation, match: McpMatch, notice }),
  },
  create_requirement_draft: {
    input: z.object({
      title: z.string().min(3).max(200),
      description: z.string().min(10).max(8000),
      constraints: z.array(McpConstraintInput).max(40).optional(),
      confidential_terms: confidentialTerms,
      organization_id: z.uuid().optional(),
    }),
    output: z.object({
      requirement: z.object({
        id,
        organizationId: z.string(),
        title: z.string(),
        visibility: z.string(),
        status: z.string(),
        confidentialTermCount: z.number().int(),
        url: z.string(),
      }),
      constraints: z.array(McpConstraint),
      issues: z.array(z.object({ severity: z.string(), code: z.string(), message: z.string() })),
    }),
  },
  prepare_engagement_request: {
    input: z.object({
      offering_id: z.uuid(),
      type: z.enum(ENGAGEMENT_TYPES),
      message: z.string().min(10).max(3000),
      contact_name: z.string().min(2).max(120),
      contact_email: z.email(),
      requirement_id: z.uuid().optional(),
      disclosed_summary: z.string().max(2000).optional(),
      organization_id: z.uuid().optional(),
    }),
    output: z.object({
      preview: z.record(z.string(), z.unknown()),
      confirmationToken: z.string(),
      expiresAt: z.string(),
      requiresHumanConfirmation: z.literal(true),
      instructions: z.string(),
    }),
  },
  confirm_engagement_request: {
    input: z.object({
      offering_id: z.uuid(),
      type: z.enum(ENGAGEMENT_TYPES),
      message: z.string().min(10).max(3000),
      contact_name: z.string().min(2).max(120),
      contact_email: z.email(),
      requirement_id: z.uuid().optional(),
      disclosed_summary: z.string().max(2000).optional(),
      organization_id: z.uuid().optional(),
      confirmation_token: z.string().min(20).max(4000),
      idempotency_key: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
      user_confirmed: z
        .literal(true)
        .describe('Set to true ONLY after the human user explicitly approved this exact preview.'),
    }),
    output: z.object({ engagementId: z.string(), status: z.string(), replayed: z.boolean() }),
  },
} as const;

export type McpToolName = keyof typeof McpTools;
