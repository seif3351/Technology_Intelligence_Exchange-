import type {
  ConceptId,
  Offering,
  OfferingId,
  Ontology,
  Organization,
  OrganizationId,
  TechnicalClaim,
} from '@atx/domain';
import type { MatchCandidate } from '@atx/search';
import type { ApplicationDeps } from '../deps';
import { type OfferingSummaryView, presentOfferingSummary } from '../views';

/**
 * Loads everything needed to evaluate and present a set of published
 * offerings in a constant number of queries (no N+1).
 */
export interface CatalogBundle {
  readonly offerings: ReadonlyMap<OfferingId, Offering>;
  readonly organizations: ReadonlyMap<OrganizationId, Organization>;
  readonly claimsByOffering: ReadonlyMap<OfferingId, TechnicalClaim[]>;
  readonly productionReferenceOfferings: ReadonlySet<OfferingId>;
}

export const loadCatalogBundle = async (
  deps: ApplicationDeps,
  offeringIds: readonly OfferingId[],
): Promise<CatalogBundle> => {
  const offerings = await deps.repos.offerings.findPublishedByIds(offeringIds);
  const ids = offerings.map((offering) => offering.id);
  const [organizations, claims, productionRefs] = await Promise.all([
    deps.repos.organizations.findManyByIds([...new Set(offerings.map((o) => o.organizationId))]),
    deps.repos.claims.listPublishedForOfferings(ids),
    deps.repos.evidence.offeringsWithProductionReferences(ids),
  ]);
  const claimsByOffering = new Map<OfferingId, TechnicalClaim[]>();
  for (const offering of offerings) {
    claimsByOffering.set(
      offering.id,
      claims.filter((claim) =>
        claim.subject.type === 'offering'
          ? claim.subject.id === offering.id
          : claim.organizationId === offering.organizationId,
      ),
    );
  }
  return {
    offerings: new Map(offerings.map((offering) => [offering.id, offering])),
    organizations: new Map(
      organizations.filter((org) => org.verificationState !== 'suspended').map((org) => [org.id, org]),
    ),
    claimsByOffering,
    productionReferenceOfferings: productionRefs,
  };
};

export const toCandidate = (
  bundle: CatalogBundle,
  offeringId: OfferingId,
  textRelevance: number,
): MatchCandidate | null => {
  const offering = bundle.offerings.get(offeringId);
  if (!offering) return null;
  const organization = bundle.organizations.get(offering.organizationId);
  if (!organization) return null;
  return {
    offering,
    organization,
    claims: bundle.claimsByOffering.get(offeringId) ?? [],
    hasProductionReferenceEvidence: bundle.productionReferenceOfferings.has(offeringId),
    textRelevance,
  };
};

export const summaryFromBundle = (
  bundle: CatalogBundle,
  offeringId: OfferingId,
  ontology: Ontology,
): OfferingSummaryView | null => {
  const offering = bundle.offerings.get(offeringId);
  const organization = offering ? bundle.organizations.get(offering.organizationId) : undefined;
  if (!offering || !organization) return null;
  return presentOfferingSummary(
    offering,
    organization,
    bundle.claimsByOffering.get(offeringId) ?? [],
    ontology,
  );
};

/** Expands concept ids to their narrower concepts for structured retrieval. */
export const expandConcepts = (ontology: Ontology, conceptIds: readonly ConceptId[]): ConceptId[] => {
  const expanded = new Set<ConceptId>();
  for (const id of conceptIds) for (const narrower of ontology.narrowerOrSelf(id)) expanded.add(narrower);
  return [...expanded].sort();
};
