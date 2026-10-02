import type { ClaimView, EvidenceView } from '@atx/application';
import type { McpWorkspaceAsset, McpWorkspaceClaim, McpWorkspaceOffering } from '@atx/contracts';
import { type Asset, type Offering, slugify, validationError } from '@atx/domain';
import type { z } from 'zod';
import * as present from '../presenters';
import type { Links } from '../presenters';
import type { ToolDefinition } from './define';
import { resolveOrganization } from './discovery';

/**
 * Supplier workspace tools: thin adapters over SupplierService. Everything an
 * agent creates is a private DRAFT; making it public is a separate,
 * human-confirmed step (prepare_publication -> confirm_publication).
 */

const SUPPLIER_SCOPES = () => ['supplier:write'];

const WRITE = {
  readOnlyHint: false,
  idempotentHint: false,
  openWorldHint: false,
  destructiveHint: false,
} as const;

const workspaceClaim = (view: ClaimView): z.infer<typeof McpWorkspaceClaim> => ({
  id: view.id,
  subject: { type: view.subject.type, id: view.subject.id },
  concept: { id: view.concept.id, label: view.concept.label },
  predicate: view.predicate,
  predicateLabel: view.predicateLabel,
  statement: view.statement,
  untrusted: true,
  qualifiers: { ...view.qualifiers },
  qualifierText: [...view.qualifierText],
  status: view.status,
  provenance: view.provenance.category,
  aiDrafted: view.provenance.category === 'AI_INFERRED',
  evidenceIds: [...view.provenance.evidenceIds],
  contentWarnings: [...view.contentWarnings],
  version: view.version,
});

const workspaceOffering = (offering: Offering, links: Links): z.infer<typeof McpWorkspaceOffering> => ({
  id: offering.id,
  slug: offering.slug,
  name: offering.name,
  type: offering.type,
  maturity: offering.maturity,
  status: offering.status,
  version: offering.version,
  url: offering.status === 'published' ? links.offering(offering.id) : links.workspace(),
});

const workspaceAsset = (asset: Asset): z.infer<typeof McpWorkspaceAsset> => ({
  id: asset.id,
  title: asset.title,
  kind: asset.kind,
  offeringId: asset.offeringId,
  processingState: asset.processingState,
  extractionState: asset.extractionState,
  failureReason: asset.failureReason,
});

const workspaceEvidence = (view: EvidenceView) => ({
  ...present.evidence(view),
  offeringId: view.offeringId,
});

