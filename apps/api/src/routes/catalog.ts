import type { Application } from '@atx/application';
import {
  CompareRequest,
  CompareResponse,
  DemoResponse,
  EvidenceResponse,
  ExplainRequest,
  Interpretation,
  Limit,
  Match,
  MatchRequest,
  MatchResponse,
  OfferingDetail,
  OfferingSearchRequest,
  OfferingSearchResponse,
  RequirementValidation,
  SupplierSearchResponse,
  SupplierView,
  Technology,
  Uuid,
  toDomainConstraints,
} from '@atx/contracts';
import { notFound, validationError } from '@atx/domain';
import { z } from 'zod';
import { type AnyRouteSpec, defineRoute } from '../http/route';

const conceptList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) =>
    value === undefined
      ? []
      : (Array.isArray(value) ? value : value.split(',')).map((v) => v.trim()).filter(Boolean),
  );

export const catalogRoutes = (app: Application): AnyRouteSpec[] => [
  defineRoute({
    method: 'GET',
    url: '/v1/technologies',
    operationId: 'searchTechnologies',
    summary: 'Search the automotive technology ontology',
    tags: ['catalog'],
    auth: 'none',
    query: z.object({
      query: z.string().max(200).optional(),
      facet: z.string().max(60).optional(),
      limit: Limit,
    }),
    response: z.object({ items: z.array(Technology) }),
    handler: async ({ query, ctx }) => ({ items: await app.catalog.searchTechnologies(ctx, query) }),
  }),
  defineRoute({
    method: 'GET',
    url: '/v1/ontology',
    operationId: 'getOntology',
    summary: 'List ontology facets and active concepts',
    tags: ['catalog'],
    auth: 'none',
    response: z.object({
      facets: z.array(z.object({ id: z.string(), label: z.string(), description: z.string() })),
      concepts: z.array(
        z.object({ id: z.string(), facetId: z.string(), label: z.string(), aliases: z.array(z.string()) }),
      ),
    }),
    handler: async () => app.catalog.getOntology(),
  }),
  defineRoute({
    method: 'POST',
    url: '/v1/offerings/search',
    operationId: 'searchOfferings',
    summary: 'Keyword/semantic offering search with structured filters',
    tags: ['catalog'],
    auth: 'optional',
    body: OfferingSearchRequest,
    response: OfferingSearchResponse,
    handler: async ({ body, ctx }) => app.catalog.searchOfferings(ctx, body),
  }),
  defineRoute({
    method: 'GET',
    url: '/v1/offerings/:offeringId',
    operationId: 'getOffering',
    summary: 'Offering detail with claims, provenance, evidence and videos',
    tags: ['catalog'],
    auth: 'optional',
    params: z.object({ offeringId: Uuid }),
    response: OfferingDetail,
    handler: async ({ params, ctx }) => app.catalog.getOffering(ctx, { id: params.offeringId }),
  }),
  defineRoute({
    method: 'GET',
    url: '/v1/suppliers',
    operationId: 'searchSuppliers',
    summary: 'Search supplier organizations',
    tags: ['catalog'],
    auth: 'none',
    query: z.object({
      query: z.string().max(200).optional(),
      conceptIds: conceptList,
      limit: Limit,
      cursor: z.string().max(200).optional(),
    }),
    response: SupplierSearchResponse,
    handler: async ({ query, ctx }) => app.catalog.searchSuppliers(ctx, query),
  }),
  defineRoute({
    method: 'GET',
    url: '/v1/suppliers/:supplier',
    operationId: 'getSupplier',
    summary: 'Supplier profile by id or slug',
    tags: ['catalog'],
    auth: 'none',
    params: z.object({ supplier: z.string().min(1).max(120) }),
    response: SupplierView,
    handler: async ({ params, ctx }) => app.catalog.getSupplier(ctx, params.supplier),
  }),
  defineRoute({
    method: 'GET',
    url: '/v1/evidence',
    operationId: 'getEvidence',
    summary: 'Evidence and provenance for an offering, claim or evidence item',
    tags: ['catalog'],
    auth: 'none',
    query: z.object({ offeringId: Uuid.optional(), claimId: Uuid.optional(), evidenceId: Uuid.optional() }),
    response: EvidenceResponse,
    handler: async ({ query, ctx }) => app.catalog.getEvidence(ctx, query),
  }),
  defineRoute({
    method: 'GET',
    url: '/v1/demos',
    operationId: 'getDemos',
    summary: 'Technical demo videos by offering or capability query',
    tags: ['catalog'],
    auth: 'none',
    query: z.object({ offeringId: Uuid.optional(), query: z.string().max(500).optional(), limit: Limit }),
    response: DemoResponse,
    handler: async ({ query, ctx }) => app.catalog.getDemos(ctx, query),
  }),
  defineRoute({
    method: 'POST',
    url: '/v1/matches',
    operationId: 'findMatches',
    summary: 'Hybrid matching of a technical requirement against published offerings',
    tags: ['matching'],
    auth: 'optional',
    body: MatchRequest,
    response: MatchResponse,
    handler: async ({ body, ctx }) =>
      app.matching.findMatches(ctx, {
        text: body.text ?? null,
        constraints: toDomainConstraints(body.constraints) ?? null,
        requirement: body.requirementId
          ? { organizationId: requireOrg(body.organizationId), requirementId: body.requirementId }
          : null,
        confidentialTerms: body.confidentialTerms ?? [],
        requireAllHardConstraintsMet: body.requireAllHardConstraintsMet,
        limit: body.limit,
        cursor: body.cursor ?? null,
      }),
  }),
  defineRoute({
    method: 'POST',
    url: '/v1/matches/compare',
    operationId: 'compareOfferings',
    summary: 'Side-by-side comparison of 2-5 offerings',
    tags: ['matching'],
    auth: 'optional',
    body: CompareRequest,
    response: CompareResponse,
    handler: async ({ body, ctx }) =>
      app.matching.compare(ctx, {
        offeringIds: body.offeringIds,
        text: body.text ?? null,
        constraints: toDomainConstraints(body.constraints) ?? null,
      }),
  }),
  defineRoute({
    method: 'POST',
    url: '/v1/matches/explain',
    operationId: 'explainMatch',
    summary: 'Detailed explanation of how one offering matches a requirement',
    tags: ['matching'],
    auth: 'optional',
    body: ExplainRequest,
    response: Match,
    handler: async ({ body, ctx }) => {
      const result = await app.matching.findMatches(ctx, {
        text: body.text ?? null,
        constraints: toDomainConstraints(body.constraints) ?? null,
        requirement: body.requirementId
          ? { organizationId: requireOrg(body.organizationId), requirementId: body.requirementId }
          : null,
        offeringIds: [body.offeringId],
        limit: 1,
      });
      const match = result.matches[0];
      if (!match) throw notFound('Offering');
      return match;
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/v1/requirements/interpret',
    operationId: 'interpretRequirement',
    summary:
      'Interpret requirement text into hard constraints, preferences and unknown terms (nothing is stored)',
    tags: ['matching'],
    auth: 'optional',
    body: z.object({
      text: z.string().min(3).max(4000),
      confidentialTerms: z.array(z.string().max(120)).max(30).optional(),
    }),
    response: Interpretation,
    handler: async ({ body, ctx }) => app.matching.interpret(ctx, body.text, body.confidentialTerms ?? []),
  }),
  defineRoute({
    method: 'POST',
    url: '/v1/requirements/validate',
    operationId: 'validateRequirement',
    summary: 'Validate a requirement draft (nothing is stored)',
    tags: ['matching'],
    auth: 'optional',
    body: z.object({
      title: z.string().max(200).default(''),
      description: z.string().min(3).max(8000),
      constraints: MatchRequest.shape.constraints,
      confidentialTerms: z.array(z.string().max(120)).max(30).optional(),
    }),
    response: RequirementValidation,
    handler: async ({ body, ctx }) =>
      app.requirements.validate(ctx, { ...body, constraints: toDomainConstraints(body.constraints) ?? null }),
  }),
];

const requireOrg = (organizationId: string | undefined): string => {
  if (!organizationId) throw validationError('organizationId is required together with requirementId');
  return organizationId;
};
