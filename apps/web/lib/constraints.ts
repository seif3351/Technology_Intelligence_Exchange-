import type { ConstraintInputT, Interpretation } from '@atx/contracts';
import type { z } from 'zod';

/**
 * Refined search constraints travel in the URL as repeated `c` parameters so
 * that every refinement is a plain, shareable link (no client state):
 *   concept:              qnx~supports~hard            aspice~experience~hard~aspiceLevel=2
 *   maturity:             @maturity~production~hard
 *   production reference: @production_reference~hard
 * Malformed entries are dropped; the API validates concept ids and values.
 */
type ConstraintView = z.infer<typeof Interpretation>['constraints'][number];

const LEVELS = new Set(['mentioned', 'supports', 'experience', 'certified', 'production']);
const MATURITIES = new Set(['concept', 'prototype', 'pilot', 'production']);
const PRIORITIES = new Set(['hard', 'preference']);
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const QUALIFIER = /^([a-zA-Z][a-zA-Z0-9_]{0,40})=([A-Za-z0-9.-]{1,20})$/;
export const MAX_URL_CONSTRAINTS = 40;

export const encodeConstraint = (constraint: ConstraintInputT): string => {
  switch (constraint.kind) {
    case 'maturity':
      return `@maturity~${constraint.minimum}~${constraint.priority}`;
    case 'production_reference':
      return `@production_reference~${constraint.priority}`;
    case 'concept': {
      const qualifiers = Object.entries(constraint.qualifiers ?? {}).map(([key, value]) => `${key}=${value}`);
      return [constraint.conceptId, constraint.level, constraint.priority, ...qualifiers].join('~');
    }
  }
};

export const decodeConstraint = (raw: string): ConstraintInputT | null => {
  const parts = raw.split('~');
  const [head, second, third, ...rest] = parts;
  if (head === '@maturity')
    return second && MATURITIES.has(second) && third && PRIORITIES.has(third)
      ? { kind: 'maturity', minimum: second as never, priority: third as 'hard' | 'preference' }
      : null;
  if (head === '@production_reference')
    return second && PRIORITIES.has(second)
      ? { kind: 'production_reference', priority: second as 'hard' | 'preference' }
      : null;
  if (!head || !SLUG.test(head) || !second || !LEVELS.has(second) || !third || !PRIORITIES.has(third))
    return null;
  const qualifiers: Record<string, string> = {};
  for (const entry of rest) {
    const match = QUALIFIER.exec(entry);
    if (!match?.[1] || !match[2]) return null;
    qualifiers[match[1]] = match[2];
  }
  return {
    kind: 'concept',
    conceptId: head,
    level: second as never,
    priority: third as 'hard' | 'preference',
    qualifiers,
  };
};

/** Decodes the `c` search parameter (string or repeated). */
export const decodeConstraintParams = (value: string | string[] | undefined): ConstraintInputT[] =>
  (Array.isArray(value) ? value : value ? [value] : [])
    .slice(0, MAX_URL_CONSTRAINTS)
    .map(decodeConstraint)
    .filter((constraint): constraint is ConstraintInputT => constraint !== null);

/** The interpretation's constraints as editable inputs (what the user currently sees). */
export const fromInterpretation = (constraints: readonly ConstraintView[]): ConstraintInputT[] =>
  constraints.flatMap((c): ConstraintInputT[] => {
    const priority = c.priority === 'preference' ? 'preference' : 'hard';
    if (c.kind === 'maturity' && c.minimumMaturity)
      return [{ kind: 'maturity', minimum: c.minimumMaturity as never, priority }];
    if (c.kind === 'production_reference') return [{ kind: 'production_reference', priority }];
    if (c.kind === 'concept' && c.concept && c.level)
      return [
        {
          kind: 'concept',
          conceptId: c.concept.id,
          level: c.level as never,
          priority,
          qualifiers: { ...c.qualifiers },
        },
      ];
    return [];
  });

/** `/search?...` with the given text, constraints and strict flag. */
export const searchHref = (
  q: string,
  constraints: readonly ConstraintInputT[] | null,
  strict: boolean,
  path = '/search',
): string => {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  for (const constraint of constraints ?? []) params.append('c', encodeConstraint(constraint));
  if (strict) params.set('strict', '1');
  return `${path}?${params.toString()}`;
};
