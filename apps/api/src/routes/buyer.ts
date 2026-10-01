import type { Application } from '@atx/application';
import {
  Engagement,
  EngagementConfirmInput,
  EngagementDraftInput,
  EngagementPreview,
  RequirementCreate,
  RequirementUpdate,
  RequirementView,
  Uuid,
  ValidationIssue,
  toDomainConstraints,
} from '@atx/contracts';
import { z } from 'zod';
import { type AnyRouteSpec, defineRoute } from '../http/route';

const org = z.object({ orgId: Uuid });
const orgReq = z.object({ orgId: Uuid, requirementId: Uuid });

const engagementView = (e: Awaited<ReturnType<Application['engagements']['listForBuyer']>>[number]) => ({
  id: e.id,
  type: e.type,
  status: e.status,
  buyerOrganizationId: e.buyerOrganizationId,
  supplierOrganizationId: e.supplierOrganizationId,
  offeringId: e.offeringId,
  disclosure: e.disclosure,
  createdAt: e.createdAt.toISOString(),
});

/** Buyer requirements (tenant-private) and engagement requests (explicitly confirmed). */
export const buyerRoutes = (app: Application): AnyRouteSpec[] => [
  defineRoute({
    method: 'GET',
    url: '/v1/organizations/:orgId/requirements',
    operationId: 'listRequirements',
    summary: "List the organization's private requirements (audited)",
    tags: ['requirements'],
    auth: 'required',
    params: org,
    response: z.object({ items: z.array(RequirementView) }),
    handler: async ({ params, ctx }) => ({ items: await app.requirements.list(ctx, params.orgId) }),
  }),
  defineRoute({
    method: 'POST',
    url: '/v1/organizations/:orgId/requirements',
    operationId: 'createRequirement',
    summary: 'Create a private requirement draft',
    tags: ['requirements'],
    auth: 'required',
    params: org,
    body: RequirementCreate,
    response: z.object({ requirement: RequirementView, issues: z.array(ValidationIssue) }),
    status: 201,
    handler: async ({ params, body, ctx }) =>
      app.requirements.createDraft(ctx, params.orgId, {
        ...body,
        constraints: toDomainConstraints(body.constraints) ?? null,
      }),
  }),
  defineRoute({
    method: 'GET',
    url: '/v1/organizations/:orgId/requirements/:requirementId',
    operationId: 'getRequirement',
    summary: 'Read a private requirement (audited)',
    tags: ['requirements'],
    auth: 'required',
    params: orgReq,
    response: z.object({ requirement: RequirementView, confidentialTerms: z.array(z.string()) }),
    handler: async ({ params, ctx }) => app.requirements.get(ctx, params.orgId, params.requirementId),
  }),
  defineRoute({
    method: 'PATCH',
    url: '/v1/organizations/:orgId/requirements/:requirementId',
    operationId: 'updateRequirement',
    summary: 'Update a private requirement (optimistic concurrency)',
    tags: ['requirements'],
    auth: 'required',
    params: orgReq,
    body: RequirementUpdate,
    response: RequirementView,
    handler: async ({ params, body, ctx }) =>
      app.requirements.update(ctx, params.orgId, params.requirementId, {
        ...body,
        constraints: toDomainConstraints(body.constraints),
      }),
  }),
  defineRoute({
    method: 'POST',
    url: '/v1/organizations/:orgId/requirements/:requirementId/publication/prepare',
    operationId: 'preparePublication',
    summary: 'Preview an anonymized demand-signal publication and obtain a confirmation token',
    tags: ['requirements'],
    auth: 'required',
    params: orgReq,
    response: z.object({
      disclosure: z.record(z.string(), z.unknown()),
      confirmationToken: z.string(),
      expiresAt: z.string(),
    }),
    handler: async ({ params, ctx }) =>
      app.requirements.preparePublication(ctx, params.orgId, params.requirementId),
  }),
  defineRoute({
    method: 'POST',
    url: '/v1/organizations/:orgId/requirements/:requirementId/publication/confirm',
    operationId: 'confirmPublication',
    summary: 'Publish the anonymized demand signal after explicit confirmation',
    tags: ['requirements'],
    auth: 'required',
    params: orgReq,
    body: z.object({ confirmationToken: z.string().min(20).max(4000) }),
    response: z.object({ published: z.boolean(), disclosure: z.record(z.string(), z.unknown()) }),
    handler: async ({ params, body, ctx }) =>
      app.requirements.confirmPublication(ctx, params.orgId, params.requirementId, body.confirmationToken),
  }),
  defineRoute({
    method: 'POST',
    url: '/v1/engagements/prepare',
    operationId: 'prepareEngagement',
    summary: 'Preview exactly what a demo/workshop/PoC/RFI request would share; returns a confirmation token',
    tags: ['engagements'],
    auth: 'required',
    body: EngagementDraftInput,
    response: EngagementPreview,
    handler: async ({ body, ctx }) => app.engagements.prepare(ctx, body),
  }),
  defineRoute({
    method: 'POST',
    url: '/v1/engagements',
    operationId: 'confirmEngagement',
    summary: 'Submit a confirmed engagement request (idempotent on idempotencyKey)',
    tags: ['engagements'],
    auth: 'required',
    body: EngagementConfirmInput,
    response: z.object({ engagement: Engagement, replayed: z.boolean() }),
    status: 201,
    handler: async ({ body, ctx }) => {
      const { confirmationToken, idempotencyKey, ...draft } = body;
      const result = await app.engagements.confirm(ctx, draft, confirmationToken, idempotencyKey);
      return { engagement: engagementView(result.engagement), replayed: result.replayed };
    },
  }),
  defineRoute({
    method: 'GET',
    url: '/v1/organizations/:orgId/engagements',
    operationId: 'listEngagements',
    summary: 'Incoming (supplier) or outgoing (buyer) engagement requests',
    tags: ['engagements'],
    auth: 'required',
    params: org,
    query: z.object({ direction: z.enum(['incoming', 'outgoing']).default('incoming') }),
    response: z.object({ items: z.array(Engagement) }),
    handler: async ({ params, query, ctx }) => {
      const items =
        query.direction === 'incoming'
          ? await app.engagements.listForSupplier(ctx, params.orgId)
          : await app.engagements.listForBuyer(ctx, params.orgId);
      return { items: items.map(engagementView) };
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/v1/organizations/:orgId/engagements/:engagementId/respond',
    operationId: 'respondToEngagement',
    summary: 'Supplier acknowledges, declines or closes an incoming request',
    tags: ['engagements'],
    auth: 'required',
    params: z.object({ orgId: Uuid, engagementId: Uuid }),
    body: z.object({ status: z.enum(['acknowledged', 'declined', 'closed']) }),
    response: Engagement,
    handler: async ({ params, body, ctx }) =>
      engagementView(await app.engagements.respond(ctx, params.orgId, params.engagementId, body.status)),
  }),
];
