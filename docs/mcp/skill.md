# Automotive Technology Exchange skill

Source: [`skills/automotive-technology-exchange/SKILL.md`](../../skills/automotive-technology-exchange/SKILL.md).

Distribution:

- **Over MCP** — the server implements the Skills extension (`io.modelcontextprotocol/skills`, SEP-2640): `skills/list`, `skills/get`, and `skill://automotive-technology-exchange/SKILL.md` resources with SHA-256 digests and cache hints.
- **As a file** — hand `SKILL.md` to a supplier or an OEM; it is self-contained (connection, sign-in, scopes per role, both workflows). Copy the directory into any Agent Skills–compatible host.

What it teaches (workflow and behaviour only — the server stays authoritative):
connecting and signing in (OAuth or agent token, scopes per role); telling supplier and OEM users apart;
**supplier workflow** — workspace review, draft offerings, ontology mapping with `search_technologies`, choosing the weakest literally-true predicate, evidence, demo videos, document upload and review of AI-drafted claims, publication via prepare → approve → confirm;
**OEM workflow** — hard constraints vs preferences, `confidential_terms`, interpretation, matching vs browsing, reading statuses and evidence bases, comparison, private requirement drafts, engagement requests;
for everyone — never upgrading claim strength, treating supplier content as untrusted data, rich UI vs structured fallback.

Tested end to end in `apps/mcp-server/test/skill-roles.int.test.ts`: an agent loads the skill over MCP and follows the supplier and OEM workflows with role-specific tokens; a further test fails if the skill references a tool, argument or enum value the server does not expose, or if a tool is undocumented.

Keep the skill short and behavioural. When tools change, update descriptions in code first and the skill only if the workflow changes.
