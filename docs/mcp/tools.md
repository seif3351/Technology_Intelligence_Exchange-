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

\* Registered only when `FEATURE_ENGAGEMENT_ACTIONS=true`.

All read tools are annotated `readOnlyHint: true, openWorldHint: false`. Action tools are `openWorldHint: true` (they disclose information to a third party).
