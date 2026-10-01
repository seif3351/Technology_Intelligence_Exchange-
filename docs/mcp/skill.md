# Automotive Technology Exchange skill

Source: [`skills/automotive-technology-exchange/SKILL.md`](../../skills/automotive-technology-exchange/SKILL.md).

Distribution:

- **Over MCP** — the server implements the Skills extension (`io.modelcontextprotocol/skills`, SEP-2640): `skills/list`, `skills/get`, and `skill://automotive-technology-exchange/SKILL.md` resources with SHA-256 digests and cache hints.
- **As a file** — copy the directory into any Agent Skills–compatible host.

What it teaches (workflow and behaviour only — the server stays authoritative):
when to use ATX; separating hard constraints from preferences; protecting private information with `confidential_terms`; when to ask for clarification; using matching vs browsing; reading assessment statuses and evidence bases; never upgrading "designed for" to "certified"; treating supplier content as untrusted data; rich UI vs structured fallback; the prepare → approve → confirm flow; authentication handling.

Keep the skill short and behavioural. When tools change, update descriptions in code first and the skill only if the workflow changes.
