import 'server-only';
import { cache } from 'react';
import { z } from 'zod';
import { api } from './api';

export const OntologyResponse = z.object({
  facets: z.array(z.object({ id: z.string(), label: z.string(), description: z.string() })),
  concepts: z.array(
    z.object({ id: z.string(), facetId: z.string(), label: z.string(), aliases: z.array(z.string()) }),
  ),
});

/** The public ontology (facets and active concepts), fetched once per request. */
export const getOntology = cache(async () =>
  api('/v1/ontology', { schema: OntologyResponse, anonymous: true }),
);

/** facet id -> human label, from the ontology data (never hard-coded in the web app). */
export const getFacetLabels = cache(async (): Promise<ReadonlyMap<string, string>> => {
  const { facets } = await getOntology();
  return new Map(facets.map((facet) => [facet.id, facet.label]));
});
