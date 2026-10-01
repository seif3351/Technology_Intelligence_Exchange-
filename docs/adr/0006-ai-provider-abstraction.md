# ADR-0006: AI behind narrow ports with deterministic baselines

## Decision

- Application ports: `RequirementExtractor`, `SupplierProfileDraftGenerator`, `EmbeddingProvider`. Provider-neutral `StructuredLlm` inside `@atx/ai`.
- Every AI capability has a deterministic baseline (ontology lexicon + cue rules) that always works; AI only adds to it. If the LLM fails, refuses, truncates or returns invalid output, the baseline result is used.
- Anthropic adapter: `@anthropic-ai/sdk` `beta.messages.parse` with Zod structured outputs (`output_config.format`), default model `claude-opus-5-5`, server-side refusal fallback (`fallbacks: "default"`), effort `low` for extraction.
- Untrusted content is passed only as delimited data with explicit rules; outputs are schema-validated, concept ids checked against the ontology, and drafted claims must quote the source verbatim (grounding check). A predicate stronger than the quote's own wording is downgraded.
- AI output never publishes or verifies anything: drafts are `AI_INFERRED`, `status=draft`, and need human review.
- Private requirement text has confidential terms redacted before any provider call; requirement-based matching sends only constraint labels to retrieval.

## Consequences

The marketplace works with `AI_PROVIDER=none`. Swapping providers touches one adapter.
