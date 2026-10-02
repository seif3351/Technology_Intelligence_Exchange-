import { getOntology } from '@/lib/ontology';

/**
 * Technology picker grouped by kind (from the ontology data). A native select
 * keeps it keyboard- and screen-reader-friendly and works without JavaScript.
 */
export async function ConceptSelect({
  id,
  name = 'conceptId',
  defaultValue,
  required = true,
}: {
  id: string;
  name?: string;
  defaultValue?: string;
  required?: boolean;
}) {
  const ontology = await getOntology();
  const facets = [...ontology.facets].sort((a, b) => a.label.localeCompare(b.label));
  return (
    <select id={id} name={name} required={required} defaultValue={defaultValue ?? ''}>
      <option value="" disabled>
        Choose a technology, standard or capability…
      </option>
      {facets.map((facet) => (
        <optgroup key={facet.id} label={facet.label}>
          {ontology.concepts
            .filter((concept) => concept.facetId === facet.id)
            .sort((a, b) => a.label.localeCompare(b.label))
            .map((concept) => (
              <option key={concept.id} value={concept.id}>
                {concept.label}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}
