import type { MatchQuery } from '@atx/application';
import { type McpConstraintInput, toDomainConstraints } from '@atx/contracts';
import { unauthenticated, validationError } from '@atx/domain';
import type { z } from 'zod';
import * as present from '../presenters';
import { READ_ONLY, type ToolDefinition, type ToolEnvironment } from './define';

export const UI = {
  offeringCard: 'ui://atx/offering-card.html',
  compatibilityMatrix: 'ui://atx/compatibility-matrix.html',
  videoPlayer: 'ui://atx/video-player.html',
  comparison: 'ui://atx/comparison.html',
  requirementBuilder: 'ui://atx/requirement-builder.html',
  evidenceViewer: 'ui://atx/evidence-viewer.html',
  requestForm: 'ui://atx/request-form.html',
} as const;

/** Ordinal minimums (ADR-0020) as qualifiers; values are validated against their scales in the domain. */
const levelQualifiers = (input: {
  readonly asil?: string | undefined;
  readonly aspiceLevel?: string | undefined;
  readonly cal?: string | undefined;
}): Record<string, string> => ({
  ...(input.asil ? { asil: input.asil } : {}),
  ...(input.aspiceLevel ? { aspiceLevel: input.aspiceLevel } : {}),
  ...(input.cal ? { cal: input.cal } : {}),
});

export const toConstraints = (inputs: readonly z.infer<typeof McpConstraintInput>[] | undefined) =>
  toDomainConstraints(
    inputs?.map((input) =>
      input.kind === 'concept'
        ? {
            kind: 'concept' as const,
            conceptId: input.conceptId,
            level: input.level,
            priority: input.priority,
            qualifiers: levelQualifiers(input),
          }
        : input,
    ),
  ) ?? null;

/** Picks the buyer organization: explicit id, or the caller's only organization. */
export const resolveOrganization = (env: ToolEnvironment, explicit: string | undefined): string => {
  if (explicit) return explicit;
  const principal = env.ctx.principal;
  if (principal.kind !== 'user') throw unauthenticated('Authentication is required for private requirements');
  if (principal.memberships.length === 1 && principal.memberships[0])
    return principal.memberships[0].organizationId;
  throw validationError('organization_id is required because you belong to several organizations');
};

interface RequirementSourceArgs {
  readonly text?: string;
  readonly constraints?: z.infer<typeof McpConstraintInput>[];
  readonly requirement_id?: string;
  readonly organization_id?: string;
  readonly confidential_terms?: string[];
}

export const matchQuery = (args: RequirementSourceArgs, env: ToolEnvironment): MatchQuery => ({
  text: args.text ?? null,
  constraints: toConstraints(args.constraints),
  requirement: args.requirement_id
    ? { requirementId: args.requirement_id, organizationId: resolveOrganization(env, args.organization_id) }
    : null,
  confidentialTerms: args.confidential_terms ?? [],
});

const requirementScopes = (args: Record<string, unknown>) =>
  args['requirement_id'] ? ['requirements:read'] : [];

