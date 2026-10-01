import { randomUUID } from 'node:crypto';
import { unauthenticated } from '@atx/domain';
import * as present from '../presenters';
import type { ToolDefinition } from './define';
import { UI, resolveOrganization, toConstraints } from './discovery';

/** Writes a PRIVATE draft inside the caller's own organization. Nothing is disclosed to suppliers. */
export const createRequirementDraftTool = {
  name: 'create_requirement_draft',
  title: 'Save a private requirement draft',
  description:
    "Save a PRIVATE requirement draft in the user's organization (never visible to suppliers). Put project names, vehicle programs and customers in confidential_terms. " +
    'Requires authentication with the requirements:write scope.',
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false, destructiveHint: false },
  uiResource: UI.requirementBuilder,
  requiredScopes: () => ['requirements:write'],
  run: async (args, env) => {
    const organizationId = resolveOrganization(env, args.organization_id);
    const result = await env.runtime.app.requirements.createDraft(env.ctx, organizationId, {
      title: args.title,
      description: args.description,
      constraints: toConstraints(args.constraints),
      confidentialTerms: args.confidential_terms,
    });
    const r = result.requirement;
    return {
      structured: {
        requirement: { id: r.id, organizationId: r.organizationId, title: r.title, visibility: r.visibility, status: r.status, confidentialTermCount: r.confidentialTermCount, url: env.links.requirement(r.id) },
        constraints: r.constraints.map(present.constraint),
        issues: result.issues.map((i) => ({ ...i })),
      },
      text: `Saved private draft ${r.id} with ${r.constraints.length} constraints (${r.confidentialTermCount} confidential terms protected). ${env.links.requirement(r.id)}`,
    };
  },
} satisfies ToolDefinition<'create_requirement_draft'>;

const ACTION = { readOnlyHint: false, idempotentHint: false, openWorldHint: true, destructiveHint: false } as const;

/**
 * Consequential actions (disclose information to a supplier). Registered only
 * when FEATURE_ENGAGEMENT_ACTIONS is enabled. Two steps: prepare returns the
 * exact disclosure; confirm requires the matching token, an idempotency key
 * and an explicit user_confirmed flag the agent may only set after the human
 * approved the preview (the MCP App form collects that approval directly).
 */
export const prepareEngagementTool = {
  name: 'prepare_engagement_request',
  title: 'Prepare a demo / workshop / PoC / RFI request',
  description:
    'Prepare (but do NOT send) a request to a supplier. Returns a preview of exactly what would be shared and a short-lived confirmation token. ' +
    'Show the preview to the user and obtain explicit approval before calling confirm_engagement_request. Requirement text and confidential terms are never shared.',
  annotations: ACTION,
  uiResource: UI.requestForm,
  requiredScopes: () => ['engagements:write'],
  run: async (args, env) => {
    if (env.ctx.principal.kind !== 'user') throw unauthenticated();
    const result = await env.runtime.app.engagements.prepare(env.ctx, {
      buyerOrganizationId: resolveOrganization(env, args.organization_id),
      offeringId: args.offering_id,
      type: args.type,
      message: args.message,
      contactName: args.contact_name,
      contactEmail: args.contact_email,
      requirementId: args.requirement_id ?? null,
      disclosedSummary: args.disclosed_summary ?? null,
    });
    const shared = result.preview.willBeShared;
    return {
      structured: {
        preview: JSON.parse(JSON.stringify(result.preview)) as Record<string, unknown>,
        confirmationToken: result.confirmationToken,
        expiresAt: result.expiresAt,
        requiresHumanConfirmation: true as const,
        instructions: `Show this preview to the user. Only after they explicitly approve, call confirm_engagement_request with the same arguments, this confirmation_token, a new idempotency_key (e.g. ${randomUUID()}) and user_confirmed=true.`,
      },
      text: [
        `NOT SENT. Preview of ${result.preview.type} request to ${result.preview.recipient.supplierName} (${result.preview.recipient.offeringName}):`,
        `- From: ${shared.buyerOrganizationName}, ${shared.contactName} <${shared.contactEmail}>`,
        `- Message: ${shared.message}`,
        `- Shared constraints: ${shared.constraints.map((c) => c.description).join('; ') || 'none'}`,
        `- Not shared: ${result.preview.willNotBeShared.join(', ')}`,
        'Ask the user to approve before confirming.',
      ].join('\n'),
    };
  },
} satisfies ToolDefinition<'prepare_engagement_request'>;

export const confirmEngagementTool = {
  name: 'confirm_engagement_request',
  title: 'Send a confirmed engagement request',
  description:
    'Send a previously prepared request to the supplier. ONLY call this after the human user explicitly approved the exact preview from prepare_engagement_request. ' +
    'Requires the confirmation token (bound to the user and the exact content), an idempotency key, and user_confirmed=true.',
  annotations: ACTION,
  requiredScopes: () => ['engagements:write'],
  run: async (args, env) => {
    const result = await env.runtime.app.engagements.confirm(
      env.ctx,
      {
        buyerOrganizationId: resolveOrganization(env, args.organization_id),
        offeringId: args.offering_id,
        type: args.type,
        message: args.message,
        contactName: args.contact_name,
        contactEmail: args.contact_email,
        requirementId: args.requirement_id ?? null,
        disclosedSummary: args.disclosed_summary ?? null,
      },
      args.confirmation_token,
      args.idempotency_key,
    );
    return {
      structured: { engagementId: result.engagement.id, status: result.engagement.status, replayed: result.replayed },
      text: result.replayed ? `Already submitted earlier (engagement ${result.engagement.id}).` : `Submitted engagement ${result.engagement.id} to the supplier.`,
    };
  },
} satisfies ToolDefinition<'confirm_engagement_request'>;
