import { createHash } from 'node:crypto';
import {
  AppError,
  type ConceptId,
  type Requirement,
  type RequirementConstraint,
  asId,
  findConfidentialLeaks,
  newId,
  normalizeConfidentialTerms,
  notFound,
  sanitizeUntrustedText,
  validateConstraints,
} from '@atx/domain';
import type { ApplicationDeps } from '../deps';
import { authorizeTenant, requireScope, requireUser } from '../policies';
import type { RequestContext } from '../principal';
import { type ConstraintView, presentConstraint } from '../views';
import { redact } from './matching';
import { recordAudit } from './support';

export interface RequirementView {
  readonly id: string;
  readonly organizationId: string;
  readonly title: string;
  readonly description: string;
  readonly constraints: readonly ConstraintView[];
  readonly confidentialTermCount: number;
  readonly visibility: string;
  readonly status: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ValidationIssue {
  readonly severity: 'error' | 'warning' | 'info';
  readonly code: string;
  readonly message: string;
}

export interface RequirementDraftInput {
  readonly title: string;
  readonly description: string;
  readonly constraints?: readonly RequirementConstraint[] | null;
  readonly confidentialTerms?: readonly string[];
}

/**
 * Buyer requirement workflow. Requirements are TENANT-PRIVATE: every read
 * and write is authorized against the buyer organization and audited.
 */
export class RequirementService {
  constructor(private readonly deps: ApplicationDeps) {}

