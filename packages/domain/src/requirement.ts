import { AppError, validationError } from './errors';
import type { ClaimPredicate } from './claims';
import type { ConceptId, OrganizationId, RequirementId, UserId } from './ids';
import type { MaturityLevel } from './offering';
import { normalizeForMatching, sanitizeUntrustedText } from './text';

/**
 * How strongly a concept must be backed. Each level maps to the claim
 * predicates that can satisfy it. This is the rule that prevents
 * "designed for ASIL-B" from ever satisfying "ASIL-B certified".
 */
export const CONSTRAINT_LEVELS = ['mentioned', 'supports', 'experience', 'certified', 'production'] as const;
export type ConstraintLevel = (typeof CONSTRAINT_LEVELS)[number];

export const SATISFYING_PREDICATES: Readonly<Record<ConstraintLevel, readonly ClaimPredicate[]>> = {
  mentioned: [
    'SUPPORTS',
    'IMPLEMENTS',
    'INTEGRATES_WITH',
    'PROVIDES_CAPABILITY',
    'TARGETS_DOMAIN',
    'DESIGNED_FOR',
    'EXPERIENCE_WITH',
    'PROCESS_COMPLIANT',
    'CERTIFIED',
    'PRODUCTION_DEPLOYMENT',
  ],
  supports: [
    'SUPPORTS',
    'IMPLEMENTS',
    'INTEGRATES_WITH',
    'PROVIDES_CAPABILITY',
    'TARGETS_DOMAIN',
    'CERTIFIED',
    'PRODUCTION_DEPLOYMENT',
  ],
  experience: ['EXPERIENCE_WITH', 'PROCESS_COMPLIANT', 'CERTIFIED', 'PRODUCTION_DEPLOYMENT'],
  certified: ['CERTIFIED'],
  production: ['PRODUCTION_DEPLOYMENT'],
};

export const CONSTRAINT_PRIORITIES = ['hard', 'preference'] as const;
export type ConstraintPriority = (typeof CONSTRAINT_PRIORITIES)[number];

export type ConstraintOrigin = 'user' | 'extracted_deterministic' | 'extracted_ai';

export interface ConceptConstraint {
  readonly kind: 'concept';
  readonly id: string;
  readonly conceptId: ConceptId;
  readonly level: ConstraintLevel;
  readonly priority: ConstraintPriority;
  /** Optional qualifiers (e.g. { asil: "B" }). */
  readonly qualifiers: Readonly<Record<string, string>>;
  readonly origin: ConstraintOrigin;
}

export interface MaturityConstraint {
  readonly kind: 'maturity';
  readonly id: string;
  readonly minimum: MaturityLevel;
  readonly priority: ConstraintPriority;
  readonly origin: ConstraintOrigin;
}

export interface ProductionReferenceConstraint {
  readonly kind: 'production_reference';
  readonly id: string;
  readonly priority: ConstraintPriority;
  readonly origin: ConstraintOrigin;
}

export type RequirementConstraint = ConceptConstraint | MaturityConstraint | ProductionReferenceConstraint;

export const REQUIREMENT_VISIBILITIES = ['private', 'shared_with_selected', 'published_anonymized'] as const;
export type RequirementVisibility = (typeof REQUIREMENT_VISIBILITIES)[number];

export const REQUIREMENT_STATUSES = ['draft', 'active', 'closed'] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

/**
 * A buyer's technical requirement. TENANT-PRIVATE by default: title,
 * description and confidential terms never leave the owning organization
 * unless the buyer explicitly discloses a vetted summary.
 */
export interface Requirement {
  readonly id: RequirementId;
  readonly organizationId: OrganizationId;
  readonly title: string;
  readonly description: string;
  readonly constraints: readonly RequirementConstraint[];
  /** Terms (project names, program codes, customers) that must never be disclosed. */
  readonly confidentialTerms: readonly string[];
  readonly visibility: RequirementVisibility;
  readonly status: RequirementStatus;
  readonly createdBy: UserId;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export const MAX_CONSTRAINTS = 40;

export const validateConstraints = (constraints: readonly RequirementConstraint[]): void => {
  const problems: string[] = [];
  if (constraints.length > MAX_CONSTRAINTS) problems.push(`at most ${MAX_CONSTRAINTS} constraints are allowed`);
  const seen = new Set<string>();
  for (const constraint of constraints) {
    const key = constraint.kind === 'concept' ? `concept:${constraint.conceptId}` : constraint.kind;
    if (seen.has(key)) problems.push(`duplicate constraint ${key}`);
    seen.add(key);
  }
  if (problems.length > 0) {
    throw validationError('Invalid requirement constraints', problems.map((message) => ({ message })));
  }
};

export const normalizeConfidentialTerms = (terms: readonly string[]): string[] => {
  const unique = new Map<string, string>();
  for (const term of terms) {
    const trimmed = sanitizeUntrustedText(term, 120);
    const key = normalizeForMatching(trimmed);
    if (key.length >= 2 && !unique.has(key)) unique.set(key, trimmed);
  }
  return [...unique.values()];
};

/** Returns the confidential terms that appear in `text` (normalized, token-aware). */
export const findConfidentialLeaks = (text: string, confidentialTerms: readonly string[]): string[] => {
  const haystack = ` ${normalizeForMatching(text)} `;
  const compact = haystack.replace(/\s+/g, '');
  return confidentialTerms.filter((term) => {
    const needle = normalizeForMatching(term);
    if (needle.length === 0) return false;
    // Token-bounded match, plus a whitespace-insensitive check that catches "Project X7" vs "projectx7".
    return haystack.includes(` ${needle} `) || compact.includes(needle.replace(/\s+/g, ''));
  });
};

/**
 * Guards any text leaving the buyer's tenant. The error intentionally reports
 * only how many terms matched, so the error itself cannot become a leak
 * channel if it is logged or relayed.
 */
export const assertNoConfidentialLeak = (text: string, confidentialTerms: readonly string[]): void => {
  const leaks = findConfidentialLeaks(text, confidentialTerms);
  if (leaks.length > 0) {
    throw new AppError(
      'CONFIDENTIALITY_VIOLATION',
      `Outgoing text contains ${leaks.length} confidential term(s); remove them before sharing`,
    );
  }
};

/**
 * The only representation of a requirement that may be shown to a supplier.
 * It is constructed field-by-field (allow-list), never by copying and
 * deleting fields from the private requirement.
 */
export interface SupplierFacingRequirement {
  readonly reference: string;
  readonly constraints: readonly RequirementConstraint[];
  readonly disclosedSummary: string | null;
}

export const toSupplierFacingRequirement = (
  requirement: Requirement,
  disclosedSummary: string | null,
  reference: string,
): SupplierFacingRequirement => {
  if (disclosedSummary !== null) assertNoConfidentialLeak(disclosedSummary, requirement.confidentialTerms);
  return {
    reference,
    constraints: requirement.constraints,
    disclosedSummary: disclosedSummary === null ? null : sanitizeUntrustedText(disclosedSummary, 2000),
  };
};

/** Anonymized aggregate of buyer demand. Contains no free text and no buyer identity. */
export interface DemandSignal {
  readonly id: string;
  readonly conceptIds: readonly ConceptId[];
  readonly minimumMaturity: MaturityLevel | null;
  readonly createdAt: Date;
}
