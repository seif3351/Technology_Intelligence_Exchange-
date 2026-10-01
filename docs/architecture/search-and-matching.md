# Search and matching

## Pipeline

`natural language → interpretation → constraints (+ ontology expansion) → keyword | semantic | structured retrieval → RRF fusion → deterministic evaluation → scoring → explanation`

### Interpretation (`packages/search/src/interpret.ts`)

- Ontology alias matching (longest alias wins; case-sensitive aliases such as `CAN`).
- Clauses split on sentence boundaries and "but". A preference cue (_ideally, preferably, nice to have, …_) turns later mentions in the clause into **preferences**; everything else is **hard**.
- Level cues next to a term: _certified_ → `certified`, _experience / track record_ → `experience`, _in series production_ → `production`; otherwise the facet's `default_level`.
- _production-ready_ → maturity ≥ production; _production references_ → production-reference constraint.
- Broader concepts implied by narrower ones are dropped; unrecognized technical tokens are reported as **unknown terms**.
- Optional AI assistance may only add constraints for valid ontology concepts.

### Evaluation (`packages/search/src/match.ts`)

Per constraint: `met` (an active published claim on the concept or a narrower one, with a predicate allowed for the level, qualifiers satisfied), `partial` (related but weaker, or broader concept), `unknown` (no information), `unmet` (contradicted by the supplier's own data, e.g. maturity). Candidates with an unmet hard constraint are excluded from searches.

### Score (`packages/search/src/score.ts`) — always shown with its components

| Component         | Weight | Value                                                                                   |
| ----------------- | ------ | --------------------------------------------------------------------------------------- |
| hard_constraints  | 0.45   | mean over hard constraints: met 1, partial 0.4, unknown 0.15, unmet 0                   |
| preferences       | 0.15   | same over preferences (1 if none)                                                       |
| evidence_strength | 0.20   | mean trust weight of strongest supporting claim (platform verified 1 … AI-inferred 0.2) |
| text_relevance    | 0.20   | RRF relevance normalized to 0..1                                                        |

Ranking: hard-constraint status first (all met / none specified < some unknown < some unmet), then score, then name, then id — deterministic.

### Confidence (qualitative)

`high` when all hard constraints are met and at least half the met constraints are backed by evidence or platform verification without weak (unverified / AI-inferred) support; `medium` when all hard constraints are met (or one is unknown) without weak support; otherwise `low`.

To change the model, replace `score.ts`/`match.ts`; tests in `packages/search/test` document expected behaviour.
