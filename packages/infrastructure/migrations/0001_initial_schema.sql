-- Automotive Technology Exchange — initial schema.
-- Canonical domain facts are relational. JSONB is used only where the shape
-- is genuinely flexible (qualifiers, type-specific details, disclosure snapshots).
-- Derived data (search documents, embeddings) lives in separate, rebuildable tables.

CREATE EXTENSION IF NOT EXISTS vector;

-- ------------------------------------------------------------------ ontology
CREATE TABLE ontology_facets (
  id            text PRIMARY KEY,
  label         text NOT NULL,
  description   text NOT NULL,
  default_level text NOT NULL CHECK (default_level IN ('mentioned','supports','experience','certified','production'))
);

CREATE TABLE ontology_concepts (
  id          text PRIMARY KEY CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  facet_id    text NOT NULL REFERENCES ontology_facets(id),
  label       text NOT NULL,
  description text NOT NULL,
  aliases     text[] NOT NULL DEFAULT '{}',
  case_sensitive_aliases text[] NOT NULL DEFAULT '{}',
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','deprecated'))
);

CREATE TABLE ontology_relations (
  from_concept_id text NOT NULL REFERENCES ontology_concepts(id),
  to_concept_id   text NOT NULL REFERENCES ontology_concepts(id),
  type            text NOT NULL CHECK (type IN ('is_a','part_of','uses','related_to')),
  PRIMARY KEY (from_concept_id, to_concept_id, type),
  CHECK (from_concept_id <> to_concept_id)
);
CREATE INDEX ontology_relations_to_idx ON ontology_relations (to_concept_id);

CREATE TABLE ontology_meta (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version   bigint NOT NULL DEFAULT 0
);
INSERT INTO ontology_meta DEFAULT VALUES;

-- ------------------------------------------------------- identity & tenancy
CREATE TABLE users (
  id            uuid PRIMARY KEY,
  email         text NOT NULL UNIQUE CHECK (email = lower(email)),
  display_name  text NOT NULL,
  platform_role text NOT NULL DEFAULT 'none' CHECK (platform_role IN ('none','platform_admin')),
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL
);

CREATE TABLE organizations (
  id                   uuid PRIMARY KEY,
  slug                 text NOT NULL UNIQUE,
  name                 text NOT NULL,
  kind                 text NOT NULL CHECK (kind IN ('supplier','buyer','hybrid','platform')),
  summary              text NOT NULL DEFAULT '',
  description          text NOT NULL DEFAULT '',
  website              text,
  headquarters_country text CHECK (headquarters_country ~ '^[A-Z]{2}$'),
  regions              text[] NOT NULL DEFAULT '{}',
  employee_range       text,
  contact              jsonb NOT NULL DEFAULT '{}',
  verification_state   text NOT NULL CHECK (verification_state IN ('unverified','pending','verified','rejected','suspended')),
  verified_by          uuid REFERENCES users(id),
  verified_at          timestamptz,
  is_demo              boolean NOT NULL DEFAULT false,
  version              integer NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL,
  updated_at           timestamptz NOT NULL,
  search_tsv           tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary,'')), 'B') ||
    setweight(to_tsvector('english', coalesce(description,'')), 'C')
  ) STORED
);
CREATE INDEX organizations_search_idx ON organizations USING gin (search_tsv);
CREATE INDEX organizations_verification_idx ON organizations (verification_state);

