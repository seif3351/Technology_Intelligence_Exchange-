-- Ordinal qualifiers (ASIL, Automotive SPICE capability level, ISO/SAE 21434 CAL) that a requirement may
-- attach to a concept. Data-driven: declared per concept in data/ontology/concepts/*.yaml (`qualifiers:`).
ALTER TABLE ontology_concepts
  ADD COLUMN qualifier_keys text[] NOT NULL DEFAULT '{}';
