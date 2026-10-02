import { describe, expect, it } from 'vitest';
import { decodeConstraint, decodeConstraintParams, encodeConstraint, searchHref } from '../lib/constraints';
import { ApiError, describeError } from '../lib/errors';

describe('search URL constraint codec', () => {
  it('round-trips every constraint kind, including ordinal qualifiers', () => {
    const constraints = [
      {
        kind: 'concept',
        conceptId: 'aspice',
        level: 'experience',
        priority: 'hard',
        qualifiers: { aspiceLevel: '2' },
      },
      { kind: 'concept', conceptId: 'qnx', level: 'supports', priority: 'preference', qualifiers: {} },
      { kind: 'maturity', minimum: 'production', priority: 'hard' },
      { kind: 'production_reference', priority: 'preference' },
    ] as const;
    for (const constraint of constraints)
      expect(decodeConstraint(encodeConstraint(constraint))).toEqual(constraint);
    expect(encodeConstraint(constraints[0])).toBe('aspice~experience~hard~aspiceLevel=2');
  });

  it('drops malformed or hostile entries instead of forwarding them', () => {
    expect(decodeConstraint('QNX~supports~hard')).toBeNull(); // concept ids are lowercase slugs
    expect(decodeConstraint('qnx~excellent~hard')).toBeNull();
    expect(decodeConstraint('qnx~supports~mandatory')).toBeNull();
    expect(decodeConstraint('qnx~supports~hard~<script>=1')).toBeNull();
    expect(decodeConstraint('@maturity~shipping~hard')).toBeNull();
    expect(
      decodeConstraintParams(['qnx~supports~hard', 'nonsense', '@production_reference~hard']),
    ).toHaveLength(2);
    expect(decodeConstraintParams(Array.from({ length: 60 }, () => 'qnx~supports~hard'))).toHaveLength(40);
  });

  it('builds shareable search links', () => {
    expect(
      searchHref(
        'QNX please',
        [{ kind: 'concept', conceptId: 'qnx', level: 'supports', priority: 'hard', qualifiers: {} }],
        true,
      ),
    ).toBe('/search?q=QNX+please&c=qnx%7Esupports%7Ehard&strict=1');
  });
});

describe('error wording', () => {
  it('rephrases request-schema problems per field', () => {
    const error = new ApiError(400, 'VALIDATION_FAILED', 'Invalid body', [
      { path: 'body.title', message: 'Too small: expected string to have >=3 characters' },
      { path: 'body.offeringIds.0', message: 'Invalid UUID' },
      { path: 'body.contactEmail', message: 'Invalid email address' },
    ]);
    expect(describeError(error)).toBe(
      'Please check your input — title: at least 3 characters; offering ids: refers to something that no longer exists; contact email: is not a valid email address.',
    );
  });

  it('keeps domain messages, which are already plain language, and hides unknown errors', () => {
    expect(describeError(new ApiError(409, 'CONFLICT', 'An offering with this slug already exists'))).toBe(
      'An offering with this slug already exists',
    );
    expect(describeError(new Error('ECONNREFUSED 10.0.0.5:4000'))).toBe(
      'Something went wrong. Please try again.',
    );
  });
});