  async createDraft(ctx: RequestContext, organizationId: string, input: RequirementDraftInput): Promise<{ requirement: RequirementView; issues: ValidationIssue[] }> {
    requireScope(ctx.principal, 'requirements:write');
    const scope = authorizeTenant(ctx, asId(organizationId), 'editor');
    const user = requireUser(ctx.principal);
    const ontology = await this.deps.ontology.current();
    const confidentialTerms = normalizeConfidentialTerms(input.confidentialTerms ?? []);
    const constraints = input.constraints?.length
      ? input.constraints
      : // Confidential terms are redacted before interpretation (which may use an external AI provider).
        (await this.deps.requirementExtractor.extract(redact(input.description, confidentialTerms), ontology)).constraints;
    validateConstraints(constraints);
    const now = this.deps.clock.now();
    const requirement: Requirement = {
      id: newId(),
      organizationId: scope.organizationId,
      title: sanitizeUntrustedText(input.title, 200),
      description: sanitizeUntrustedText(input.description, 8000),
      constraints,
      confidentialTerms,
      visibility: 'private',
      status: 'draft',
      createdBy: user.userId,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.transaction(async (repos) => {
      await repos.requirements.insert(scope, requirement);
      await recordAudit(repos.audit, ctx, now, {
        action: 'requirement.create',
        resourceType: 'requirement',
        resourceId: requirement.id,
        organizationId: scope.organizationId,
        metadata: { constraintCount: constraints.length, confidentialTermCount: confidentialTerms.length },
      });
    });
    return { requirement: this.view(requirement, ontology), issues: this.structuralIssues(requirement.constraints) };
  }

  async update(
    ctx: RequestContext,
    organizationId: string,
    requirementId: string,
    input: Partial<RequirementDraftInput> & { readonly expectedVersion: number; readonly status?: 'draft' | 'active' | 'closed' },
  ): Promise<RequirementView> {
    requireScope(ctx.principal, 'requirements:write');
    const scope = authorizeTenant(ctx, asId(organizationId), 'editor');
    const ontology = await this.deps.ontology.current();
    const now = this.deps.clock.now();
    return this.deps.transaction(async (repos) => {
      const current = await repos.requirements.findById(scope, asId(requirementId));
      if (!current) throw notFound('Requirement');
      if (input.constraints) validateConstraints(input.constraints);
      const next: Requirement = {
        ...current,
        title: input.title !== undefined ? sanitizeUntrustedText(input.title, 200) : current.title,
        description: input.description !== undefined ? sanitizeUntrustedText(input.description, 8000) : current.description,
        constraints: input.constraints ?? current.constraints,
        confidentialTerms: input.confidentialTerms ? normalizeConfidentialTerms(input.confidentialTerms) : current.confidentialTerms,
        status: input.status ?? current.status,
        version: current.version + 1,
        updatedAt: now,
      };
      await repos.requirements.update(scope, next, input.expectedVersion);
      await recordAudit(repos.audit, ctx, now, { action: 'requirement.update', resourceType: 'requirement', resourceId: next.id, organizationId: scope.organizationId });
      return this.view(next, ontology);
    });
  }

  async get(ctx: RequestContext, organizationId: string, requirementId: string): Promise<{ requirement: RequirementView; confidentialTerms: readonly string[] }> {
    requireScope(ctx.principal, 'requirements:read');
    const scope = authorizeTenant(ctx, asId(organizationId), 'viewer');
    const ontology = await this.deps.ontology.current();
    const requirement = await this.deps.repos.requirements.findById(scope, asId(requirementId));
    await recordAudit(this.deps.repos.audit, ctx, this.deps.clock.now(), {
      action: 'requirement.read',
      resourceType: 'requirement',
      resourceId: requirementId,
      organizationId: scope.organizationId,
      outcome: requirement ? 'success' : 'failure',
    });
    if (!requirement) throw notFound('Requirement');
    return { requirement: this.view(requirement, ontology), confidentialTerms: requirement.confidentialTerms };
  }

  async list(ctx: RequestContext, organizationId: string): Promise<RequirementView[]> {
    requireScope(ctx.principal, 'requirements:read');
    const scope = authorizeTenant(ctx, asId(organizationId), 'viewer');
    const ontology = await this.deps.ontology.current();
    const requirements = await this.deps.repos.requirements.listForTenant(scope);
    await recordAudit(this.deps.repos.audit, ctx, this.deps.clock.now(), {
      action: 'requirement.list',
      resourceType: 'requirement',
      resourceId: null,
      organizationId: scope.organizationId,
      metadata: { count: requirements.length },
    });
    return requirements.map((requirement) => this.view(requirement, ontology));
  }

  /**
   * Stateless validation of a requirement draft: unknown concepts, missing
   * hard constraints, ambiguous terms and confidential-term exposure.
   */
  async validate(ctx: RequestContext, input: RequirementDraftInput): Promise<{ valid: boolean; issues: ValidationIssue[]; constraints: ConstraintView[]; unrecognizedTerms: readonly string[] }> {
    const ontology = await this.deps.ontology.current();
    const confidentialTerms = normalizeConfidentialTerms(input.confidentialTerms ?? []);
    const interpretation = input.constraints?.length
      ? { constraints: input.constraints, unrecognizedTerms: [] as string[] }
      : await this.deps.requirementExtractor.extract(redact(input.description, confidentialTerms), ontology);
    const issues: ValidationIssue[] = [];
    try {
      validateConstraints(interpretation.constraints);
    } catch (error) {
      if (error instanceof AppError) issues.push(...error.details.map((d) => ({ severity: 'error' as const, code: 'invalid_constraints', message: d.message })));
    }
    for (const constraint of interpretation.constraints) {
      if (constraint.kind === 'concept' && !ontology.hasConcept(constraint.conceptId)) {
        issues.push({ severity: 'error', code: 'unknown_concept', message: `Unknown concept "${constraint.conceptId}"` });
      }
    }
    issues.push(...this.structuralIssues(interpretation.constraints));
    for (const term of interpretation.unrecognizedTerms) {
      issues.push({ severity: 'info', code: 'unrecognized_term', message: `"${term}" is not in the technology ontology; it will only be used for text search.` });
    }
    if (confidentialTerms.length > 0 && findConfidentialLeaks(input.title, confidentialTerms).length > 0) {
      issues.push({ severity: 'info', code: 'confidential_in_title', message: 'The title contains confidential terms. It stays private, but it will never be shareable with suppliers.' });
    }
    return {
      valid: !issues.some((issue) => issue.severity === 'error'),
      issues,
      constraints: interpretation.constraints.map((constraint) => presentConstraint(constraint, ontology)),
      unrecognizedTerms: interpretation.unrecognizedTerms,
    };
  }

  /**
   * Consequential: publishes an ANONYMIZED demand signal (concept ids and
   * maturity only — no text, no buyer identity). Requires an explicit
   * confirmation token from `preparePublication`.
   */
  async preparePublication(ctx: RequestContext, organizationId: string, requirementId: string) {
    this.assertActionsEnabled();
    requireScope(ctx.principal, 'requirements:write');
    const scope = authorizeTenant(ctx, asId(organizationId), 'admin');
    const user = requireUser(ctx.principal);
    const requirement = await this.deps.repos.requirements.findById(scope, asId(requirementId));
    if (!requirement) throw notFound('Requirement');
    const disclosure = this.demandSignalDisclosure(requirement);
    const { token, expiresAt } = await this.deps.confirmations.issue(
      { userId: user.userId, organizationId: scope.organizationId, action: 'requirement.publish_anonymized', digest: digest({ requirementId, disclosure }) },
      600,
    );
    return { disclosure, confirmationToken: token, expiresAt: expiresAt.toISOString() };
  }

  async confirmPublication(ctx: RequestContext, organizationId: string, requirementId: string, confirmationToken: string) {
    this.assertActionsEnabled();
    requireScope(ctx.principal, 'requirements:write');
    const scope = authorizeTenant(ctx, asId(organizationId), 'admin');
    const user = requireUser(ctx.principal);
    const now = this.deps.clock.now();
    return this.deps.transaction(async (repos) => {
      const requirement = await repos.requirements.findById(scope, asId(requirementId));
      if (!requirement) throw notFound('Requirement');
      const disclosure = this.demandSignalDisclosure(requirement);
      const claims = await this.deps.confirmations.verify(confirmationToken);
      if (
        claims.userId !== user.userId ||
        claims.organizationId !== scope.organizationId ||
        claims.action !== 'requirement.publish_anonymized' ||
        claims.digest !== digest({ requirementId, disclosure })
      ) {
        throw new AppError('CONFIRMATION_REQUIRED', 'Confirmation does not match the current requirement; prepare again');
      }
      await repos.requirements.recordDemandSignal(scope, requirement.id, disclosure.conceptIds as ConceptId[], disclosure.minimumMaturity);
      const next: Requirement = { ...requirement, visibility: 'published_anonymized', version: requirement.version + 1, updatedAt: now };
      await repos.requirements.update(scope, next, requirement.version);
      await recordAudit(repos.audit, ctx, now, { action: 'requirement.publish_anonymized', resourceType: 'requirement', resourceId: requirement.id, organizationId: scope.organizationId });
      return { published: true, disclosure };
    });
  }

  private demandSignalDisclosure(requirement: Requirement) {
    return {
      conceptIds: requirement.constraints.flatMap((c) => (c.kind === 'concept' ? [c.conceptId] : [])).sort(),
      minimumMaturity: requirement.constraints.find((c) => c.kind === 'maturity')?.minimum ?? null,
      sharedFields: ['concept ids', 'minimum maturity'],
      notShared: ['title', 'description', 'confidential terms', 'organization identity'],
    };
  }

  private structuralIssues(constraints: readonly RequirementConstraint[]): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (constraints.length === 0) {
      issues.push({ severity: 'warning', code: 'no_constraints', message: 'No structured constraints were identified; matching will rely on text relevance only.' });
    } else if (!constraints.some((c) => c.priority === 'hard')) {
      issues.push({ severity: 'warning', code: 'no_hard_constraints', message: 'All constraints are preferences; consider marking must-haves as hard constraints.' });
    }
    if (constraints.filter((c) => c.priority === 'hard').length > 12) {
      issues.push({ severity: 'warning', code: 'many_hard_constraints', message: 'More than 12 hard constraints may exclude viable candidates; consider preferences.' });
    }
    return issues;
  }

  private assertActionsEnabled(): void {
    if (!this.deps.features.engagementActions) throw new AppError('FEATURE_DISABLED', 'Consequential buyer actions are disabled on this deployment');
  }

  private view(requirement: Requirement, ontology: Awaited<ReturnType<ApplicationDeps['ontology']['current']>>): RequirementView {
    return {
      id: requirement.id,
      organizationId: requirement.organizationId,
      title: requirement.title,
      description: requirement.description,
      constraints: requirement.constraints.map((constraint) => presentConstraint(constraint, ontology)),
      confidentialTermCount: requirement.confidentialTerms.length,
      visibility: requirement.visibility,
      status: requirement.status,
      version: requirement.version,
      createdAt: requirement.createdAt.toISOString(),
      updatedAt: requirement.updatedAt.toISOString(),
    };
  }
}

/** Canonical JSON digest used to bind confirmations to exactly what the user reviewed. */
export const digest = (value: unknown): string => createHash('sha256').update(canonicalJson(value)).digest('hex');

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
};
