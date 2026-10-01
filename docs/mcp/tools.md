# MCP tools

Schemas: `docs/api/json-schema/mcp-tools.json` (generated from `packages/contracts/src/mcp.ts`).

| Tool                          | Purpose                                                                          | Auth                                 | MCP App view         |
| ----------------------------- | -------------------------------------------------------------------------------- | ------------------------------------ | -------------------- |
| `search_technologies`         | Resolve technology names/aliases to ontology concept ids with relations          | —                                    | —                    |
| `search_offerings`            | Keyword + semantic browsing with hard concept filters, type, maturity            | —                                    | —                    |
| `search_suppliers`            | Supplier organizations by keywords/concepts                                      | —                                    | —                    |
| `analyze_requirement`         | Interpret text into hard constraints, preferences, unknown terms (stateless)     | —                                    | Requirement builder  |
| `validate_requirement`        | Check a draft: unknown concepts, missing hard constraints, confidential exposure | —                                    | —                    |
| `find_matching_offerings`     | Primary matching: per-constraint status, evidence basis, gaps, score breakdown   | requirement_id → `requirements:read` | Compatibility matrix |
| `search_matching_suppliers`   | Matching grouped by supplier (best offering each)                                | as above                             | —                    |
| `get_offering`                | Full technical profile with claims, provenance, evidence, videos                 | —                                    | Offering card        |
| `get_supplier`                | Supplier profile, offerings, capabilities, org-level claims                      | —                                    | —                    |
| `get_evidence`                | Evidence/provenance for an offering, claim or evidence item                      | —                                    | Evidence viewer      |
| `get_demo`                    | Demo videos by offering or capability description                                | —                                    | Video player         |
| `compare_offerings`           | 2–5 offerings side by side against a requirement                                 | —                                    | Comparison           |
| `explain_match`               | Detailed per-constraint explanation for one offering                             | requirement_id → `requirements:read` | Compatibility matrix |
| `create_requirement_draft`    | Save a PRIVATE requirement draft with confidential terms                         | `requirements:write`                 | Requirement builder  |
| `prepare_engagement_request`* | Preview a demo/workshop/PoC/RFI request; nothing is sent                         | `engagements:write`                  | Request form         |
| `confirm_engagement_request`* | Send after explicit user approval (token + idempotency key + `user_confirmed`)   | `engagements:write`                  | —                    |
| `get_supplier_workspace`      | Own workspace: offerings, claims (incl. AI drafts), evidence, upload states      | `supplier:write`                     | —                    |
| `create_offering`             | Create a PRIVATE draft offering                                                  | `supplier:write`                     | —                    |
| `add_claim`                   | Add a draft claim (subject + predicate + concept + qualifiers)                   | `supplier:write`                     | —                    |
| `add_evidence`                | Register certificate / case study / public URL / production reference            | `supplier:write`                     | —                    |
| `register_demo_video`         | Link an externally hosted demo video (never fetched)                             | `supplier:write`                     | —                    |
| `upload_document`             | Upload a datasheet/transcript (≤ ~8 MB); async scan, extraction, AI drafts       | `supplier:write`                     | —                    |
| `prepare_publication`         | Preview exactly what would become public; nothing is published                   | `supplier:write`                     | —                    |
| `confirm_publication`         | Publish after explicit user approval (token bound to user + exact versions)      | `supplier:write`                     | —                    |

\* Registered only when `FEATURE_ENGAGEMENT_ACTIONS=true`.

Supplier tools only ever create private drafts. Publication is a human review step: AI-drafted claims become supplier statements (`SUPPLIER_VERIFIED`), never platform-verified.

All read tools are annotated `readOnlyHint: true, openWorldHint: false`. Action tools are `openWorldHint: true` (they disclose information to a third party).
