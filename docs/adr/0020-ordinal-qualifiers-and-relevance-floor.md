# ADR-0020: Ordinal qualifiers as ontology data, one constraint wording, and a relevance floor

## Context

The expert review (docs/project/expert-review-2026-10.md, A2–A4) found three problems:

- **Qualifiers.** Only ASIL was understood, and the ASIL scale was hard-coded in the matcher. Automotive
  SPICE capability levels and ISO/SAE 21434 CAL, the most common supplier qualifications in OEM sourcing,
  were silently dropped. "ASPICE CL2" became plain "ASPICE", so a CL1 supplier "met" a CL2 requirement.
- **Wording.** Constraint descriptions were built in two places with internal jargon (`QNX — level
"supports"`), and that text reached buyers, agents, CSV exports and the questions sent to suppliers.
- **Noise.** Offerings with no information on any requested technology were listed and ranked.

## Decision

- **Scales are domain knowledge, applicability is data.** `packages/domain/src/qualifiers.ts` holds the
  standardized ordinal scales (`asil` QM–D, `aspiceLevel` 1–5, `cal` 1–4) with formatting and comparison.
  Each concept declares the keys a requirement may attach to it (`qualifiers:` in the YAML, stored in
  `ontology_concepts.qualifier_keys`, migration 0009). Interpretation reads a level only next to a
  declaring concept, so "SAE level 3" never becomes an ASPICE level. No code branches on concept ids;
  this also removes the one existing violation in AI drafting.
- **Levels are minimums and never assumed.** A claim meets "CL2 or higher" with CL2–CL5. A claim without
  the level, or with a lower one, is `partial`, with an explanation of the shortfall. AI-proposed levels
  are kept only when the quoted source sentence states exactly that level.
- **One wording.** The domain's `describeConstraint` is the only phrasing ("Supports QNX", "Certified:
  ASIL B or higher"), used by the matcher, the views and therefore all channels. Structured fields stay
  for programmatic clients.
- **Relevance floor.** A candidate with only `unknown` assessments is listed only when its own prose
  mentions a requested technology. The others are counted in `omittedWithoutEvidence` (API and MCP).
  Keyword retrieval is OR-based, so a keyword hit alone is not evidence of relevance.
- **Data guard.** Ontology loading rejects an alias that names two concepts.

## Consequences

- Matching results change for requirements that state ASPICE or CAL levels: they become stricter and
  more honest. Supplier claims need the level as a qualifier; the skill explains this.
- Result lists are shorter and every listed candidate has something to say about the request.
- New scales (e.g. ASPICE for Cybersecurity) are a domain change; making a scale applicable to more
  concepts is a data change.

## Alternatives considered

- **Scales in the YAML as well:** these scales are fixed by ISO and VDA standards, and keeping them in
  code gives type-safe comparison. Only applicability varies with the data.
- **A minimum score threshold instead of the floor:** scores mix text relevance with evidence and are not
  comparable across queries. "No information on any requested technology" is explainable to users.
- **Version-aware matching (AUTOSAR R22-11 vs R23-11):** release compatibility is not ordinal and differs
  per standard, so it is deferred (see the review's decisions).
