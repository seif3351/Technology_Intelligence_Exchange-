import {
  type Asset,
  type ConceptId,
  type MaturityLevel,
  type OfferingType,
  type RequirementConstraint,
  asId,
  isUuid,
  maturityAtLeast,
  normalizeForMatching,
  notFound,
  validationError,
} from '@atx/domain';
import type { ApplicationDeps } from '../deps';
import { canViewOffering } from '../policies';
import type { RequestContext } from '../principal';
import {
  type ClaimView,
  type ConceptRef,
  type EvidenceView,
  type OfferingDetailView,
  type SupplierView,
  type VideoView,
  conceptRef,
  organizationRef,
  presentCapability,
  presentClaim,
  presentEvidence,
  presentOfferingSummary,
  presentVideo,
} from '../views';
import type { MatchingService } from './matching';
import { clampLimit, decodeCursor, encodeCursor } from './support';

export interface OfferingSearchQuery {
  readonly query?: string | null;
  /** Hard filter: offering (or its organization) must have a published claim on each concept (or a narrower one). */
  readonly conceptIds?: readonly string[];
  readonly types?: readonly OfferingType[];
  readonly minimumMaturity?: MaturityLevel | null;
  readonly limit?: number;
  readonly cursor?: string | null;
}

export interface TechnologyView extends ConceptRef {
  readonly description: string;
  readonly aliases: readonly string[];
  readonly broader: readonly ConceptRef[];
  readonly narrower: readonly ConceptRef[];
  readonly related: readonly (ConceptRef & { readonly relation: string })[];
  readonly publishedOfferingCount: number;
}

const SIGNED_URL_TTL_SECONDS = 15 * 60;
const DEMO_RELEVANCE_RATIO = 0.8;

export class CatalogService {
  constructor(
    private readonly deps: ApplicationDeps,
    private readonly matching: MatchingService,
  ) {}

  /** Keyword/semantic discovery with structured filters. Reuses the matching pipeline for one source of truth. */
  async searchOfferings(ctx: RequestContext, query: OfferingSearchQuery) {
    const ontology = await this.deps.ontology.current();
    const unknown = (query.conceptIds ?? []).filter((id) => !ontology.hasConcept(id));
    if (unknown.length > 0) throw validationError(`Unknown concept id(s): ${unknown.join(', ')}`);
    const constraints: RequirementConstraint[] = (query.conceptIds ?? []).map((conceptId, index) => ({
      kind: 'concept',
      id: `f${index + 1}`,
      conceptId: asId(conceptId),
      level: 'mentioned',
      priority: 'hard',
      qualifiers: {},
      origin: 'user',
    }));
    const text = query.query?.trim() ?? '';
    if (!text && constraints.length === 0) throw validationError('Provide a query or at least one concept filter');

    const response = await this.matching.findMatches(ctx, {
      text,
      // With explicit concept filters we do not interpret the text; it is used for retrieval only.
      constraints: constraints.length > 0 ? constraints : null,
      requireAllHardConstraintsMet: constraints.length > 0,
      limit: 50,
    });
    const filtered = response.matches.filter(
      (match) =>
        (!query.types?.length || query.types.includes(match.offering.type as OfferingType)) &&
        (!query.minimumMaturity || maturityAtLeast(match.offering.maturity as MaturityLevel, query.minimumMaturity)),
    );
    const offset = decodeCursor(query.cursor);
    const limit = clampLimit(query.limit, 10);
    return {
      interpretation: response.interpretation,
      items: filtered.slice(offset, offset + limit).map((match) => ({
        offering: match.offering,
        relevance: match.scoreComponents.find((c) => c.name === 'text_relevance')?.value ?? 0,
        matchedConcepts: match.assessments.filter((a) => a.status === 'met').flatMap((a) => (a.concept ? [a.concept] : [])),
      })),
      nextCursor: offset + limit < filtered.length ? encodeCursor(offset + limit) : null,
      degraded: response.degraded,
    };
  }

