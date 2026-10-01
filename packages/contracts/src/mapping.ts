import { type RequirementConstraint, asId } from '@atx/domain';
import type { ConstraintInputT } from './inputs';

/** Converts validated wire constraints into domain constraints with stable ids. */
export const toDomainConstraints = (inputs: readonly ConstraintInputT[] | undefined): RequirementConstraint[] | undefined =>
  inputs?.map((input, index): RequirementConstraint => {
    const id = `c${index + 1}`;
    switch (input.kind) {
      case 'concept':
        return { kind: 'concept', id, conceptId: asId(input.conceptId), level: input.level, priority: input.priority, qualifiers: input.qualifiers, origin: 'user' };
      case 'maturity':
        return { kind: 'maturity', id, minimum: input.minimum, priority: input.priority, origin: 'user' };
      case 'production_reference':
        return { kind: 'production_reference', id, priority: input.priority, origin: 'user' };
    }
  });
