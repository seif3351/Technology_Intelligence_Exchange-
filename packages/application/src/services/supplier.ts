import {
  type Capability,
  type ClaimPredicate,
  type ClaimQualifiers,
  type ClaimSubject,
  type CommercialModel,
  type OfferingDetails,
  type Offering,
  type OfferingInput,
  type Organization,
  type OrganizationKind,
  type Provenance,
  type ProvenanceCategory,
  type SourceType,
  type TechnicalClaim,
  asId,
  conflict,
  createClaim,
  invariant,
  newId,
  normalizeOfferingInput,
  notFound,
  publishClaim,
  retractClaim,
  reviseClaim,
  sanitizeProfileText,
  sanitizeUntrustedText,
  slugify,
  transitionOffering,
  transitionOrganizationVerification,
  validateOrganizationProfile,
  validationError,
} from '@atx/domain';
import type { ApplicationDeps } from '../deps';
import { authorizeTenant, requireUser, requireVerifiedEmail } from '../policies';
import type { RequestContext, TenantScope } from '../principal';
import { presentClaim, presentEvidence } from '../views';
import {
  assertMayEditPublicContent,
  ownedClaim,
  ownedOffering,
  safeExternalUrl,
  supplierWriteScope,
} from './supplier-access';
import { recordAudit } from './support';

export interface ClaimInput {
  readonly subject: { readonly type: 'organization' | 'offering' | 'capability'; readonly id: string };
  readonly predicate: ClaimPredicate;
  readonly conceptId: string;
  readonly qualifiers?: ClaimQualifiers;
  readonly statement: string;
  readonly provenanceCategory?: Extract<
    ProvenanceCategory,
    'SUPPLIER_VERIFIED' | 'PUBLIC_SOURCE' | 'UNVERIFIED'
  >;
  readonly sourceType?: SourceType;
  readonly sourceUrl?: string | null;
  readonly sourceReference?: string | null;
  readonly sourceVersion?: string | null;
  readonly evidenceIds?: readonly string[];
  readonly reviewAt?: string | null;
  readonly expiresAt?: string | null;
}

/** Supplier workspace use cases. Every method authorizes the tenant first. */
export class SupplierService {
  constructor(private readonly deps: ApplicationDeps) {}

  // --------------------------------------------------------- organizations

