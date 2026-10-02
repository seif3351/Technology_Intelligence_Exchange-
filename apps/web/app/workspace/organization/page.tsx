import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { VerificationBadge } from '@/components/badges';
import { ClaimFields, ClaimList, EvidencePanel } from '@/components/workspace';
import { addClaim, updateOrganization } from '@/lib/actions/workspace';
import { canEdit, loadWorkspace } from '@/lib/workspace';

export const metadata: Metadata = { title: 'Organization profile' };
export const dynamic = 'force-dynamic';

export default async function OrganizationProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org } = await searchParams;
  const { membership, workspace } = await loadWorkspace(org, '/workspace/organization');
  if (!membership || !workspace)
    return (
      <p className="notice">
        You are not a member of a supplier organization yet. <Link href="/onboarding">Set one up</Link>.
      </p>
    );
  const orgId = membership.organizationId;
  const profile = workspace.organization;
  const editable = canEdit(membership.role);
  const claims = workspace.claims.filter((c) => c.subject.type === 'organization');
  const evidence = workspace.evidence.filter((e) => e.offeringId === null);

  return (
    <div className="stack">
      <p className="small">
        <Link href={`/workspace?org=${orgId}`}>← Supplier workspace</Link>
      </p>
      <div className="row">
        <h1 className="flush">{profile.name}</h1>
        <VerificationBadge state={profile.verificationState} />
      </div>
      <p className="small muted">
        This profile and the published claims below appear on your public supplier page
        {profile.verificationState === 'verified' ? '' : ' once your organization is verified'}.
      </p>

      <h2>Profile</h2>
      {editable ? (
        <ActionForm action={updateOrganization} submitLabel="Save profile">
          <input type="hidden" name="orgId" value={orgId} />
          <input type="hidden" name="version" value={String(profile.version)} />
          <div>
            <label htmlFor="org-summary">One-sentence summary</label>
            <textarea
              id="org-summary"
              name="summary"
              required
              minLength={10}
              maxLength={400}
              defaultValue={profile.summary}
            />
          </div>
          <div>
            <label htmlFor="org-description">Description</label>
            <textarea
              id="org-description"
              name="description"
              maxLength={8000}
              defaultValue={profile.description}
            />
          </div>
          <div className="grid2even">
            <div>
              <label htmlFor="org-website">Website (https://)</label>
              <input id="org-website" name="website" type="url" defaultValue={profile.website ?? ''} />
            </div>
            <div>
              <label htmlFor="org-hq">Headquarters country (two letters, e.g. DE)</label>
              <input
                id="org-hq"
                name="headquartersCountry"
                maxLength={2}
                pattern="[A-Za-z]{2}"
                defaultValue={profile.headquartersCountry ?? ''}
              />
            </div>
          </div>
          <div className="grid2even">
            <div>
              <label htmlFor="org-regions">Regions served (comma-separated)</label>
              <input id="org-regions" name="regions" defaultValue={profile.regions.join(', ')} />
            </div>
            <div>
              <label htmlFor="org-size">Employees (e.g. 50-200)</label>
              <input
                id="org-size"
                name="employeeRange"
                maxLength={40}
                defaultValue={profile.employeeRange ?? ''}
              />
            </div>
          </div>
        </ActionForm>
      ) : (
        <p className="untrusted">{profile.summary}</p>
      )}

      <h2>Organization-level claims</h2>
      <p className="small muted">
        Statements about the organization rather than one offering, such as ISO 26262 project experience or an
        Automotive SPICE capability level.
      </p>
      <ClaimList claims={claims} orgId={orgId} evidence={evidence} />
      {editable ? (
        <details className="card">
          <summary>Add an organization-level claim</summary>
          <ActionForm action={addClaim} submitLabel="Add draft claim">
            <input type="hidden" name="orgId" value={orgId} />
            <input type="hidden" name="subjectType" value="organization" />
            <input type="hidden" name="subjectId" value={orgId} />
            <ClaimFields prefix="org-claim" evidence={evidence} />
          </ActionForm>
        </details>
      ) : null}

      <h2>Organization-wide evidence</h2>
      <EvidencePanel orgId={orgId} offeringId={null} evidence={evidence} />
    </div>
  );
}
