import 'server-only';
import { Workspace } from '@atx/contracts';
import { redirect } from 'next/navigation';
import { api, currentUser } from './api';

/**
 * Resolves the supplier organization a workspace page works on (the `org`
 * parameter or the user's first supplier organization) and loads it. The API
 * authorizes every read; this only picks which organization to ask for.
 */
export const loadWorkspace = async (orgParam: string | undefined, nextPath: string) => {
  const me = await currentUser();
  if (!me) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  const supplierOrgs = me.memberships.filter((m) => m.organizationKind !== 'buyer');
  const membership = supplierOrgs.find((m) => m.organizationId === orgParam) ?? supplierOrgs[0];
  if (!membership) return { me, supplierOrgs, membership: null, workspace: null } as const;
  const workspace = await api(`/v1/organizations/${membership.organizationId}/workspace`, {
    schema: Workspace,
  });
  return { me, supplierOrgs, membership, workspace } as const;
};

/** Viewers can read the workspace; editors and above change it. */
export const canEdit = (role: string): boolean => role !== 'viewer';
