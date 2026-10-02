import { notFound } from '@atx/domain';
import * as present from '../presenters';
import { READ_ONLY, type ToolDefinition } from './define';
import { UI, matchQuery, toConstraints } from './discovery';

export const detailTools = [
  {
    name: 'get_offering',
    title: 'Get offering details',
    description:
      'Full technical profile of one offering: technical claims with exact predicate strength, provenance (supplier-stated, public source, AI-inferred, platform-verified), evidence, demo videos and commercial metadata. Organization-level claims are listed separately.',
    annotations: READ_ONLY,
    uiResource: UI.offeringCard,
    run: async (args, env) => {
      const detail = await env.runtime.app.catalog.getOffering(env.ctx, { id: args.offering_id });
      const structured = {
        offering: {
          ...present.offering(detail, env.links),
          description: detail.description,
          regions: [...detail.regions],
          commercial: { ...detail.commercial },
        },
        claims: detail.claims.map(present.claim),
        organizationClaims: detail.organizationClaims.map(present.claim),
        evidence: detail.evidence.map(present.evidence),
        videos: detail.videos.map((v) => present.video(v, detail.name, env.links)),
        notice: present.UNTRUSTED_NOTICE,
      };
      const text = [
        `${detail.name} — ${detail.organization.name} (${detail.organization.verificationState})${detail.isDemo ? ' [DEMO DATA]' : ''}`,
        `Maturity: ${detail.maturity}. ${detail.summary}`,
        ...structured.claims.map(
          (c) =>
            `- ${c.predicate} ${c.concept.label}${Object.keys(c.qualifiers).length ? ` ${JSON.stringify(c.qualifiers)}` : ''} — ${c.trust}`,
        ),
        structured.offering.url,
      ].join('\n');
      return { structured, text };
    },
  } satisfies ToolDefinition<'get_offering'>,
  {
    name: 'get_supplier',
    title: 'Get supplier profile',
    description:
      'Supplier organization profile with verification state, published offerings, capabilities and organization-level claims (e.g. ISO 26262 project experience).',
    annotations: READ_ONLY,
    run: async (args, env) => {
      const view = await env.runtime.app.catalog.getSupplier(env.ctx, args.supplier);
      const org = view.organization;
      const structured = {
        supplier: {
          id: org.id,
          name: org.name,
          slug: org.slug,
          verificationState: org.verificationState,
          summary: org.summary,
          untrusted: true as const,
          country: org.headquartersCountry,
          regions: [...org.regions],
          website: org.website,
          url: env.links.supplier(org.slug),
          isDemo: org.isDemo,
        },
        offerings: view.offerings.map((o) => present.offering(o, env.links)),
        capabilities: view.capabilities.map((c) => ({ name: c.name, concept: c.concept.label })),
        organizationClaims: view.organizationClaims.map(present.claim),
        notice: present.UNTRUSTED_NOTICE,
      };
      return {
        structured,
        text: [
          `${org.name} (${org.verificationState})${org.isDemo ? ' [DEMO DATA]' : ''}`,
          ...structured.offerings.map((o) => `- ${o.name} (${o.maturity})`),
          structured.supplier.url,
        ].join('\n'),
      };
    },
  } satisfies ToolDefinition<'get_supplier'>,
  {
    name: 'get_evidence',
    title: 'Get evidence and provenance',
    description:
      'Evidence behind claims: for an offering, a single claim, or one evidence item. Use it before stating that a capability, certification or production deployment exists.',
    annotations: READ_ONLY,
    uiResource: UI.evidenceViewer,
    run: async (args, env) => {
      const result = await env.runtime.app.catalog.getEvidence(env.ctx, {
        offeringId: args.offering_id,
        claimId: args.claim_id,
        evidenceId: args.evidence_id,
      });
      const structured = {
        claims: result.claims.map(present.claim),
        evidence: result.evidence.map(present.evidence),
        notice: present.UNTRUSTED_NOTICE,
      };
      return {
        structured,
        text:
          [
            ...structured.claims.map(
              (c) =>
                `Claim ${c.id}: ${c.predicate} ${c.concept.label} — ${c.trust}; evidence: ${c.evidenceIds.length}`,
            ),
            ...structured.evidence.map(
              (e) => `Evidence ${e.id}: [${e.kind}] ${e.title}${e.url ? ` ${e.url}` : ''}`,
            ),
          ].join('\n') || 'No evidence found.',
      };
    },
  } satisfies ToolDefinition<'get_evidence'>,
  {
    name: 'get_demo',
    title: 'Get technical demo videos',
    description:
      'Technical demo videos for an offering, or for offerings matching a capability description (e.g. "automatically analyze integration logs"). Returns playback and page URLs.',
    annotations: READ_ONLY,
    uiResource: UI.videoPlayer,
    run: async (args, env) => {
      const result = await env.runtime.app.catalog.getDemos(env.ctx, {
        offeringId: args.offering_id ?? null,
        query: args.query ?? null,
        limit: args.limit,
      });
      const names = new Map(result.offerings.map((o) => [o.id, o.name]));
      const videos = result.videos.map((v) =>
        present.video(v, v.offeringId ? (names.get(v.offeringId) ?? null) : null, env.links),
      );
      return {
        structured: { videos, notice: present.UNTRUSTED_NOTICE },
        text:
          videos
            .map(
              (v) =>
                `${v.title} (${v.offeringName ?? 'offering'}, ${v.durationSeconds ?? '?'}s)\n   ${v.playbackUrl ?? v.pageUrl ?? ''}`,
            )
            .join('\n') || 'No demo videos found.',
      };
    },
  } satisfies ToolDefinition<'get_demo'>,
  {
    name: 'compare_offerings',
    title: 'Compare offerings side by side',
    description:
      'Compare 2-5 offerings against a requirement (text or constraints) or, if none is given, across all concepts they claim. Returns a compatibility matrix with the evidence basis per cell.',
    annotations: READ_ONLY,
    uiResource: UI.comparison,
    run: async (args, env) => {
      const result = await env.runtime.app.matching.compare(env.ctx, {
        offeringIds: args.offering_ids,
        text: args.text ?? null,
        constraints: toConstraints(args.constraints),
      });
      const matches = result.matches.map((m) => present.match(m, env.links));
      const tiers = new Map(
        result.matches.flatMap((m) =>
          m.assessments.map((a) => [`${m.offering.id}:${a.constraintId}`, a.strongestTrustLabel] as const),
        ),
      );
      const structured = {
        offerings: matches.map((m) => m.offering),
        rows: result.matrix.map((row) => ({
          constraintId: row.constraintId,
          description: row.description,
          priority: row.priority,
          group: row.group,
          cells: row.cells.map((cell) => ({
            offeringId: cell.offeringId,
            status: cell.status,
            basis: tiers.get(`${cell.offeringId}:${row.constraintId}`) ?? null,
          })),
        })),
        matches,
        notice: present.UNTRUSTED_NOTICE,
      };
      const header = `| Constraint | ${structured.offerings.map((o) => o.name).join(' | ')} |`;
      const lines = structured.rows.map(
        (r) => `| ${r.description} | ${r.cells.map((c) => c.status).join(' | ')} |`,
      );
      return {
        structured,
        text: [header, `|${'---|'.repeat(structured.offerings.length + 1)}`, ...lines].join('\n'),
      };
    },
  } satisfies ToolDefinition<'compare_offerings'>,
  {
    name: 'explain_match',
    title: 'Explain how an offering matches',
    description:
      'Detailed, per-constraint explanation of one offering against a requirement: which constraints are met, partial, unknown or unmet, on what evidence, and what to ask the supplier.',
    annotations: READ_ONLY,
    uiResource: UI.compatibilityMatrix,
    requiredScopes: (args) => (args['requirement_id'] ? ['requirements:read'] : []),
    run: async (args, env) => {
      const result = await env.runtime.app.matching.findMatches(env.ctx, {
        ...matchQuery(args, env),
        offeringIds: [args.offering_id],
        limit: 1,
      });
      const first = result.matches[0];
      if (!first) throw notFound('Offering');
      const match = present.match(first, env.links);
      const interpretation = present.interpretation(result.interpretation);
      return {
        structured: { interpretation, match, notice: present.UNTRUSTED_NOTICE },
        text: [present.matchText(match), ...match.gaps.map((g) => `   Ask: ${g.suggestedQuestion}`)].join(
          '\n',
        ),
      };
    },
  } satisfies ToolDefinition<'explain_match'>,
] as const;