export const discoveryTools = [
  {
    name: 'search_technologies',
    title: 'Search automotive technologies',
    description:
      'Look up technologies in the Automotive Technology Exchange ontology (operating systems, SoCs, AUTOSAR, protocols, safety/security standards, capabilities). ' +
      'Returns stable concept ids, aliases and relations (broader/narrower/related). Use it to resolve user terms like "Orin" or "21434" into concept ids for structured constraints.',
    annotations: READ_ONLY,
    run: async (args, env) => {
      const items = await env.runtime.app.catalog.searchTechnologies(env.ctx, args);
      const structured = {
        items: items.map((item) => ({
          id: item.id,
          label: item.label,
          facet: item.facet,
          description: item.description,
          aliases: [...item.aliases],
          broader: item.broader.map((c) => c.id),
          narrower: item.narrower.map((c) => c.id),
          related: item.related.map((c) => `${c.relation}:${c.id}`),
          publishedOfferingCount: item.publishedOfferingCount,
        })),
      };
      return {
        structured,
        text:
          items
            .map((i) => `${i.id} — ${i.label} (${i.facet}); ${i.publishedOfferingCount} published offerings`)
            .join('\n') || 'No matching technologies.',
      };
    },
  } satisfies ToolDefinition<'search_technologies'>,
  {
    name: 'search_offerings',
    title: 'Search offerings',
    description:
      'Keyword + semantic search over published automotive products, services and technology platforms, with optional hard concept filters (concept_ids), type and minimum maturity. ' +
      'Use for browsing/discovery. For checking a technical requirement (hard constraints, gaps, evidence) use find_matching_offerings instead.',
    annotations: READ_ONLY,
    run: async (args, env) => {
      const result = await env.runtime.app.catalog.searchOfferings(env.ctx, {
        query: args.query ?? null,
        conceptIds: args.concept_ids,
        types: args.types,
        minimumMaturity: args.minimum_maturity ?? null,
        limit: args.limit,
        cursor: args.cursor ?? null,
      });
      const items = result.items.map((item) => ({
        ...present.offering(item.offering, env.links),
        matchedConcepts: item.matchedConcepts.map((c) => c.label),
      }));
      return {
        structured: {
          items,
          nextCursor: result.nextCursor,
          degraded: [...result.degraded],
          notice: present.UNTRUSTED_NOTICE,
        },
        text:
          items
            .map(
              (o, i) =>
                `${i + 1}. ${o.name} — ${o.supplier.name} (${o.maturity})${o.isDemo ? ' [DEMO]' : ''}\n   ${o.url}`,
            )
            .join('\n') || 'No offerings found.',
      };
    },
  } satisfies ToolDefinition<'search_offerings'>,
  {
    name: 'search_suppliers',
    title: 'Search suppliers',
    description:
      'Find supplier organizations by keywords and/or technology concepts they have published claims about. Returns verification state (unverified/pending/verified).',
    annotations: READ_ONLY,
    run: async (args, env) => {
      const result = await env.runtime.app.catalog.searchSuppliers(env.ctx, {
        query: args.query ?? null,
        conceptIds: args.concept_ids,
        limit: args.limit,
        cursor: args.cursor ?? null,
      });
      const items = result.items.map((s) => ({
        id: s.id,
        name: s.name,
        verificationState: s.verificationState,
        summary: s.summary,
        untrusted: true as const,
        country: s.headquartersCountry,
        url: env.links.supplier(s.slug),
        isDemo: s.isDemo,
      }));
      return {
        structured: { items, nextCursor: result.nextCursor, notice: present.UNTRUSTED_NOTICE },
        text:
          items
            .map((s) => `${s.name} (${s.verificationState})${s.isDemo ? ' [DEMO]' : ''} — ${s.url}`)
            .join('\n') || 'No suppliers found.',
      };
    },
  } satisfies ToolDefinition<'search_suppliers'>,
  {
    name: 'analyze_requirement',
    title: 'Analyze a technical requirement',
    description:
      'Interpret a natural-language automotive requirement into HARD constraints, PREFERENCES and UNKNOWN terms without storing anything. ' +
      'Pass confidential_terms (project names, programs, customers) so they are removed before processing. Use before find_matching_offerings to confirm the interpretation with the user when it matters.',
    annotations: READ_ONLY,
    uiResource: UI.requirementBuilder,
    run: async (args, env) => {
      const interpretation = present.interpretation(
        await env.runtime.app.matching.interpret(env.ctx, args.text, args.confidential_terms ?? []),
      );
      return { structured: { interpretation }, text: present.interpretationText(interpretation) };
    },
  } satisfies ToolDefinition<'analyze_requirement'>,
  {
    name: 'validate_requirement',
    title: 'Validate a requirement draft',
    description:
      'Check a requirement draft for unknown concepts, missing hard constraints and confidential-term exposure. Stateless; nothing is stored.',
    annotations: READ_ONLY,
    run: async (args, env) => {
      const result = await env.runtime.app.requirements.validate(env.ctx, {
        title: args.title ?? '',
        description: args.description,
        constraints: toConstraints(args.constraints),
        confidentialTerms: args.confidential_terms,
      });
      return {
        structured: {
          valid: result.valid,
          issues: result.issues.map((i) => ({ ...i })),
          constraints: result.constraints.map(present.constraint),
          unknownTerms: [...result.unrecognizedTerms],
        },
        text: [`valid: ${result.valid}`, ...result.issues.map((i) => `${i.severity}: ${i.message}`)].join(
          '\n',
        ),
      };
    },
  } satisfies ToolDefinition<'validate_requirement'>,
  {
    name: 'find_matching_offerings',
    title: 'Find offerings matching a technical requirement',
    description:
      'Primary matching tool. Evaluates published offerings against a requirement (text, structured constraints, or a saved private requirement_id) using the ontology and evidence. ' +
      'Each match reports per-constraint status (met / partial / unknown / unmet), the evidence basis (supplier-stated vs platform-verified vs AI-inferred), gaps with suggested questions, and a transparent score breakdown. ' +
      'Candidates contradicting a hard constraint are excluded. Pass confidential_terms to keep project/program/customer names out of processing.',
    annotations: READ_ONLY,
    uiResource: UI.compatibilityMatrix,
    requiredScopes: requirementScopes,
    run: async (args, env) => {
      const result = await env.runtime.app.matching.findMatches(env.ctx, {
        ...matchQuery(args, env),
        requireAllHardConstraintsMet: args.require_all_hard_met,
        limit: args.limit,
        cursor: args.cursor ?? null,
      });
      const matches = result.matches.map((m) => present.match(m, env.links));
      const interpretation = present.interpretation(result.interpretation);
      return {
        structured: {
          interpretation,
          matches,
          nextCursor: result.nextCursor,
          totalCandidatesEvaluated: result.totalCandidatesEvaluated,
          omittedWithoutEvidence: result.omittedWithoutEvidence,
          degraded: [...result.degraded],
          notice: present.UNTRUSTED_NOTICE,
        },
        text:
          [present.interpretationText(interpretation), '', ...matches.map(present.matchText)].join('\n') ||
          'No candidates found.',
      };
    },
  } satisfies ToolDefinition<'find_matching_offerings'>,
  {
    name: 'search_matching_suppliers',
    title: 'Find suppliers for a requirement',
    description:
      'Like find_matching_offerings, but grouped by supplier: returns each supplier once with its best-matching offering. Useful for shortlisting suppliers for a saved private requirement.',
    annotations: READ_ONLY,
    requiredScopes: requirementScopes,
    run: async (args, env) => {
      const result = await env.runtime.app.matching.findMatches(env.ctx, {
        ...matchQuery(args, env),
        limit: 50,
      });
      const bySupplier = new Map<string, { best: (typeof result.matches)[number]; others: string[] }>();
      for (const m of result.matches) {
        const entry = bySupplier.get(m.offering.organization.id);
        if (entry) entry.others.push(m.offering.id);
        else bySupplier.set(m.offering.organization.id, { best: m, others: [] });
      }
      const suppliers = [...bySupplier.values()].slice(0, args.limit).map(({ best, others }) => ({
        supplier: {
          id: best.offering.organization.id,
          name: best.offering.organization.name,
          verificationState: best.offering.organization.verificationState,
          url: env.links.supplier(best.offering.organization.slug),
          isDemo: best.offering.organization.isDemo,
        },
        bestMatch: present.match(best, env.links),
        otherOfferingIds: others,
      }));
      return {
        structured: {
          interpretation: present.interpretation(result.interpretation),
          suppliers,
          notice: present.UNTRUSTED_NOTICE,
        },
        text:
          suppliers
            .map(
              (s, i) =>
                `${i + 1}. ${s.supplier.name} (${s.supplier.verificationState}) — best: ${s.bestMatch.offering.name}: ${s.bestMatch.summary}`,
            )
            .join('\n') || 'No suppliers found.',
      };
    },
  } satisfies ToolDefinition<'search_matching_suppliers'>,
] as const;