  async createOrganization(
    ctx: RequestContext,
    input: {
      readonly name: string;
      readonly kind: Exclude<OrganizationKind, 'platform'>;
      readonly summary: string;
      readonly website?: string | null;
      readonly headquartersCountry?: string | null;
    },
  ): Promise<Organization> {
    const user = requireVerifiedEmail(ctx.principal);
    const now = this.deps.clock.now();
    const website = input.website ? safeExternalUrl(input.website, 'website') : null;
    const organization: Organization = {
      id: newId(),
      slug: slugify(input.name),
      name: sanitizeUntrustedText(input.name, 160),
      kind: input.kind,
      summary: sanitizeProfileText(input.summary, 400),
      description: '',
      website,
      headquartersCountry: input.headquartersCountry ?? null,
      regions: [],
      employeeRange: null,
      contact: { name: null, email: null, url: null },
      verificationState: 'unverified',
      verifiedBy: null,
      verifiedAt: null,
      isDemo: false,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    validateOrganizationProfile(organization);
    await this.deps.transaction(async (repos) => {
      if (await repos.organizations.findBySlug(organization.slug))
        throw conflict('An organization with this name already exists');
      await repos.organizations.insert(organization);
      await repos.users.addMembership({
        organizationId: organization.id,
        userId: user.userId,
        role: 'owner',
        createdAt: now,
      });
      await recordAudit(repos.audit, ctx, now, {
        action: 'organization.create',
        resourceType: 'organization',
        resourceId: organization.id,
        organizationId: organization.id,
      });
    });
    return organization;
  }

  async updateOrganizationProfile(
    ctx: RequestContext,
    organizationId: string,
    input: {
      readonly expectedVersion: number;
      readonly summary?: string;
      readonly description?: string;
      readonly website?: string | null;
      readonly headquartersCountry?: string | null;
      readonly regions?: readonly string[];
      readonly employeeRange?: string | null;
      readonly contactEmail?: string | null;
    },
  ): Promise<Organization> {
    const scope = supplierWriteScope(ctx, organizationId, 'admin');
    const now = this.deps.clock.now();
    return this.deps.transaction(async (repos) => {
      const current = await repos.organizations.findById(scope.organizationId);
      if (!current) throw notFound('Organization');
      const next: Organization = {
        ...current,
        summary: input.summary !== undefined ? sanitizeProfileText(input.summary, 400) : current.summary,
        description:
          input.description !== undefined
            ? sanitizeProfileText(input.description, 8000)
            : current.description,
        website:
          input.website !== undefined
            ? input.website
              ? safeExternalUrl(input.website, 'website')
              : null
            : current.website,
        headquartersCountry:
          input.headquartersCountry !== undefined ? input.headquartersCountry : current.headquartersCountry,
        regions: input.regions
          ? input.regions.map((region) => sanitizeUntrustedText(region, 60))
          : current.regions,
        employeeRange: input.employeeRange !== undefined ? input.employeeRange : current.employeeRange,
        contact:
          input.contactEmail !== undefined
            ? { ...current.contact, email: input.contactEmail }
            : current.contact,
        version: current.version + 1,
        updatedAt: now,
      };
      validateOrganizationProfile(next);
      await repos.organizations.update(next, input.expectedVersion);
      await recordAudit(repos.audit, ctx, now, {
        action: 'organization.update',
        resourceType: 'organization',
        resourceId: next.id,
        organizationId: next.id,
      });
      return next;
    });
  }

  async requestVerification(ctx: RequestContext, organizationId: string): Promise<Organization> {
    const scope = supplierWriteScope(ctx, organizationId, 'admin');
    const user = requireUser(ctx.principal);
    const now = this.deps.clock.now();
    return this.deps.transaction(async (repos) => {
      const current = await repos.organizations.findById(scope.organizationId);
      if (!current) throw notFound('Organization');
      const next = transitionOrganizationVerification(current, 'pending', user.userId, now);
      await repos.organizations.update(next, current.version);
      await recordAudit(repos.audit, ctx, now, {
        action: 'organization.verification_requested',
        resourceType: 'organization',
        resourceId: next.id,
        organizationId: next.id,
      });
      return next;
    });
  }

  // ------------------------------------------------------------- offerings

  async listWorkspace(ctx: RequestContext, organizationId: string) {
    const scope = authorizeTenant(ctx, asId(organizationId), 'viewer');
    const ontology = await this.deps.ontology.current();
    const [organization, offerings, claims, evidence, assets, capabilities] = await Promise.all([
      this.deps.repos.organizations.findById(scope.organizationId),
      this.deps.repos.offerings.listForTenant(scope),
      this.deps.repos.claims.listForTenant(scope, {}),
      this.deps.repos.evidence.listForTenant(scope),
      this.deps.repos.assets.listForTenant(scope),
      this.deps.repos.capabilities.listForTenant(scope),
    ]);
    if (!organization) throw notFound('Organization');
    return {
      organization,
      offerings,
      claims: claims.map((claim) => presentClaim(claim, ontology)),
      evidence: evidence.map(presentEvidence),
      assets,
      capabilities,
    };
  }

  async createOffering(ctx: RequestContext, organizationId: string, input: OfferingInput): Promise<Offering> {
    const scope = supplierWriteScope(ctx, organizationId);
    const now = this.deps.clock.now();
    const normalized = normalizeOfferingInput(input);
    const offering: Offering = {
      id: newId(),
      organizationId: scope.organizationId,
      ...normalized,
      status: 'draft',
      isDemo: false,
      publishedAt: null,
      publishedBy: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.transaction(async (repos) => {
      const existing = await repos.offerings.listForTenant(scope);
      if (existing.some((other) => other.slug === offering.slug))
        throw conflict('An offering with this slug already exists');
      await repos.offerings.insert(scope, offering);
      await recordAudit(repos.audit, ctx, now, {
        action: 'offering.create',
        resourceType: 'offering',
        resourceId: offering.id,
        organizationId: scope.organizationId,
      });
    });
    return offering;
  }

  async updateOffering(
    ctx: RequestContext,
    organizationId: string,
    offeringId: string,
    input: Partial<Omit<OfferingInput, 'slug' | 'type'>> & {
      readonly expectedVersion: number;
      readonly details?: OfferingDetails;
      readonly commercial?: CommercialModel;
    },
  ): Promise<Offering> {
    const scope = supplierWriteScope(ctx, organizationId);
    const now = this.deps.clock.now();
    const offering = await this.deps.transaction(async (repos) => {
      const current = await ownedOffering(repos.offerings.findById(asId(offeringId)), scope);
      assertMayEditPublicContent(ctx, current.status === 'published');
      const normalized = normalizeOfferingInput({
        slug: current.slug,
        type: current.type,
        name: input.name ?? current.name,
        summary: input.summary ?? current.summary,
        description: input.description ?? current.description,
        maturity: input.maturity ?? current.maturity,
        details: input.details ?? current.details,
        commercial: input.commercial ?? current.commercial,
        regions: input.regions ?? current.regions,
      });
      const next: Offering = { ...current, ...normalized, version: current.version + 1, updatedAt: now };
      await repos.offerings.update(scope, next, input.expectedVersion);
      await recordAudit(repos.audit, ctx, now, {
        action: 'offering.update',
        resourceType: 'offering',
        resourceId: next.id,
        organizationId: scope.organizationId,
      });
      return next;
    });
    if (offering.status === 'published')
      await this.deps.jobs.enqueue(
        'offering.reindex',
        { offeringId: offering.id },
        { dedupeKey: `reindex:${offering.id}` },
      );
    return offering;
  }

  /**
   * Explicit human publication. An offering needs at least one published
   * technical claim so that it is discoverable through structured matching.
   */
  async setOfferingStatus(
    ctx: RequestContext,
    organizationId: string,
    offeringId: string,
    status: 'published' | 'draft' | 'archived',
    expectedVersion: number,
  ): Promise<Offering> {
    const scope = supplierWriteScope(ctx, organizationId);
    const user = requireUser(ctx.principal);
    const now = this.deps.clock.now();
    const offering = await this.deps.transaction(async (repos) => {
      const current = await ownedOffering(repos.offerings.findById(asId(offeringId)), scope);
      if (status === 'published') {
        const claims = await repos.claims.listForTenant(scope, {
          offeringId: current.id,
          status: 'published',
        });
        if (claims.length === 0)
          throw invariant('Publish at least one technical claim before publishing the offering');
      }
      const next = transitionOffering(current, status, user.userId, now);
      await repos.offerings.update(scope, next, expectedVersion);
      await recordAudit(repos.audit, ctx, now, {
        action: `offering.${status}`,
        resourceType: 'offering',
        resourceId: next.id,
        organizationId: scope.organizationId,
      });
      return next;
    });
    await this.deps.jobs.enqueue(
      'offering.reindex',
      { offeringId: offering.id },
      { dedupeKey: `reindex:${offering.id}` },
    );
    return offering;
  }

  async createCapability(
    ctx: RequestContext,
    organizationId: string,
    input: { readonly conceptId: string; readonly name: string; readonly description: string },
  ): Promise<Capability> {
    const scope = supplierWriteScope(ctx, organizationId);
    const ontology = await this.deps.ontology.current();
    if (!ontology.hasConcept(input.conceptId)) throw validationError(`Unknown concept "${input.conceptId}"`);
    const now = this.deps.clock.now();
    const capability: Capability = {
      id: newId(),
      organizationId: scope.organizationId,
      conceptId: asId(input.conceptId),
      name: sanitizeUntrustedText(input.name, 160),
      description: sanitizeUntrustedText(input.description, 2000),
      status: 'published',
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.transaction(async (repos) => {
      await repos.capabilities.insert(scope, capability);
      await recordAudit(repos.audit, ctx, now, {
        action: 'capability.create',
        resourceType: 'capability',
        resourceId: capability.id,
        organizationId: scope.organizationId,
      });
    });
    return capability;
  }

  // ---------------------------------------------------------------- claims

  async addClaim(ctx: RequestContext, organizationId: string, input: ClaimInput) {
    const scope = supplierWriteScope(ctx, organizationId);
    const user = requireUser(ctx.principal);
    const ontology = await this.deps.ontology.current();
    if (!ontology.hasConcept(input.conceptId)) throw validationError(`Unknown concept "${input.conceptId}"`);
    const now = this.deps.clock.now();
    const subject = await this.ownedSubject(scope, input.subject);
    const evidenceIds = await this.ownedEvidenceIds(scope, input.evidenceIds ?? []);
    const claim = createClaim({
      id: newId(),
      organizationId: scope.organizationId,
      subject,
      predicate: input.predicate,
      conceptId: asId(input.conceptId),
      qualifiers: input.qualifiers ?? {},
      statement: input.statement,
      provenance: this.provenance(input, evidenceIds),
      providedBy: { organizationId: scope.organizationId, userId: user.userId, via: 'manual' },
      reviewAt: input.reviewAt ? new Date(input.reviewAt) : null,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      now,
    });
    await this.deps.transaction(async (repos) => {
      await repos.claims.insert(scope, claim);
      await recordAudit(repos.audit, ctx, now, {
        action: 'claim.create',
        resourceType: 'claim',
        resourceId: claim.id,
        organizationId: scope.organizationId,
      });
    });
    return presentClaim(claim, ontology);
  }

  async reviseClaim(
    ctx: RequestContext,
    organizationId: string,
    claimId: string,
    input: Partial<ClaimInput> & { readonly expectedVersion: number },
  ) {
    const scope = supplierWriteScope(ctx, organizationId);
    const ontology = await this.deps.ontology.current();
    if (input.conceptId && !ontology.hasConcept(input.conceptId))
      throw validationError(`Unknown concept "${input.conceptId}"`);
    const now = this.deps.clock.now();
    const evidenceIds = input.evidenceIds ? await this.ownedEvidenceIds(scope, input.evidenceIds) : undefined;
    const revised = await this.deps.transaction(async (repos) => {
      const current = await ownedClaim(this.deps.repos.claims, scope, claimId);
      assertMayEditPublicContent(ctx, current.status === 'published');
      const next = reviseClaim(
        current,
        {
          predicate: input.predicate,
          conceptId: input.conceptId ? asId(input.conceptId) : undefined,
          qualifiers: input.qualifiers,
          statement: input.statement,
          provenance:
            input.provenanceCategory || input.sourceUrl !== undefined || evidenceIds
              ? this.provenance(
                  {
                    ...input,
                    provenanceCategory:
                      input.provenanceCategory ??
                      (current.provenance.category as ClaimInput['provenanceCategory']),
                  },
                  evidenceIds ?? current.provenance.evidenceIds,
                )
              : undefined,
        },
        now,
      );
      await repos.claims.update(scope, next, input.expectedVersion);
      await recordAudit(repos.audit, ctx, now, {
        action: 'claim.revise',
        resourceType: 'claim',
        resourceId: next.id,
        organizationId: scope.organizationId,
      });
      return next;
    });
    await this.reindexSubject(revised.subject);
    return presentClaim(revised, ontology);
  }

  /** Human review step: publishes a draft (including AI-extracted drafts) as a supplier statement. */
  async publishClaim(ctx: RequestContext, organizationId: string, claimId: string, expectedVersion: number) {
    return this.changeClaim(
      ctx,
      organizationId,
      claimId,
      expectedVersion,
      'claim.publish',
      (claim, userId, now) => publishClaim(claim, userId, now),
    );
  }

  async retractClaim(ctx: RequestContext, organizationId: string, claimId: string, expectedVersion: number) {
    return this.changeClaim(
      ctx,
      organizationId,
      claimId,
      expectedVersion,
      'claim.retract',
      (claim, _userId, now) => retractClaim(claim, now),
    );
  }

  // -------------------------------------------------------- evidence/assets

  // --------------------------------------------------------------- helpers

  private async ownedSubject(scope: TenantScope, subject: ClaimInput['subject']): Promise<ClaimSubject> {
    switch (subject.type) {
      case 'organization':
        if (subject.id !== scope.organizationId) throw notFound('Organization');
        return { type: 'organization', id: scope.organizationId };
      case 'offering': {
        const offering = await ownedOffering(this.deps.repos.offerings.findById(asId(subject.id)), scope);
        return { type: 'offering', id: offering.id };
      }
      case 'capability': {
        const capabilities = await this.deps.repos.capabilities.listForTenant(scope);
        const capability = capabilities.find((c) => c.id === subject.id);
        if (!capability) throw notFound('Capability');
        return { type: 'capability', id: capability.id };
      }
    }
  }

  private async ownedEvidenceIds(scope: TenantScope, ids: readonly string[]) {
    if (ids.length === 0) return [];
    const evidence = await this.deps.repos.evidence.findManyByIds(ids.map((id) => asId<'EvidenceId'>(id)));
    if (
      evidence.length !== new Set(ids).size ||
      evidence.some((item) => item.organizationId !== scope.organizationId)
    ) {
      throw notFound('Evidence');
    }
    return evidence.map((item) => item.id);
  }

  private provenance(
    input: Pick<
      ClaimInput,
      'provenanceCategory' | 'sourceType' | 'sourceUrl' | 'sourceReference' | 'sourceVersion'
    >,
    evidenceIds: Provenance['evidenceIds'],
  ): Provenance {
    const url = input.sourceUrl ? safeExternalUrl(input.sourceUrl, 'sourceUrl') : null;
    return {
      category: input.provenanceCategory ?? 'SUPPLIER_VERIFIED',
      sourceType: input.sourceType ?? (url ? 'public_url' : 'supplier_statement'),
      sourceReference: input.sourceReference ? sanitizeUntrustedText(input.sourceReference, 300) : null,
      sourceUrl: url,
      sourceVersion: input.sourceVersion ? sanitizeUntrustedText(input.sourceVersion, 60) : null,
      license: null,
      evidenceIds,
    };
  }

  private async changeClaim(
    ctx: RequestContext,
    organizationId: string,
    claimId: string,
    expectedVersion: number,
    action: string,
    change: (
      claim: TechnicalClaim,
      userId: ReturnType<typeof requireUser>['userId'],
      now: Date,
    ) => TechnicalClaim,
  ) {
    const scope = supplierWriteScope(ctx, organizationId);
    const user = requireUser(ctx.principal);
    const ontology = await this.deps.ontology.current();
    const now = this.deps.clock.now();
    const next = await this.deps.transaction(async (repos) => {
      const current = await ownedClaim(this.deps.repos.claims, scope, claimId);
      const updated = change(current, user.userId, now);
      await repos.claims.update(scope, updated, expectedVersion);
      await recordAudit(repos.audit, ctx, now, {
        action,
        resourceType: 'claim',
        resourceId: updated.id,
        organizationId: scope.organizationId,
        metadata: { via: current.providedBy.via, provenance: updated.provenance.category },
      });
      return updated;
    });
    await this.reindexSubject(next.subject);
    return presentClaim(next, ontology);
  }

  private async reindexSubject(subject: ClaimSubject): Promise<void> {
    if (subject.type === 'offering') {
      await this.deps.jobs.enqueue(
        'offering.reindex',
        { offeringId: subject.id },
        { dedupeKey: `reindex:${subject.id}` },
      );
    }
  }
}
