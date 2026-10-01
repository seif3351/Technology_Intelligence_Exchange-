-- Per-concept default constraint level (data-driven override of the facet default).
ALTER TABLE ontology_concepts
  ADD COLUMN default_level text CHECK (default_level IN ('mentioned','supports','experience','certified','production'));
