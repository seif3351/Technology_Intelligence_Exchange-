import type { Metadata } from 'next';
import { TableScroll } from '@/components/table-scroll';
import { ClaimPredicate, Engagement, Workspace } from '@atx/contracts';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { ActionForm } from '@/components/action-form';
import { MaturityBadge, TrustBadge, VerificationBadge } from '@/components/badges';
import {
  addClaim,
  changeClaim,
  createOffering,
  registerVideo,
  requestVerification,
  respondToEngagement,
  setOfferingStatus,
  uploadDocument,
} from '@/lib/actions/workspace';
import { api, currentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Supplier workspace' };

export const dynamic = 'force-dynamic';

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const me = await currentUser();
  if (!me) redirect('/login?next=/workspace');
  const supplierOrgs = me.memberships.filter((m) => m.organizationKind !== 'buyer');
  if (supplierOrgs.length === 0)
    return (
      <p className="notice">
        You are not a member of a supplier organization yet. <Link href="/onboarding">Set one up</Link>, or
        ask a colleague to invite you to theirs.
      </p>
    );
  const { org } = await searchParams;
  const membership = supplierOrgs.find((m) => m.organizationId === org) ?? supplierOrgs[0]!;
  const orgId = membership.organizationId;
  const workspace = await api(`/v1/organizations/${orgId}/workspace`, { schema: Workspace });
  const { items: incoming } = await api(`/v1/organizations/${orgId}/engagements?direction=incoming`, {
    schema: z.object({ items: z.array(Engagement) }),
  });
  const drafts = workspace.claims.filter((c) => c.status === 'draft');
  const published = workspace.claims.filter((c) => c.status === 'published');
  const offeringName = new Map(workspace.offerings.map((o) => [o.id, o.name]));

  return (
    <div className="stack">
      <div className="row">
        <h1>{workspace.organization.name}</h1>
        <VerificationBadge state={workspace.organization.verificationState} />
        {workspace.organization.verificationState === 'unverified' && membership.role !== 'viewer' ? (
          <form action={requestVerification}>
            <input type="hidden" name="orgId" value={orgId} />
            <button type="submit">Request verification</button>
          </form>
        ) : null}
      </div>
      {supplierOrgs.length > 1 ? (
        <div className="row small">
          Switch organization:{' '}
          {supplierOrgs.map((m) => (
            <Link key={m.organizationId} href={`/workspace?org=${m.organizationId}`}>
              {m.organizationName}
            </Link>
          ))}
        </div>
      ) : null}

      <h2>Incoming requests ({incoming.length})</h2>
      {incoming.length === 0 ? <p className="muted">No demo, workshop, PoC or RFI requests yet.</p> : null}
      {incoming.map((e) => (
        <div key={e.id} className="card stack" data-testid="incoming-request">
          <div className="row">
            <strong>{e.type.toUpperCase()}</strong> from {e.disclosure.buyerOrganizationName}{' '}
            <span className="badge">{e.status}</span>
          </div>
          <div className="small">
            {e.disclosure.contactName} &lt;{e.disclosure.contactEmail}&gt;
          </div>
          <p className="untrusted">{e.disclosure.message}</p>
          {e.disclosure.requirement ? (
            <div className="small muted">
              Shared technical constraints: {e.disclosure.requirement.constraints.length} (reference{' '}
              {e.disclosure.requirement.reference})
            </div>
          ) : null}
          {e.status === 'submitted' ? (
            <div className="grid2">
              <ActionForm action={respondToEngagement} submitLabel="Accept and share contact">
                <input type="hidden" name="orgId" value={orgId} />
                <input type="hidden" name="engagementId" value={e.id} />
                <input type="hidden" name="status" value="acknowledged" />
                <p className="small muted">The buyer will see this contact person and your reply.</p>
                <div>
                  <label htmlFor={`contact-name-${e.id}`}>Contact name</label>
                  <input
                    id={`contact-name-${e.id}`}
                    name="contactName"
                    required
                    defaultValue={me.user.displayName}
                  />
                </div>
                <div>
                  <label htmlFor={`contact-email-${e.id}`}>Contact email</label>
                  <input
                    id={`contact-email-${e.id}`}
                    name="contactEmail"
                    type="email"
                    required
                    defaultValue={me.user.email}
                  />
                </div>
                <div>
                  <label htmlFor={`reply-${e.id}`}>Reply (optional)</label>
                  <textarea id={`reply-${e.id}`} name="message" maxLength={2000} />
                </div>
              </ActionForm>
              <ActionForm action={respondToEngagement} submitLabel="Decline" variant="secondary">
                <input type="hidden" name="orgId" value={orgId} />
                <input type="hidden" name="engagementId" value={e.id} />
                <input type="hidden" name="status" value="declined" />
                <div>
                  <label htmlFor={`decline-${e.id}`}>Note to the buyer (optional)</label>
                  <textarea id={`decline-${e.id}`} name="message" maxLength={2000} />
                </div>
              </ActionForm>
            </div>
          ) : e.supplierResponse ? (
            <div className="small">
              {e.supplierResponse.contactName
                ? `Shared contact: ${e.supplierResponse.contactName} <${e.supplierResponse.contactEmail ?? ''}>`
                : 'Declined'}
              {e.supplierResponse.message ? ` — “${e.supplierResponse.message}”` : ''}
            </div>
          ) : null}
        </div>
      ))}

      <h2>Claims awaiting your review ({drafts.length})</h2>
      <p className="small muted">
        AI-drafted claims are extracted from your uploaded documents. They are never published automatically:
        check the wording and the strength of each claim.
      </p>
      <TableScroll label="Claims awaiting your review (">
        <table>
          <thead>
            <tr>
              <th>Offering</th>
              <th>Claim</th>
              <th>Quoted source</th>
              <th>Origin</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {drafts.map((c) => (
              <tr key={c.id} data-testid="draft-claim">
                <td>{c.subject.type === 'offering' ? offeringName.get(c.subject.id) : 'Organization'}</td>
                <td>
                  {c.predicateLabel} <strong>{c.concept.label}</strong>
                </td>
                <td className="untrusted small">{c.statement}</td>
                <td>
                  <TrustBadge tier={c.trustTier} label={c.trustLabel} />
                </td>
                <td className="row">
                  {(['publish', 'retract'] as const).map((action) => (
                    <form key={action} action={changeClaim}>
                      <input type="hidden" name="orgId" value={orgId} />
                      <input type="hidden" name="claimId" value={c.id} />
                      <input type="hidden" name="version" value={String(c.version)} />
                      <input type="hidden" name="action" value={action} />
                      <button type="submit">{action === 'publish' ? 'Publish' : 'Discard'}</button>
                    </form>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>

      <h2>Offerings</h2>
      <TableScroll label="Offerings">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Maturity</th>
              <th>Status</th>
              <th>Published claims</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {workspace.offerings.map((o) => (
              <tr key={o.id}>
                <td>
                  {o.status === 'published' ? <Link href={`/offerings/${o.id}`}>{o.name}</Link> : o.name}
                </td>
                <td>
                  <MaturityBadge maturity={o.maturity} />
                </td>
                <td>{o.status}</td>
                <td>{published.filter((c) => c.subject.id === o.id).length}</td>
                <td>
                  <ActionForm
                    action={setOfferingStatus}
                    submitLabel={o.status === 'published' ? 'Unpublish' : 'Publish'}
                    className="row"
                  >
                    <input type="hidden" name="orgId" value={orgId} />
                    <input type="hidden" name="offeringId" value={o.id} />
                    <input type="hidden" name="version" value={String(o.version)} />
                    <input
                      type="hidden"
                      name="status"
                      value={o.status === 'published' ? 'draft' : 'published'}
                    />
                  </ActionForm>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>

      <div className="grid2">
        <section className="card">
          <h3>Upload technical documentation</h3>
          <p className="small muted">
            PDF, text, Markdown or HTML up to 50 MB. Files are scanned, text is extracted and claims are
            drafted for your review.
          </p>
          <ActionForm action={uploadDocument} submitLabel="Upload">
            <input type="hidden" name="orgId" value={orgId} />
            <OfferingSelect offerings={workspace.offerings} optional />
            <div>
              <label htmlFor="doc-title">Title</label>
              <input id="doc-title" name="title" />
            </div>
            <input
              type="file"
              name="file"
              accept=".pdf,.txt,.md,.html,application/pdf,text/plain,text/markdown,text/html"
              required
            />
          </ActionForm>
        </section>
        <section className="card">
          <h3>New offering</h3>
          <ActionForm action={createOffering} submitLabel="Create draft">
            <input type="hidden" name="orgId" value={orgId} />
            <input name="name" placeholder="Name" required aria-label="Name" />
            <input
              name="slug"
              placeholder="url-slug"
              required
              aria-label="Slug"
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
            />
            <select name="type" aria-label="Type" defaultValue="product">
              <option value="product">Product</option>
              <option value="service">Service</option>
              <option value="technology_platform">Technology platform</option>
            </select>
            <select name="maturity" aria-label="Maturity" defaultValue="pilot">
              {['concept', 'prototype', 'pilot', 'production'].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <textarea
              name="summary"
              placeholder="One-sentence technical summary"
              required
              aria-label="Summary"
            />
            <input type="hidden" name="description" value="" />
          </ActionForm>
        </section>
      </div>

      <div className="grid2">
        <section className="card">
          <h3>Add a technical claim</h3>
          <ActionForm action={addClaim} submitLabel="Add draft claim">
            <input type="hidden" name="orgId" value={orgId} />
            <OfferingSelect offerings={workspace.offerings} />
            <select name="predicate" aria-label="Claim type" defaultValue="SUPPORTS">
              {ClaimPredicate.options.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <input
              name="conceptId"
              placeholder="Concept id, e.g. qnx (see Technologies)"
              required
              aria-label="Concept id"
            />
            <input name="asil" placeholder="ASIL (optional: QM, A–D)" aria-label="ASIL" />
            <textarea
              name="statement"
              placeholder="Statement exactly as you can support it"
              required
              aria-label="Statement"
            />
            <input name="sourceUrl" placeholder="https:// source (optional)" aria-label="Source URL" />
          </ActionForm>
        </section>
        <section className="card">
          <h3>Register a demo video</h3>
          <ActionForm action={registerVideo} submitLabel="Register video">
            <input type="hidden" name="orgId" value={orgId} />
            <OfferingSelect offerings={workspace.offerings} />
            <input name="title" placeholder="Title" required aria-label="Video title" />
            <input name="url" placeholder="https://… (hosted video)" required aria-label="Video URL" />
            <input
              name="durationSeconds"
              type="number"
              min={0}
              placeholder="Duration (s)"
              aria-label="Duration"
            />
            <textarea
              name="description"
              placeholder="What does the demo show?"
              aria-label="Video description"
            />
          </ActionForm>
        </section>
      </div>

      <h2>Uploaded assets</h2>
      <TableScroll label="Uploaded assets">
        <table>
          <tbody>
            {workspace.assets.map((a) => (
              <tr key={a.id}>
                <td>{a.title}</td>
                <td className="small">{a.contentType}</td>
                <td>
                  <span
                    className={`badge ${a.processingState === 'quarantined' || a.processingState === 'failed' ? 'tone-bad' : ''}`}
                  >
                    {a.processingState}
                  </span>
                </td>
                <td className="small muted">{a.failureReason ?? a.extractionState}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </div>
  );
}

function OfferingSelect({
  offerings,
  optional = false,
}: {
  offerings: readonly { id: string; name: string }[];
  optional?: boolean;
}) {
  return (
    <select name="offeringId" aria-label="Offering" required={!optional} defaultValue="">
      <option value="" disabled={!optional}>
        {optional ? 'Organization-wide (no offering)' : 'Select offering'}
      </option>
      {offerings.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}