CREATE TABLE memberships (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id         uuid NOT NULL REFERENCES users(id),
  role            text NOT NULL CHECK (role IN ('viewer','editor','admin','owner')),
  created_at      timestamptz NOT NULL,
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

-- --------------------------------------------------------------- catalog
CREATE TABLE offerings (
  id              uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  slug            text NOT NULL,
  type            text NOT NULL CHECK (type IN ('product','service','technology_platform')),
  name            text NOT NULL,
  summary         text NOT NULL,
  description     text NOT NULL DEFAULT '',
  maturity        text NOT NULL CHECK (maturity IN ('concept','prototype','pilot','production')),
  details         jsonb NOT NULL,
  commercial      jsonb NOT NULL,
  regions         text[] NOT NULL DEFAULT '{}',
  status          text NOT NULL CHECK (status IN ('draft','in_review','published','archived')),
  is_demo         boolean NOT NULL DEFAULT false,
  published_at    timestamptz,
  published_by    uuid REFERENCES users(id),
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL,
  UNIQUE (organization_id, slug)
);
CREATE INDEX offerings_status_idx ON offerings (status, organization_id);

CREATE TABLE capabilities (
  id              uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  concept_id      text NOT NULL REFERENCES ontology_concepts(id),
  name            text NOT NULL,
  description     text NOT NULL DEFAULT '',
  status          text NOT NULL CHECK (status IN ('draft','published')),
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL
);
CREATE INDEX capabilities_org_idx ON capabilities (organization_id);

CREATE TABLE assets (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organizations(id),
  offering_id       uuid REFERENCES offerings(id),
  kind              text NOT NULL CHECK (kind IN ('video','document','image','transcript')),
  title             text NOT NULL,
  description       text NOT NULL DEFAULT '',
  content_type      text NOT NULL,
  byte_size         bigint,
  storage_key       text UNIQUE,
  external_url      text CHECK (external_url IS NULL OR external_url LIKE 'https://%'),
  sha256            text,
  duration_seconds  integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  thumbnail_url     text CHECK (thumbnail_url IS NULL OR thumbnail_url LIKE 'https://%'),
  visibility        text NOT NULL CHECK (visibility IN ('public','private')),
  processing_state  text NOT NULL CHECK (processing_state IN ('uploaded','scanning','quarantined','processing','ready','failed')),
  extraction_state  text NOT NULL CHECK (extraction_state IN ('not_started','pending','completed','not_supported','failed')),
  failure_reason    text,
  created_by        uuid REFERENCES users(id),
  is_demo           boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL,
  updated_at        timestamptz NOT NULL,
  CHECK (storage_key IS NOT NULL OR external_url IS NOT NULL)
);
CREATE INDEX assets_offering_idx ON assets (offering_id) WHERE visibility = 'public';
CREATE INDEX assets_org_idx ON assets (organization_id);

CREATE TABLE evidence (
  id                  uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES organizations(id),
  offering_id         uuid REFERENCES offerings(id),
  kind                text NOT NULL CHECK (kind IN ('document','video','case_study','public_url','certificate','production_reference')),
  title               text NOT NULL,
  description         text NOT NULL DEFAULT '',
  asset_id            uuid REFERENCES assets(id),
  url                 text CHECK (url IS NULL OR url LIKE 'https://%'),
  provenance_category text NOT NULL,
  source_type         text NOT NULL,
  source_reference    text,
  source_url          text,
  source_version      text,
  license             text,
  visibility          text NOT NULL CHECK (visibility IN ('public','private')),
  customer_disclosure text CHECK (customer_disclosure IN ('named','anonymized')),
  created_by          uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL,
  updated_at          timestamptz NOT NULL
);
CREATE INDEX evidence_offering_idx ON evidence (offering_id);
CREATE INDEX evidence_org_idx ON evidence (organization_id);
CREATE INDEX evidence_asset_idx ON evidence (asset_id);

CREATE TABLE technical_claims (
  id                  uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES organizations(id),
  subject_type        text NOT NULL CHECK (subject_type IN ('organization','offering','capability')),
  subject_id          uuid NOT NULL,
  predicate           text NOT NULL CHECK (predicate IN ('SUPPORTS','IMPLEMENTS','INTEGRATES_WITH','PROVIDES_CAPABILITY','TARGETS_DOMAIN','DESIGNED_FOR','EXPERIENCE_WITH','PROCESS_COMPLIANT','CERTIFIED','PRODUCTION_DEPLOYMENT')),
  concept_id          text NOT NULL REFERENCES ontology_concepts(id),
  qualifiers          jsonb NOT NULL DEFAULT '{}',
  statement           text NOT NULL,
  provenance_category text NOT NULL CHECK (provenance_category IN ('SUPPLIER_VERIFIED','PUBLIC_SOURCE','LICENSED_THIRD_PARTY','INTERNAL','AI_INFERRED','UNVERIFIED')),
  source_type         text NOT NULL,
  source_reference    text,
  source_url          text,
  source_version      text,
  license             text,
  evidence_ids        uuid[] NOT NULL DEFAULT '{}',
  provided_by_org     uuid NOT NULL REFERENCES organizations(id),
  provided_by_user    uuid REFERENCES users(id),
  provided_via        text NOT NULL CHECK (provided_via IN ('manual','ai_extraction','import','seed')),
  verification_status text NOT NULL CHECK (verification_status IN ('unreviewed','platform_verified','disputed','rejected')),
  verified_by         uuid REFERENCES users(id),
  verified_at         timestamptz,
  verification_notes  text,
  confidence          text NOT NULL CHECK (confidence IN ('high','medium','low')),
  status              text NOT NULL CHECK (status IN ('draft','published','retracted')),
  review_at           timestamptz,
  expires_at          timestamptz,
  notes               text,
  version             integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL,
  updated_at          timestamptz NOT NULL,
  -- AI-inferred claims can never be published or verified without human review.
  CHECK (NOT (provenance_category = 'AI_INFERRED' AND status = 'published')),
  CHECK (NOT (verification_status = 'platform_verified' AND cardinality(evidence_ids) = 0))
);
CREATE INDEX claims_subject_idx ON technical_claims (subject_type, subject_id, status);
CREATE INDEX claims_org_idx ON technical_claims (organization_id, status);
CREATE INDEX claims_concept_idx ON technical_claims (concept_id, status);

-- Full history of claim changes: technical claims change over time.
CREATE TABLE claim_revisions (
  claim_id   uuid NOT NULL REFERENCES technical_claims(id),
  version    integer NOT NULL,
  snapshot   jsonb NOT NULL,
  changed_at timestamptz NOT NULL,
  PRIMARY KEY (claim_id, version)
);

-- --------------------------------------------------------------- buyers
-- TENANT-PRIVATE. Every query must filter by organization_id (enforced by repository signatures).
CREATE TABLE requirements (
  id                 uuid PRIMARY KEY,
  organization_id    uuid NOT NULL REFERENCES organizations(id),
  title              text NOT NULL,
  description        text NOT NULL,
  constraints        jsonb NOT NULL DEFAULT '[]',
  confidential_terms text[] NOT NULL DEFAULT '{}',
  visibility         text NOT NULL CHECK (visibility IN ('private','shared_with_selected','published_anonymized')),
  status             text NOT NULL CHECK (status IN ('draft','active','closed')),
  created_by         uuid NOT NULL REFERENCES users(id),
  version            integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL,
  updated_at         timestamptz NOT NULL
);
CREATE INDEX requirements_org_idx ON requirements (organization_id, updated_at DESC);

-- Anonymized demand: concept ids only. requirement_id is kept solely for de-duplication and is never exposed.
CREATE TABLE demand_signals (
  requirement_id   uuid PRIMARY KEY REFERENCES requirements(id),
  concept_ids      text[] NOT NULL,
  minimum_maturity text,
  created_at       timestamptz NOT NULL
);

CREATE TABLE engagement_requests (
  id                       uuid PRIMARY KEY,
  type                     text NOT NULL CHECK (type IN ('demo','workshop','poc','rfi')),
  buyer_organization_id    uuid NOT NULL REFERENCES organizations(id),
  supplier_organization_id uuid NOT NULL REFERENCES organizations(id),
  offering_id              uuid REFERENCES offerings(id),
  requirement_id           uuid REFERENCES requirements(id),
  disclosure               jsonb NOT NULL,
  status                   text NOT NULL CHECK (status IN ('submitted','acknowledged','declined','withdrawn','closed')),
  idempotency_key          text NOT NULL,
  requested_by             uuid NOT NULL REFERENCES users(id),
  confirmed_at             timestamptz NOT NULL,
  created_at               timestamptz NOT NULL,
  updated_at               timestamptz NOT NULL,
  UNIQUE (buyer_organization_id, idempotency_key)
);
CREATE INDEX engagements_supplier_idx ON engagement_requests (supplier_organization_id, created_at DESC);

-- ----------------------------------------------------------------- audit
CREATE TABLE audit_events (
  id              uuid PRIMARY KEY,
  occurred_at     timestamptz NOT NULL,
  actor           jsonb NOT NULL,
  organization_id uuid,
  action          text NOT NULL,
  resource_type   text NOT NULL,
  resource_id     text,
  outcome         text NOT NULL CHECK (outcome IN ('success','denied','failure')),
  request_id      text,
  metadata        jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_org_time_idx ON audit_events (organization_id, occurred_at DESC);
CREATE INDEX audit_action_time_idx ON audit_events (action, occurred_at DESC);

CREATE FUNCTION audit_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;
CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();

-- ------------------------------------------------------------------ jobs
CREATE TABLE jobs (
  id           bigserial PRIMARY KEY,
  type         text NOT NULL,
  payload      jsonb NOT NULL,
  status       text NOT NULL CHECK (status IN ('queued','running','succeeded','failed','dead')),
  attempts     integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  run_at       timestamptz NOT NULL DEFAULT now(),
  locked_at    timestamptz,
  locked_by    text,
  last_error   text,
  dedupe_key   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX jobs_ready_idx ON jobs (run_at, id) WHERE status = 'queued';
CREATE UNIQUE INDEX jobs_dedupe_idx ON jobs (dedupe_key) WHERE status = 'queued' AND dedupe_key IS NOT NULL;

-- ---------------------------------------------------- derived search index
-- Disposable: rebuild with `pnpm --filter @atx/worker reindex`.
CREATE TABLE offering_search_documents (
  offering_id     uuid PRIMARY KEY REFERENCES offerings(id) ON DELETE CASCADE,
  content         text NOT NULL,
  tsv             tsvector NOT NULL,
  embedding       vector,
  embedding_model text,
  content_hash    text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX offering_search_tsv_idx ON offering_search_documents USING gin (tsv);
