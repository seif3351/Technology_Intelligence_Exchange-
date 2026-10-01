import type { Application } from '@atx/application';
import {
  InvitationRecord,
  IssuedInvitation,
  MemberRecord,
  MemberRoleUpdate,
  OrganizationInvitationCreate,
  SecretTokenBody,
  Uuid,
} from '@atx/contracts';
import { z } from 'zod';
import { type AnyRouteSpec, defineRoute } from '../http/route';

const org = z.object({ orgId: Uuid });

/** Organization membership and invitations. Every use case authorizes the tenant and role. */
export const memberRoutes = (app: Application): AnyRouteSpec[] => [
  defineRoute({
    method: 'GET',
    url: '/v1/organizations/:orgId/members',
    operationId: 'listMembers',
    summary: 'Members of the organization and their roles',
    tags: ['members'],
    auth: 'required',
    params: org,
    response: z.object({ items: z.array(MemberRecord) }),
    handler: async ({ params, ctx }) => ({ items: await app.members.listMembers(ctx, params.orgId) }),
  }),
  defineRoute({
    method: 'PATCH',
    url: '/v1/organizations/:orgId/members/:userId',
    operationId: 'changeMemberRole',
    summary: 'Change a member role (admins; never above your own role; owners only by owners)',
    tags: ['members'],
    auth: 'required',
    params: org.extend({ userId: Uuid }),
    body: MemberRoleUpdate,
    response: MemberRecord,
    handler: async ({ params, body, ctx }) =>
      app.members.changeRole(ctx, params.orgId, params.userId, body.role),
  }),
  defineRoute({
    method: 'DELETE',
    url: '/v1/organizations/:orgId/members/:userId',
    operationId: 'removeMember',
    summary: 'Remove a member, or leave the organization yourself (the last owner cannot leave)',
    tags: ['members'],
    auth: 'required',
    params: org.extend({ userId: Uuid }),
    response: z.object({ removed: z.literal(true) }),
    handler: async ({ params, ctx }) => {
      await app.members.removeMember(ctx, params.orgId, params.userId);
      return { removed: true as const };
    },
  }),
  defineRoute({
    method: 'GET',
    url: '/v1/organizations/:orgId/invitations',
    operationId: 'listOrganizationInvitations',
    summary: 'Invitations to join the organization (admins)',
    tags: ['members'],
    auth: 'required',
    params: org,
    response: z.object({ items: z.array(InvitationRecord) }),
    handler: async ({ params, ctx }) => ({
      items: await app.invitations.listOrganizationInvitations(ctx, params.orgId),
    }),
  }),
  defineRoute({
    method: 'POST',
    url: '/v1/organizations/:orgId/invitations',
    operationId: 'inviteMember',
    summary: 'Invite a colleague by email with a role; returns the secret link once',
    tags: ['members'],
    auth: 'required',
    params: org,
    body: OrganizationInvitationCreate,
    response: IssuedInvitation,
    status: 201,
    handler: async ({ params, body, ctx }) =>
      app.invitations.createOrganizationInvitation(ctx, params.orgId, body),
  }),
  defineRoute({
    method: 'POST',
    url: '/v1/organizations/:orgId/invitations/:invitationId/revoke',
    operationId: 'revokeOrganizationInvitation',
    summary: 'Revoke a pending invitation',
    tags: ['members'],
    auth: 'required',
    params: org.extend({ invitationId: Uuid }),
    response: z.object({ revoked: z.literal(true) }),
    handler: async ({ params, ctx }) => {
      await app.invitations.revokeOrganizationInvitation(ctx, params.orgId, params.invitationId);
      return { revoked: true as const };
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/v1/invitations/accept',
    operationId: 'acceptInvitation',
    summary: 'Accept an organization invitation addressed to your email (signed-in users)',
    tags: ['members'],
    auth: 'required',
    body: SecretTokenBody,
    response: z.object({ organizationId: z.string() }),
    handler: async ({ body, ctx }) => app.invitations.acceptOrganizationInvitation(ctx, body.token),
  }),
];
