# ADR-0014: Organization membership administration

## Context

Pilot organizations have several people. ADR-0012 introduced one invitation entity for platform and organization invitations; this ADR defines how organization invitations and member administration behave.

## Decision

- Organization admins (role ≥ admin, verified email) invite by email with a role. Domain rule `canManageMember`: an actor can grant or change roles only up to their own role, and only owners can grant, change or remove the owner role.
- New people join by registering with the invitation link (membership granted in the registration transaction). Existing users accept while signed in (`POST /v1/invitations/accept`); the invitation email must equal the account email. Accepting never downgrades an existing membership and proves the email address.
- `leavesOrganizationWithoutOwner`: the last owner can neither be demoted nor removed nor leave.
- Members can leave on their own. Role changes and removals take effect on the next request (memberships are resolved per request).
- All changes are audited (`membership.*`, `invitation.*`); member lists and invitations are tenant-private (cross-tenant access → 403/404).

## Consequences

Organizations self-administer without platform involvement. Ownership transfer is "make another owner, then leave".