export const supplierTools = [
  {
    name: 'get_supplier_workspace',
    title: 'Show my supplier workspace',
    description:
      "List the caller's own supplier workspace: offerings (draft and published), claims (including AI-drafted claims awaiting review), evidence and uploaded documents with their processing state. " +
      'Requires the supplier:write scope.',
    annotations: { ...WRITE, readOnlyHint: true, idempotentHint: true },
    requiredScopes: SUPPLIER_SCOPES,
    run: async (args, env) => {
      const organizationId = resolveOrganization(env, args.organization_id);
      const workspace = await env.runtime.app.supplier.listWorkspace(env.ctx, organizationId);
      const claims = workspace.claims.map(workspaceClaim);
      const drafts = claims.filter((claim) => claim.status === 'draft');
      const aiDrafts = drafts.filter((claim) => claim.aiDrafted);
      const processing = workspace.assets.filter(
        (asset) => !['ready', 'failed', 'quarantined'].includes(asset.processingState),
      );
      const draftOfferings = workspace.offerings.filter((offering) => offering.status === 'draft');
      const nextSteps = [
        ...(processing.length > 0
          ? [`${processing.length} upload(s) still processing; check again in a minute.`]
          : []),
        ...(aiDrafts.length > 0
          ? [
              `${aiDrafts.length} AI-drafted claim(s) need human review: check concept, predicate strength and wording against the source document before publishing.`,
            ]
          : []),
        ...(drafts.length > 0 || draftOfferings.length > 0
          ? [
              'Publish reviewed drafts with prepare_publication, show the preview to the user and call confirm_publication only after explicit approval.',
            ]
          : []),
      ];
      return {
        structured: {
          organization: {
            id: workspace.organization.id,
            name: workspace.organization.name,
            kind: workspace.organization.kind,
            verificationState: workspace.organization.verificationState,
          },
          offerings: workspace.offerings.map((offering) => workspaceOffering(offering, env.links)),
          claims,
          evidence: workspace.evidence.map(workspaceEvidence),
          assets: workspace.assets.map(workspaceAsset),
          nextSteps,
        },
        text: [
          `${workspace.organization.name} (${workspace.organization.verificationState}): ${workspace.offerings.length} offering(s), ${claims.length} claim(s) (${drafts.length} draft, ${aiDrafts.length} AI-drafted), ${workspace.evidence.length} evidence item(s), ${workspace.assets.length} upload(s).`,
          ...nextSteps.map((step) => `- ${step}`),
        ].join('\n'),
      };
    },
  } satisfies ToolDefinition<'get_supplier_workspace'>,
  {
    name: 'create_offering',
    title: 'Create a draft offering',
    description:
      'Create a PRIVATE draft offering (product, service or technology platform) in your supplier workspace. ' +
      'It becomes public only through prepare_publication/confirm_publication with the user approval. Requires supplier:write.',
    annotations: WRITE,
    requiredScopes: SUPPLIER_SCOPES,
    run: async (args, env) => {
      const organizationId = resolveOrganization(env, args.organization_id);
      const slug = args.slug ?? slugify(args.name);
      if (!slug) throw validationError('Provide a slug (lowercase letters, digits and dashes)');
      const details =
        args.type === 'service'
          ? { type: 'service' as const, deliveryModel: args.delivery_model ?? null, engagementModels: [] }
          : {
              type: args.type,
              currentVersion: args.current_version ?? null,
              licensingModel: args.licensing_model ?? null,
              deploymentModels: args.deployment_models ?? [],
            };
      const offering = await env.runtime.app.supplier.createOffering(env.ctx, organizationId, {
        slug,
        type: args.type,
        name: args.name,
        summary: args.summary,
        description: args.description,
        maturity: args.maturity,
        details,
        commercial: { pricingModel: null, availability: [], notes: null },
        regions: args.regions ?? [],
      });
      return {
        structured: {
          offering: workspaceOffering(offering, env.links),
          nextSteps: [
            'Add technical claims with add_claim (concept ids from search_technologies), or upload a datasheet with upload_document to get AI-drafted claims for review.',
          ],
        },
        text: `Created draft offering "${offering.name}" (${offering.id}). It is not public yet.`,
      };
    },
  } satisfies ToolDefinition<'create_offering'>,
  {
    name: 'add_claim',
    title: 'Add a draft technical claim',
    description:
      'Add a DRAFT technical claim (subject + predicate + ontology concept) about one of your offerings or your organization. ' +
      'Choose the weakest predicate that is literally true: "designed for ASIL-B" is DESIGNED_FOR with asil B, not CERTIFIED. Requires supplier:write.',
    annotations: WRITE,
    requiredScopes: SUPPLIER_SCOPES,
    run: async (args, env) => {
      const organizationId = resolveOrganization(env, args.organization_id);
      let subjectId = organizationId;
      if (args.subject_type === 'offering') {
        if (!args.subject_id) throw validationError('subject_id (the offering id) is required');
        subjectId = args.subject_id;
      }
      const view = await env.runtime.app.supplier.addClaim(env.ctx, organizationId, {
        subject: { type: args.subject_type, id: subjectId },
        predicate: args.predicate,
        conceptId: args.concept_id,
        qualifiers: { ...args.qualifiers, ...(args.asil ? { asil: args.asil } : {}) },
        statement: args.statement,
        sourceUrl: args.source_url ?? null,
        evidenceIds: args.evidence_ids ?? [],
      });
      return {
        structured: {
          claim: workspaceClaim(view),
          nextSteps: ['The claim is a private draft. Publish it with prepare_publication after user review.'],
        },
        text: `Draft claim ${view.id}: ${view.predicateLabel} ${view.concept.label}.`,
      };
    },
  } satisfies ToolDefinition<'add_claim'>,
  {
    name: 'add_evidence',
    title: 'Add evidence',
    description:
      'Register supporting evidence (certificate, case study, public documentation URL, production reference) that claims can link to via evidence_ids. ' +
      'Nothing is fetched from the URL. Requires supplier:write.',
    annotations: WRITE,
    requiredScopes: SUPPLIER_SCOPES,
    run: async (args, env) => {
      const organizationId = resolveOrganization(env, args.organization_id);
      const view = await env.runtime.app.evidence.addEvidence(env.ctx, organizationId, {
        offeringId: args.offering_id ?? null,
        kind: args.kind,
        title: args.title,
        description: args.description,
        url: args.url ?? null,
        sourceReference: args.source_reference ?? null,
        customerDisclosure: args.customer_disclosure ?? null,
      });
      return {
        structured: { evidence: workspaceEvidence(view) },
        text: `Added ${view.kind} evidence ${view.id} "${view.title}".`,
      };
    },
  } satisfies ToolDefinition<'add_evidence'>,
  {
    name: 'update_offering',
    title: 'Edit a draft offering',
    description:
      'Edit name, summary, description, maturity or regions of one of your DRAFT offerings (pass expected_version from get_supplier_workspace). ' +
      'Published offerings are changed by a person on the ATX website. Requires supplier:write.',
    annotations: { ...WRITE, idempotentHint: true },
    requiredScopes: SUPPLIER_SCOPES,
    run: async (args, env) => {
      const organizationId = resolveOrganization(env, args.organization_id);
      const offering = await env.runtime.app.supplier.updateOffering(
        env.ctx,
        organizationId,
        args.offering_id,
        {
          expectedVersion: args.expected_version,
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...(args.summary !== undefined ? { summary: args.summary } : {}),
          ...(args.description !== undefined ? { description: args.description } : {}),
          ...(args.maturity !== undefined ? { maturity: args.maturity } : {}),
          ...(args.regions !== undefined ? { regions: args.regions } : {}),
        },
      );
      return {
        structured: { offering: workspaceOffering(offering, env.links) },
        text: `Updated draft offering "${offering.name}" (version ${offering.version}).`,
      };
    },
  } satisfies ToolDefinition<'update_offering'>,
  {
    name: 'revise_claim',
    title: 'Correct a draft claim',
    description:
      'Correct the predicate, statement, qualifiers or evidence of a DRAFT claim (e.g. an AI-drafted claim that overstates the source). ' +
      'Published claims cannot be edited by agents: retract them and publish a corrected draft with approval. Requires supplier:write.',
    annotations: { ...WRITE, idempotentHint: true },
    requiredScopes: SUPPLIER_SCOPES,
    run: async (args, env) => {
      const organizationId = resolveOrganization(env, args.organization_id);
      const view = await env.runtime.app.supplier.reviseClaim(env.ctx, organizationId, args.claim_id, {
        expectedVersion: args.expected_version,
        ...(args.predicate !== undefined ? { predicate: args.predicate } : {}),
        ...(args.statement !== undefined ? { statement: args.statement } : {}),
        ...(args.qualifiers !== undefined ? { qualifiers: args.qualifiers } : {}),
        ...(args.evidence_ids !== undefined ? { evidenceIds: args.evidence_ids } : {}),
      });
      return {
        structured: { claim: workspaceClaim(view) },
        text: `Revised draft claim ${view.id}: ${view.predicateLabel} ${view.concept.label}.`,
      };
    },
  } satisfies ToolDefinition<'revise_claim'>,
  {
    name: 'retract_claim',
    title: 'Retract a claim',
    description:
      'Withdraw a draft or published claim (e.g. a wrong AI draft, or a published statement that is no longer true). ' +
      'Retracted claims are no longer shown to buyers or used in matching. Requires supplier:write.',
    annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
    requiredScopes: SUPPLIER_SCOPES,
    run: async (args, env) => {
      const organizationId = resolveOrganization(env, args.organization_id);
      const view = await env.runtime.app.supplier.retractClaim(
        env.ctx,
        organizationId,
        args.claim_id,
        args.expected_version,
      );
      return {
        structured: { claim: workspaceClaim(view) },
        text: `Retracted claim ${view.id} (${view.predicateLabel} ${view.concept.label}).`,
      };
    },
  } satisfies ToolDefinition<'retract_claim'>,
  {
    name: 'register_demo_video',
    title: 'Register a demo video',
    description:
      'Link an externally hosted technical demo video (https) to one of your offerings. The URL is validated but never fetched by the server. Requires supplier:write.',
    annotations: WRITE,
    requiredScopes: SUPPLIER_SCOPES,
    run: async (args, env) => {
      const organizationId = resolveOrganization(env, args.organization_id);
      const asset = await env.runtime.app.evidence.registerExternalVideo(env.ctx, organizationId, {
        offeringId: args.offering_id,
        title: args.title,
        description: args.description,
        url: args.url,
        durationSeconds: args.duration_seconds ?? null,
      });
      return {
        structured: {
          video: {
            id: asset.id,
            title: asset.title,
            offeringId: args.offering_id,
            url: asset.externalUrl ?? args.url,
          },
        },
        text: `Registered demo video ${asset.id} "${asset.title}".`,
      };
    },
  } satisfies ToolDefinition<'register_demo_video'>,
  {
    name: 'upload_document',
    title: 'Upload a document',
    description:
      'Upload a datasheet, whitepaper, manual or transcript (PDF as base64, or text/Markdown/HTML/VTT as text, max ~8 MB). ' +
      'It is scanned and processed asynchronously; AI then proposes DRAFT claims (provenance AI_INFERRED) that a human must review before publication. ' +
      'Requires supplier:write.',
    annotations: WRITE,
    requiredScopes: SUPPLIER_SCOPES,
    run: async (args, env) => {
      const organizationId = resolveOrganization(env, args.organization_id);
      if ((args.content_base64 === undefined) === (args.content_text === undefined))
        throw validationError('Provide exactly one of content_base64 or content_text');
      if (args.content_type === 'application/pdf' && args.content_text !== undefined)
        throw validationError('PDF files must be sent as content_base64');
      if (args.content_base64 !== undefined && !/^[A-Za-z0-9+/]*={0,2}$/.test(args.content_base64))
        throw validationError('content_base64 is not valid base64');
      const bytes =
        args.content_base64 !== undefined
          ? new Uint8Array(Buffer.from(args.content_base64, 'base64'))
          : new TextEncoder().encode(args.content_text);
      const asset = await env.runtime.app.evidence.uploadAsset(env.ctx, organizationId, {
        offeringId: args.offering_id ?? null,
        kind: args.kind,
        title: args.title,
        description: args.description,
        contentType: args.content_type,
        bytes,
      });
      return {
        structured: {
          asset: workspaceAsset(asset),
          nextSteps: [
            'Processing is asynchronous (malware scan, text extraction, AI draft). Call get_supplier_workspace in a minute to review the drafted claims.',
          ],
        },
        text: `Uploaded "${asset.title}" (${asset.id}); processing has been queued.`,
      };
    },
  } satisfies ToolDefinition<'upload_document'>,
  {
    name: 'prepare_publication',
    title: 'Prepare publication of drafts',
    description:
      'Prepare (but do NOT perform) publication of reviewed draft claims and optionally a draft offering. Returns a preview of exactly what buyers will see and a short-lived confirmation token. ' +
      'Show the preview to the user and get explicit approval before calling confirm_publication. Requires supplier:write.',
    annotations: { ...WRITE, readOnlyHint: true },
    requiredScopes: SUPPLIER_SCOPES,
    run: async (args, env) => {
      const organizationId = resolveOrganization(env, args.organization_id);
      const result = await env.runtime.app.publication.prepare(env.ctx, organizationId, {
        claimIds: args.claim_ids,
        offeringId: args.offering_id ?? null,
      });
      const claims = result.claims.map(workspaceClaim);
      const warnings = [
        ...claims
          .filter((claim) => claim.aiDrafted)
          .map(
            (claim) =>
              `Claim ${claim.id} was drafted by AI; confirm "${claim.predicateLabel} ${claim.concept.label}" is literally true.`,
          ),
        ...claims
          .filter((claim) => claim.predicate === 'CERTIFIED' && claim.evidenceIds.length === 0)
          .map((claim) => `Claim ${claim.id} states a certification without linked certificate evidence.`),
        ...claims.flatMap((claim) => claim.contentWarnings.map((warning) => `Claim ${claim.id}: ${warning}`)),
      ];
      const publication = {
        claims: result.request.claims.map((claim) => ({ ...claim })),
        offering: result.request.offering ? { ...result.request.offering } : null,
      };
      return {
        structured: {
          preview: {
            claims,
            offering: result.offering ? workspaceOffering(result.offering, env.links) : null,
            warnings,
          },
          publication,
          confirmationToken: result.confirmationToken,
          expiresAt: result.expiresAt,
          requiresHumanConfirmation: true as const,
          instructions:
            'Show every claim (predicate wording, concept, statement) and the warnings to the user. Only after they explicitly approve, call confirm_publication with this `publication` object unchanged, the confirmation_token and user_confirmed=true.',
        },
        text: [
          `NOT PUBLISHED. Preview of ${claims.length} claim(s)${result.offering ? ` and offering "${result.offering.name}"` : ''} that would become public:`,
          ...claims.map(
            (claim) =>
              `- ${claim.predicateLabel} ${claim.concept.label}${claim.qualifiers['asil'] ? ` (ASIL ${claim.qualifiers['asil']})` : ''}: "${claim.statement}"${claim.aiDrafted ? ' [AI-drafted]' : ''}`,
          ),
          ...warnings.map((warning) => `! ${warning}`),
          'Ask the user to approve before confirming.',
        ].join('\n'),
      };
    },
  } satisfies ToolDefinition<'prepare_publication'>,
  {
    name: 'confirm_publication',
    title: 'Publish approved drafts',
    description:
      'Publish the drafts previewed by prepare_publication. ONLY call this after the human user explicitly approved that exact preview. ' +
      'Published claims are shown to buyers as supplier statements (never as platform-verified). Requires supplier:write.',
    annotations: { ...WRITE, openWorldHint: true },
    requiredScopes: SUPPLIER_SCOPES,
    run: async (args, env) => {
      const organizationId = resolveOrganization(env, args.organization_id);
      const result = await env.runtime.app.publication.confirm(
        env.ctx,
        organizationId,
        args.publication,
        args.confirmation_token,
      );
      const offering = result.offering ? workspaceOffering(result.offering, env.links) : null;
      return {
        structured: {
          publishedClaimIds: result.claims.map((claim) => claim.id),
          alreadyPublished: result.alreadyPublished,
          listed: result.listed,
          offering,
          notice:
            'Published content is shown as "stated by supplier". Platform verification is a separate review of linked evidence by the platform team.',
        },
        text:
          `Published ${result.claims.length} claim(s)` +
          (result.alreadyPublished > 0 ? ` (${result.alreadyPublished} already published earlier)` : '') +
          (offering ? `; offering "${offering.name}" is ${offering.status}: ${offering.url}` : '') +
          (result.listed
            ? '. Search results update within moments.'
            : '. Not visible to buyers yet: your organization must first be verified by the platform (request verification in the web workspace).'),
      };
    },
  } satisfies ToolDefinition<'confirm_publication'>,
];
