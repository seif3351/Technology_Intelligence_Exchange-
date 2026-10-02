import {
  ASSET_PROCESSING_STATES,
  CLAIM_PREDICATES,
  CLAIM_STATUSES,
  EVIDENCE_KINDS,
  EXTRACTION_STATES,
  OFFERING_STATUSES,
  describePredicate,
} from '@atx/domain';
import {
  ASSET_STATE_LABEL,
  CLAIM_PREDICATE_OPTIONS,
  CLAIM_STATUS_LABEL,
  EVIDENCE_KIND_LABEL,
  EXTRACTION_STATE_LABEL,
  OFFERING_STATUS_LABEL,
} from '@atx/ui';
import { describe, expect, it } from 'vitest';

/**
 * The web app may not import the domain, so its presentation vocabulary
 * (@atx/ui) is checked against the domain here: every value has a label, and
 * claim-strength labels say exactly what the domain says.
 */
describe('presentation vocabulary matches the domain', () => {
  it('offers every claim predicate once, with the domain wording', () => {
    expect(CLAIM_PREDICATE_OPTIONS.map((option) => option.value).sort()).toEqual(
      [...CLAIM_PREDICATES].sort(),
    );
    for (const option of CLAIM_PREDICATE_OPTIONS)
      expect(option.label, option.value).toBe(describePredicate(option.value as never));
  });

  it.each([
    ['claim statuses', CLAIM_STATUSES, CLAIM_STATUS_LABEL],
    ['offering statuses', OFFERING_STATUSES, OFFERING_STATUS_LABEL],
    ['evidence kinds', EVIDENCE_KINDS, EVIDENCE_KIND_LABEL],
    ['asset processing states', ASSET_PROCESSING_STATES, ASSET_STATE_LABEL],
    ['extraction states', EXTRACTION_STATES, EXTRACTION_STATE_LABEL],
  ])('labels all %s', (_name, values, labels) => {
    expect(values.filter((value) => !(value in labels))).toEqual([]);
  });
});
