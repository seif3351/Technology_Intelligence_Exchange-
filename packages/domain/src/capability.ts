import type { CapabilityId, ConceptId, OrganizationId } from './ids';

/**
 * An organisation-level competency that exists independently of any packaged
 * offering (e.g. "HIL validation engineering"). Technical claims can be made
 * about a capability just as about an offering.
 */
export interface Capability {
  readonly id: CapabilityId;
  readonly organizationId: OrganizationId;
  readonly conceptId: ConceptId;
  readonly name: string;
  readonly description: string;
  readonly status: 'draft' | 'published';
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