  async getOffering(ctx: RequestContext, idOrSlug: { readonly id?: string; readonly organizationSlug?: string; readonly slug?: string }): Promise<OfferingDetailView> {
    const ontology = await this.deps.ontology.current();
    const offering = await this.resolveOffering(idOrSlug);
    if (!offering || !canViewOffering(ctx.principal, offering)) throw notFound('Offering');
    const organization = await this.deps.repos.organizations.findById(offering.organizationId);
    if (!organization) throw notFound('Offering');

    const [claims, evidence, assets] = await Promise.all([
      this.deps.repos.claims.listPublishedForOfferings([offering.id]),
      this.deps.repos.evidence.listPublicForOfferings([offering.id]),
      this.deps.repos.assets.listPublicForOfferings([offering.id]),
    ]);
    const offeringClaims = claims.filter((claim) => claim.subject.type === 'offering' && claim.subject.id === offering.id);
    const organizationClaims = claims.filter((claim) => claim.subject.type !== 'offering');
    return {
      ...presentOfferingSummary(offering, organization, offeringClaims, ontology),
      description: offering.description,
      details: offering.details,
      commercial: offering.commercial,
      regions: offering.regions,
      publishedAt: offering.publishedAt?.toISOString() ?? null,
      version: offering.version,
      claims: sortClaims(offeringClaims.map((claim) => presentClaim(claim, ontology))),
      organizationClaims: sortClaims(organizationClaims.map((claim) => presentClaim(claim, ontology))),
      evidence: evidence.map(presentEvidence),
      videos: assets.filter((asset) => asset.kind === 'video').map((asset) => this.video(asset)),
    };
  }

  async getSupplier(ctx: RequestContext, idOrSlug: string): Promise<SupplierView> {
    const ontology = await this.deps.ontology.current();
    const organization = isUuid(idOrSlug)
      ? await this.deps.repos.organizations.findById(asId(idOrSlug))
      : await this.deps.repos.organizations.findBySlug(idOrSlug);
    if (!organization || organization.kind === 'buyer' || organization.verificationState === 'suspended') {
      throw notFound('Supplier');
    }
    const [offerings, orgClaims, capabilities, evidence] = await Promise.all([
      this.deps.repos.offerings.listPublishedByOrganization(organization.id),
      this.deps.repos.claims.listPublishedForOrganization(organization.id),
      this.deps.repos.capabilities.listPublishedByOrganization(organization.id),
      this.deps.repos.evidence.listPublicForOrganization(organization.id),
    ]);
    const offeringClaims = await this.deps.repos.claims.listPublishedForOfferings(offerings.map((o) => o.id));
    return {
      organization: {
        ...organizationRef(organization),
        kind: organization.kind,
        summary: organization.summary,
        description: organization.description,
        untrusted: true,
        website: organization.website,
        headquartersCountry: organization.headquartersCountry,
        regions: organization.regions,
        employeeRange: organization.employeeRange,
        verifiedAt: organization.verifiedAt?.toISOString() ?? null,
      },
      offerings: offerings
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((offering) => presentOfferingSummary(offering, organization, offeringClaims, ontology)),
      capabilities: capabilities.map((capability) => presentCapability(capability, ontology)),
      organizationClaims: sortClaims(
        orgClaims.filter((claim) => claim.subject.type !== 'offering').map((claim) => presentClaim(claim, ontology)),
      ),
      evidence: evidence.map(presentEvidence),
    };
  }

