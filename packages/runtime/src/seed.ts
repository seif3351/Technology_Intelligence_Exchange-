import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { type Repositories, type RequirementExtractor, type TenantScope, redact } from '@atx/application';
import { scryptPasswordHasher } from '@atx/auth';
import {
  type Asset,
  type ClaimPredicate,
  type Evidence,
  type EvidenceKind,
  type Offering,
  type Organization,
  type ProvenanceCategory,
  type Ontology,
  type TechnicalClaim,
  asId,
  createClaim,
  normalizeConfidentialTerms,
  publishClaim,
  verifyClaim,
} from '@atx/domain';
import { loadOntologyFromDirectory } from '@atx/infrastructure';
import { parse } from 'yaml';
import type { Runtime } from './index';

/** Deterministic UUID (v5-style layout) so re-seeding is idempotent and references are stable. */
export const stableUuid = (name: string): string => {
  const hex = createHash('sha256').update(`atx-demo:${name}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
};

export const DEMO_PASSWORD = 'demo-password-2026';

interface SeedClaim {
  concept: string;
  predicate: ClaimPredicate;
  statement: string;
  qualifiers?: Record<string, string>;
  evidence?: string[];
  verification?: 'platform_verified';
  status?: 'draft';
  provenance?: ProvenanceCategory;
  source_url?: string;
}
interface SeedEvidence {
  key: string;
  kind: EvidenceKind;
  title: string;
  description: string;
  url?: string;
  source_reference?: string;
  customer_disclosure?: 'named' | 'anonymized';
}
interface SeedOffering {
  key: string;
  slug: string;
  type: Offering['type'];
  name: string;
  maturity: Offering['maturity'];
  summary: string;
  description: string;
  details: Offering['details'];
  commercial: Offering['commercial'];
  evidence?: SeedEvidence[];
  videos?: { title: string; description: string; url: string; duration_seconds: number }[];
  claims?: SeedClaim[];
}
interface SeedOrganization {
  key: string;
  slug: string;
  name: string;
  kind: Organization['kind'];
  owner: string;
  country: string;
  regions: string[];
  employee_range: string;
  website: string;
  verification: Organization['verificationState'];
  summary: string;
  description: string;
  claims?: SeedClaim[];
  evidence?: SeedEvidence[];
  capabilities?: { concept: string; name: string; description: string }[];
  offerings?: SeedOffering[];
  requirements?: { title: string; description: string; confidential_terms: string[] }[];
}
interface SeedFile {
  users: { key: string; email: string; display_name: string; platform_role?: 'platform_admin' }[];
  organizations: SeedOrganization[];
}

export const seedOntology = async (runtime: Runtime, directory: string): Promise<void> => {
  await runtime.app.deps.ontology.replace(await loadOntologyFromDirectory(directory));
};

/**
 * Loads the synthetic demo dataset. Organizations that already exist (by
 * slug) are skipped, so the command is safe to re-run.
 */
export const seedDemoData = async (
  runtime: Runtime,
  file: string,
): Promise<{ organizations: number; offerings: number; claims: number }> => {
  const data = parse(await readFile(file, 'utf8')) as SeedFile;
  const now = new Date('2026-09-01T00:00:00Z');
  const counts = { organizations: 0, offerings: 0, claims: 0 };
  const admin = asId<'UserId'>(stableUuid('user:admin'));
  const passwordHash = await scryptPasswordHasher.hash(DEMO_PASSWORD);
  const ontology = await runtime.app.deps.ontology.current();
  const extractor = runtime.app.deps.requirementExtractor;

  await runtime.app.deps.transaction(async (repos) => {
    for (const user of data.users) {
      if (await repos.users.findCredentialByEmail(user.email)) continue;
      await repos.users.insert(
        {
          id: asId(stableUuid(`user:${user.key}`)),
          email: user.email,
          displayName: user.display_name,
          platformRole: user.platform_role ?? 'none',
          termsVersion: null,
          termsAcceptedAt: null,
          createdAt: now,
        },
        passwordHash,
      );
    }
    for (const org of data.organizations) {
      if (await repos.organizations.findBySlug(org.slug)) continue;
      await seedOrganization(repos, org, now, admin, counts, { ontology, extractor });
      counts.organizations += 1;
    }
  });
  await runtime.app.indexing.reindexAll();
  return counts;
};

const seedOrganization = async (
  repos: Repositories,
  org: SeedOrganization,
  now: Date,
  admin: ReturnType<typeof asId<'UserId'>>,
  counts: { offerings: number; claims: number },
  interpretation: { readonly ontology: Ontology; readonly extractor: RequirementExtractor },
): Promise<void> => {
  const organizationId = asId<'OrganizationId'>(stableUuid(`org:${org.key}`));
  const owner = asId<'UserId'>(stableUuid(`user:${org.owner}`));
  const scope = { organizationId, role: 'system' } as TenantScope;
  await repos.organizations.insert({
    id: organizationId,
    slug: org.slug,
    name: org.name,
    kind: org.kind,
    summary: org.summary,
    description: org.description.trim(),
    website: org.website,
    headquartersCountry: org.country,
    regions: org.regions,
    employeeRange: org.employee_range,
    contact: { name: null, email: null, url: org.website },
    verificationState: org.verification,
    verifiedBy: org.verification === 'verified' ? admin : null,
    verifiedAt: org.verification === 'verified' ? now : null,
    isDemo: true,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
  await repos.users.addMembership({ organizationId, userId: owner, role: 'owner', createdAt: now });

  const evidenceIds = new Map<string, string>();
  const insertEvidence = async (items: SeedEvidence[] | undefined, offeringId: string | null) => {
    for (const item of items ?? []) {
      const id = stableUuid(`evidence:${org.key}:${item.key}`);
      evidenceIds.set(item.key, id);
      const evidence: Evidence = {
        id: asId(id),
        organizationId,
        offeringId: offeringId ? asId(offeringId) : null,
        kind: item.kind,
        title: item.title,
        description: item.description,
        assetId: null,
        url: item.url ?? null,
        provenance: {
          category: 'SUPPLIER_VERIFIED',
          sourceType:
            item.kind === 'certificate'
              ? 'certificate'
              : item.kind === 'case_study'
                ? 'case_study'
                : item.url
                  ? 'public_url'
                  : 'supplier_statement',
          sourceReference: item.source_reference ?? null,
          sourceUrl: item.url ?? null,
          sourceVersion: null,
          license: null,
          evidenceIds: [],
        },
        visibility: 'public',
        customerDisclosure: item.customer_disclosure ?? null,
        createdBy: owner,
        createdAt: now,
        updatedAt: now,
      };
      await repos.evidence.insert(scope, evidence);
    }
  };

  const insertClaims = async (
    items: SeedClaim[] | undefined,
    subject: TechnicalClaim['subject'],
    prefix: string,
  ) => {
    for (const [index, item] of (items ?? []).entries()) {
      const category = item.provenance ?? 'SUPPLIER_VERIFIED';
      let claim = createClaim({
        id: asId(stableUuid(`claim:${prefix}:${index}`)),
        organizationId,
        subject,
        predicate: item.predicate,
        conceptId: asId(item.concept),
        qualifiers: item.qualifiers ?? {},
        statement: item.statement,
        provenance: {
          category,
          sourceType: item.source_url
            ? 'public_url'
            : category === 'AI_INFERRED'
              ? 'document'
              : 'supplier_statement',
          sourceReference: null,
          sourceUrl: item.source_url ?? null,
          sourceVersion: null,
          license: null,
          evidenceIds: (item.evidence ?? []).map((key) => {
            const id = evidenceIds.get(key);
            if (!id) throw new Error(`Seed claim references unknown evidence ${key}`);
            return asId<'EvidenceId'>(id);
          }),
        },
        providedBy: {
          organizationId,
          userId: category === 'AI_INFERRED' ? null : owner,
          via: category === 'AI_INFERRED' ? 'ai_extraction' : 'seed',
        },
        now,
      });
      if (item.status !== 'draft') claim = publishClaim(claim, owner, now);
      if (item.verification === 'platform_verified')
        claim = verifyClaim(claim, admin, 'platform_verified', 'Synthetic demo verification', now);
      await repos.claims.insert(scope, claim);
      counts.claims += 1;
    }
  };

  await insertEvidence(org.evidence, null);
  await insertClaims(org.claims, { type: 'organization', id: organizationId }, `${org.key}:org`);
  for (const [index, capability] of (org.capabilities ?? []).entries()) {
    await repos.capabilities.insert(scope, {
      id: asId(stableUuid(`capability:${org.key}:${index}`)),
      organizationId,
      conceptId: asId(capability.concept),
      name: capability.name,
      description: capability.description,
      status: 'published',
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  for (const item of org.offerings ?? []) {
    const offeringId = asId<'OfferingId'>(stableUuid(`offering:${org.key}:${item.key}`));
    await repos.offerings.insert(scope, {
      id: offeringId,
      organizationId,
      slug: item.slug,
      type: item.type,
      name: item.name,
      summary: item.summary,
      description: item.description.trim(),
      maturity: item.maturity,
      details: item.details,
      commercial: item.commercial,
      regions: org.regions,
      status: 'published',
      isDemo: true,
      publishedAt: now,
      publishedBy: owner,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    counts.offerings += 1;
    await insertEvidence(item.evidence, offeringId);
    for (const [index, video] of (item.videos ?? []).entries()) {
      const asset: Asset = {
        id: asId(stableUuid(`asset:${org.key}:${item.key}:${index}`)),
        organizationId,
        offeringId,
        kind: 'video',
        title: video.title,
        description: video.description,
        contentType: 'video/external',
        byteSize: null,
        storageKey: null,
        externalUrl: video.url,
        sha256: null,
        durationSeconds: video.duration_seconds,
        thumbnailUrl: null,
        visibility: 'public',
        processingState: 'ready',
        extractionState: 'not_supported',
        failureReason: null,
        createdBy: owner,
        isDemo: true,
        createdAt: now,
        updatedAt: now,
      };
      await repos.assets.insert(scope, asset);
      await repos.evidence.insert(scope, {
        id: asId(stableUuid(`evidence:${org.key}:${item.key}:video:${index}`)),
        organizationId,
        offeringId,
        kind: 'video',
        title: video.title,
        description: video.description,
        assetId: asset.id,
        url: video.url,
        provenance: {
          category: 'SUPPLIER_VERIFIED',
          sourceType: 'video',
          sourceReference: video.title,
          sourceUrl: video.url,
          sourceVersion: null,
          license: null,
          evidenceIds: [],
        },
        visibility: 'public',
        customerDisclosure: null,
        createdBy: owner,
        createdAt: now,
        updatedAt: now,
      });
    }
    await insertClaims(item.claims, { type: 'offering', id: offeringId }, `${org.key}:${item.key}`);
  }

  for (const [index, requirement] of (org.requirements ?? []).entries()) {
    const confidentialTerms = normalizeConfidentialTerms(requirement.confidential_terms);
    const { constraints } = await interpretation.extractor.extract(
      redact(requirement.description, confidentialTerms),
      interpretation.ontology,
    );
    await repos.requirements.insert(scope, {
      id: asId(stableUuid(`requirement:${org.key}:${index}`)),
      organizationId,
      title: requirement.title,
      description: requirement.description.trim(),
      constraints,
      confidentialTerms,
      visibility: 'private',
      status: 'draft',
      createdBy: owner,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  }
};
