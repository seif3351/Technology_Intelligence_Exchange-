# ADR-0018: Agents edit drafts only; buyer alerts are opt-in and private

## Context

Supplier agents need to correct drafts (e.g. AI drafts that overstate a document) and edit draft offerings. Revising a claim keeps its status, so an agent revising a _published_ claim would change what buyers see without the human approval that ADR-0010 requires for publication. Buyers asked to be told when new suppliers match saved requirements.

## Decision

- **Human-in-the-loop for public content**: `assertMayEditPublicContent` — principals acting through a client (MCP agents, OAuth applications) may revise only draft claims and draft offerings. Published content changes through a person on the website, or by retracting it and publishing a corrected draft through `prepare_publication` → approval → `confirm_publication`. Retracting is allowed for agents (it only removes public content) and is annotated destructive.
- **Shortlist export**: `/v1/matches/export` returns CSV (status and evidence basis per constraint, open questions, links); every cell is neutralised against spreadsheet formula injection because supplier text is untrusted.
- **Saved-requirement alerts**: opt-in per requirement (`requirement_watches`); when an offering is first indexed (newly listed) a job evaluates it against watched requirements through the normal matcher (per-tenant authorization, audited `requirement.match`), and emails the watcher once per requirement/offering (`requirement_alerts`) when all hard constraints are met. Nothing is disclosed to the supplier.

## Consequences

Agent workflows stay safe by construction; people keep full editing rights on the website. Alert evaluation is O(watched requirements) per newly listed offering, acceptable for the pilot.

## Amendment (S13, expert review 2026-10)

The decision assumed that people edit published content "on the website". At the time, the website could
not do that: offering, claim, evidence and profile editing existed only in the API and MCP. The supplier
workspace now covers it:

- an offering editor (details, publish or withdraw, claims grouped by status with publish, edit, discard
  and withdraw, and evidence);
- an organization page (profile, organization-level claims, organization-wide evidence).

Withdrawing published content needs an explicit confirmation. A substantive edit of a published claim
still drops platform verification (domain `reviseClaim`). Two revision bugs found on the way were fixed:
linking evidence kept the claim's source, and validity dates are now saved.