  async searchSuppliers(_ctx: RequestContext, query: { readonly query?: string | null; readonly conceptIds?: readonly string[]; readonly limit?: number; readonly cursor?: string | null }) {
    const ontology = await this.deps.ontology.current();
    const conceptIds = (query.conceptIds ?? []).map((id) => {
      if (!ontology.hasConcept(id)) throw validationError(`Unknown concept id: ${id}`);
      return id as ConceptId;
    });
    const expanded = conceptIds.flatMap((id) => [...ontology.narrowerOrSelf(id)]);
    const limit = clampLimit(query.limit, 10);
    const offset = decodeCursor(query.cursor);
    const { items, total } = await this.deps.repos.organizations.searchSuppliers({
      text: query.query?.trim() || null,
      conceptIds: expanded,
      limit,
      offset,
    });
    return {
      items: items.map((org) => ({ ...organizationRef(org), summary: org.summary, untrusted: true as const, headquartersCountry: org.headquartersCountry, regions: org.regions })),
      nextCursor: offset + limit < total ? encodeCursor(offset + limit) : null,
    };
  }

  async getEvidence(ctx: RequestContext, input: { readonly offeringId?: string; readonly claimId?: string; readonly evidenceId?: string }): Promise<{ claims: ClaimView[]; evidence: EvidenceView[] }> {
    const ontology = await this.deps.ontology.current();
    if (input.evidenceId) {
      const evidence = await this.deps.repos.evidence.findById(asId(input.evidenceId));
      if (!evidence || evidence.visibility !== 'public') throw notFound('Evidence');
      return { claims: [], evidence: [presentEvidence(evidence)] };
    }
    if (input.claimId) {
      const claim = await this.deps.repos.claims.findById(asId(input.claimId));
      if (!claim || claim.status !== 'published') throw notFound('Claim');
      const evidence = await this.deps.repos.evidence.findManyByIds(claim.provenance.evidenceIds);
      return {
        claims: [presentClaim(claim, ontology)],
        evidence: evidence.filter((item) => item.visibility === 'public').map(presentEvidence),
      };
    }
    if (input.offeringId) {
      const detail = await this.getOffering(ctx, { id: input.offeringId });
      return { claims: [...detail.claims, ...detail.organizationClaims], evidence: [...detail.evidence] };
    }
    throw validationError('Provide offeringId, claimId or evidenceId');
  }

  /** Technical demo videos, by offering or by capability/text search. */
  async getDemos(ctx: RequestContext, input: { readonly offeringId?: string | null; readonly query?: string | null; readonly limit?: number }): Promise<{ videos: VideoView[]; offerings: ReturnType<typeof presentOfferingSummary>[] }> {
    const limit = clampLimit(input.limit, 5);
    if (input.offeringId) {
      const detail = await this.getOffering(ctx, { id: input.offeringId });
      return { videos: detail.videos.slice(0, limit), offerings: [detail] };
    }
    const text = input.query?.trim();
    if (!text) throw validationError('Provide offeringId or query');
    const search = await this.searchOfferings(ctx, { query: text, limit: 20 });
    // Demos are only useful for genuinely relevant offerings: keep those that
    // match an interpreted concept, or score close to the best text relevance.
    const conceptMatches = search.items.filter((item) => item.matchedConcepts.length > 0);
    const best = Math.max(0, ...search.items.map((item) => item.relevance));
    const relevant =
      conceptMatches.length > 0
        ? conceptMatches
        : search.items.filter((item) => best > 0 && item.relevance >= best * DEMO_RELEVANCE_RATIO);
    const offeringIds = relevant.map((item) => asId<'OfferingId'>(item.offering.id));
    const videos = await this.deps.repos.assets.listPublicVideos({ offeringIds, text: null, limit: 50 });
    const rank = new Map(offeringIds.map((id, index) => [id, index]));
    const ordered = videos
      .filter((video) => video.offeringId !== null)
      .sort((a, b) => (rank.get(a.offeringId!) ?? 99) - (rank.get(b.offeringId!) ?? 99) || a.title.localeCompare(b.title))
      .slice(0, limit);
    const offerings = relevant.map((item) => item.offering).filter((o) => ordered.some((v) => v.offeringId === o.id));
    return { videos: ordered.map((asset) => this.video(asset)), offerings };
  }

