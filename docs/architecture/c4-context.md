# C4 — System context

```mermaid
C4Context
  title Automotive Technology Exchange — system context
  Person(buyer, "Buyer engineer", "OEM / Tier-1 engineering team")
  Person(supplier, "Supplier representative", "Technology supplier or engineering-service provider")
  Person(admin, "Platform administrator", "Verification, moderation, taxonomy")
  System_Ext(agent, "AI agent host", "Claude, ChatGPT, IDE agents… via MCP")
  System(atx, "Automotive Technology Exchange", "Evidence-backed technical discovery and matchmaking")
  System_Ext(idp, "OIDC / OAuth authorization server", "Production identity provider")
  System_Ext(llm, "LLM provider", "Anthropic (optional)")
  System_Ext(emb, "Embedding provider", "OpenAI-compatible (optional)")
  System_Ext(s3, "Object storage", "S3-compatible")
  System_Ext(av, "Malware scanner", "ClamAV (optional)")

  Rel(buyer, atx, "Searches, compares, manages private requirements, requests demos", "HTTPS")
  Rel(supplier, atx, "Publishes offerings, claims, evidence, videos", "HTTPS")
  Rel(admin, atx, "Verifies and moderates", "HTTPS")
  Rel(agent, atx, "Discovery & matching tools, skill, MCP Apps", "MCP 2026-07-28")
  Rel(atx, idp, "Validates tokens (JWKS)")
  Rel(atx, llm, "Structured extraction (redacted, delimited input)")
  Rel(atx, emb, "Embeddings")
  Rel(atx, s3, "Assets")
  Rel(atx, av, "Scans uploads")
```

Trust boundaries: everything supplier-authored (profiles, claims, documents, transcripts, video metadata) is untrusted data; buyer requirements are tenant-private; tokens are audience-bound per resource.
