import { OFFERING_STATUS_LABEL } from '@atx/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { MaturityBadge, VerificationBadge } from '@/components/badges';
import { ClaimFields, ClaimList, EvidencePanel } from '@/components/workspace';
import { addClaim, setOfferingStatus, updateOffering } from '@/lib/actions/workspace';
import { canEdit, loadWorkspace } from '@/lib/workspace';

export const metadata: Metadata = { title: 'Edit offering' };
export const dynamic = 'force-dynamic';

const commercialText = (value: unknown): string => (typeof value === 'string' ? value : '');
const commercialList = (value: unknown): string => (Array.isArray(value) ? value.join(', ') : '');

export default async function OfferingEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ org?: string; created?: string }>;
}) {
  const { id } = await params;
  const { org, created } = await searchParams;
  const { membership, workspace } = await loadWorkspace(org, `/workspace/offerings/${id}`);
  const offering = workspace?.offerings.find((o) => o.id === id);
  if (!membership || !workspace || !offering) notFound();
  const orgId = membership.organizationId;
  const editable = canEdit(membership.role);
  const claims = workspace.claims.filter((c) => c.subject.type === 'offering' && c.subject.id === id);
  // Claims of this offering may cite its own evidence or organization-wide evidence.
  const evidence = workspace.evidence.filter((e) => e.offeringId === id || e.offeringId === null);
  const isPublished = offering.status === 'published';
  const visibility = editable ? (
    <section className="card stack">
      <h2 className="flush">{isPublished ? 'Public visibility' : 'Publish'}</h2>
      <ActionForm
        action={setOfferingStatus}
        submitLabel={isPublished ? 'Withdraw from public view' : 'Publish offering'}
        variant={isPublished ? 'secondary' : 'primary'}
      >
        <input type="hidden" name="orgId" value={orgId} />
        <input type="hidden" name="offeringId" value={offering.id} />
        <input type="hidden" name="version" value={String(offering.version)} />
        <input type="hidden" name="status" value={isPublished ? 'draft' : 'published'} />
        {isPublished ? (
          <label className="row plain small">
            <input type="checkbox" required className="inline-check" /> Buyers will no longer find this
            offering; requests already sent are kept.
          </label>
        ) : (
          <p className="small muted flush">
            Publishing lists the offering and its published claims for buyers (once your organization is
            verified). Draft claims stay private.
          </p>
        )}
      </ActionForm>
    </section>
  ) : null;

  return (
    <div className="stack">
      <p className="small">
        <Link href={`/workspace?org=${orgId}`}>← Supplier workspace</Link>
      </p>
      <div className="row spread">
        <div className="row">
          <h1 className="flush">{offering.name}</h1>
          <MaturityBadge maturity={offering.maturity} />
          <span className="badge">{OFFERING_STATUS_LABEL[offering.status] ?? offering.status}</span>
        </div>
        {isPublished ? <Link href={`/offerings/${offering.id}`}>View public page</Link> : null}
      </div>
      {created ? (
        <p className="success" role="status">
          Draft offering created. Add claims below, then publish it when it is ready.
        </p>
      ) : null}
      {isPublished && workspace.organization.verificationState !== 'verified' ? (
        <p className="notice">
          Published, but buyers see it only after your organization is verified{' '}
          <VerificationBadge state={workspace.organization.verificationState} />.
        </p>
      ) : null}

      {!isPublished ? visibility : null}

      <h2>Details</h2>
      {editable ? (
        <ActionForm action={updateOffering} submitLabel="Save details">
          <input type="hidden" name="orgId" value={orgId} />
          <input type="hidden" name="offeringId" value={offering.id} />
          <input type="hidden" name="version" value={String(offering.version)} />
          <div className="grid2even">
            <div>
              <label htmlFor="off-name">Name</label>
              <input
                id="off-name"
                name="name"
                required
                minLength={2}
                maxLength={160}
                defaultValue={offering.name}
              />
            </div>
            <div>
              <label htmlFor="off-maturity">Maturity</label>
              <select id="off-maturity" name="maturity" defaultValue={offering.maturity}>
                <option value="concept">Concept</option>
                <option value="prototype">Prototype</option>
                <option value="pilot">Pilot</option>
                <option value="production">Production</option>
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="off-summary">One-sentence technical summary</label>
            <textarea
              id="off-summary"
              name="summary"
              required
              minLength={10}
              maxLength={400}
              defaultValue={offering.summary}
            />
          </div>
          <div>
            <label htmlFor="off-description">Description</label>
            <textarea
              id="off-description"
              name="description"
              maxLength={8000}
              defaultValue={offering.description}
            />
          </div>
          <div className="grid2even">
            <div>
              <label htmlFor="off-regions">Regions (comma-separated, e.g. EU, NA)</label>
              <input id="off-regions" name="regions" defaultValue={offering.regions.join(', ')} />
            </div>
            <div>
              <label htmlFor="off-pricing">Pricing model (optional)</label>
              <input
                id="off-pricing"
                name="pricingModel"
                maxLength={120}
                defaultValue={commercialText(offering.commercial['pricingModel'])}
              />
            </div>
          </div>
          <div className="grid2even">
            <div>
              <label htmlFor="off-availability">Availability (comma-separated, optional)</label>
              <input
                id="off-availability"
                name="availability"
                defaultValue={commercialList(offering.commercial['availability'])}
              />
            </div>
            <div>
              <label htmlFor="off-notes">Commercial notes (optional)</label>
              <input
                id="off-notes"
                name="commercialNotes"
                maxLength={500}
                defaultValue={commercialText(offering.commercial['notes'])}
              />
            </div>
          </div>
        </ActionForm>
      ) : (
        <div className="stack">
          <p className="untrusted">{offering.summary}</p>
          <p className="untrusted muted">{offering.description}</p>
        </div>
      )}

      <h2>Technical claims</h2>
      <ClaimList claims={claims} orgId={orgId} evidence={evidence} />
      {editable ? (
        <details className="card" open={claims.length === 0}>
          <summary>Add a technical claim</summary>
          <ActionForm action={addClaim} submitLabel="Add draft claim">
            <input type="hidden" name="orgId" value={orgId} />
            <input type="hidden" name="subjectType" value="offering" />
            <input type="hidden" name="subjectId" value={offering.id} />
            <ClaimFields prefix="new-claim" evidence={evidence} />
          </ActionForm>
        </details>
      ) : null}

      <h2>Evidence</h2>
      <EvidencePanel orgId={orgId} offeringId={offering.id} evidence={evidence} />
      {isPublished ? visibility : null}
    </div>
  );
}