  async searchTechnologies(_ctx: RequestContext, input: { readonly query?: string | null; readonly facet?: string | null; readonly limit?: number }): Promise<TechnologyView[]> {
    const ontology = await this.deps.ontology.current();
    const limit = clampLimit(input.limit, 10);
    const needle = normalizeForMatching(input.query ?? '');
    const scored = ontology.concepts
      .filter((concept) => concept.status === 'active' && (!input.facet || concept.facetId === input.facet))
      .map((concept) => ({ concept, score: needle ? conceptScore(needle, concept.label, concept.aliases, concept.description) : 1 }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.concept.label.localeCompare(b.concept.label))
      .slice(0, limit);
    const counts = await this.deps.repos.claims.countPublishedOfferingsByConcept(scored.map((entry) => entry.concept.id));
    return scored.map(({ concept }) => ({
      ...conceptRef(ontology, concept.id),
      description: concept.description,
      aliases: concept.aliases,
      broader: ontology.relationsFrom(concept.id).filter((r) => r.type === 'is_a').map((r) => conceptRef(ontology, r.toConceptId)),
      narrower: ontology.relationsTo(concept.id).filter((r) => r.type === 'is_a').map((r) => conceptRef(ontology, r.fromConceptId)),
      related: [
        ...ontology.relationsFrom(concept.id).filter((r) => r.type !== 'is_a').map((r) => ({ ...conceptRef(ontology, r.toConceptId), relation: r.type })),
        ...ontology.relationsTo(concept.id).filter((r) => r.type !== 'is_a').map((r) => ({ ...conceptRef(ontology, r.fromConceptId), relation: `inverse_${r.type}` })),
      ],
      publishedOfferingCount: counts.get(concept.id) ?? 0,
    }));
  }

  async getOntology() {
    const ontology = await this.deps.ontology.current();
    return { facets: ontology.facets, concepts: ontology.concepts.filter((c) => c.status === 'active') };
  }

  private async resolveOffering(idOrSlug: { readonly id?: string; readonly organizationSlug?: string; readonly slug?: string }) {
    if (idOrSlug.id) return isUuid(idOrSlug.id) ? this.deps.repos.offerings.findById(asId(idOrSlug.id)) : null;
    if (idOrSlug.organizationSlug && idOrSlug.slug) {
      const org = await this.deps.repos.organizations.findBySlug(idOrSlug.organizationSlug);
      if (!org) return null;
      const offerings = await this.deps.repos.offerings.listPublishedByOrganization(org.id);
      return offerings.find((offering) => offering.slug === idOrSlug.slug) ?? null;
    }
    throw validationError('Provide an offering id or organization and offering slugs');
  }

  private video(asset: Asset): VideoView {
    const playbackUrl =
      asset.processingState !== 'ready'
        ? null
        : asset.externalUrl ?? (asset.storageKey ? this.deps.assetUrls.signedUrl(asset.id, SIGNED_URL_TTL_SECONDS) : null);
    return presentVideo(asset, playbackUrl);
  }
}

const TRUST_ORDER = ['platform_verified', 'supplier_verified_with_evidence', 'supplier_verified', 'public_source', 'unverified', 'ai_inferred'];

const sortClaims = (claims: ClaimView[]): ClaimView[] =>
  claims.sort(
    (a, b) =>
      a.concept.facet.localeCompare(b.concept.facet) ||
      TRUST_ORDER.indexOf(a.trustTier) - TRUST_ORDER.indexOf(b.trustTier) ||
      a.concept.label.localeCompare(b.concept.label) ||
      a.id.localeCompare(b.id),
  );

const conceptScore = (needle: string, label: string, aliases: readonly string[], description: string): number => {
  const names = [label, ...aliases].map(normalizeForMatching);
  if (names.includes(needle)) return 3;
  if (names.some((name) => name.startsWith(needle) || (name.length >= 3 && needle.includes(name)))) return 2;
  if (names.some((name) => name.includes(needle)) || normalizeForMatching(description).includes(needle)) return 1;
  return 0;
};
