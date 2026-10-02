import { Engagement } from '@atx/contracts';
import { ASSET_STATE_LABEL, EXTRACTION_STATE_LABEL, OFFERING_STATUS_LABEL } from '@atx/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { ActionForm } from '@/components/action-form';
import { MaturityBadge, VerificationBadge } from '@/components/badges';
import { TableScroll } from '@/components/table-scroll';
import { ClaimList } from '@/components/workspace';
import {
  createOffering,
  registerVideo,
  requestVerification,
  respondToEngagement,
  uploadDocument,
} from '@/lib/actions/workspace';
import { api } from '@/lib/api';
import { canEdit, loadWorkspace } from '@/lib/workspace';

export const metadata: Metadata = { title: 'Supplier workspace' };
export const dynamic = 'force-dynamic';

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const { org } = await searchParams;
  const { me, supplierOrgs, membership, workspace } = await loadWorkspace(org, '/workspace');
  if (!membership || !workspace)
    return (
      <p className="notice">
        You are not a member of a supplier organization yet. <Link href="/onboarding">Set one up</Link>, or
        ask a colleague to invite you to theirs.
      </p>
    );
  const orgId = membership.organizationId;
  const editable = canEdit(membership.role);
  const { items: incoming } = await api(`/v1/organizations/${orgId}/engagements?direction=incoming`, {
    schema: z.object({ items: z.array(Engagement) }),
  });
  const drafts = workspace.claims.filter((c) => c.status === 'draft');
  const offeringName = new Map(workspace.offerings.map((o) => [o.id, o.name]));
  const count = (offeringId: string, status: string) =>
    workspace.claims.filter((c) => c.subject.id === offeringId && c.status === status).length;
  const q = `?org=${orgId}`;

  return (
    <div className="stack">
      <div className="row spread">
        <div className="row">
          <h1 className="flush">{workspace.organization.name}</h1>
          <VerificationBadge state={workspace.organization.verificationState} />
        </div>
        <nav className="row" aria-label="Workspace">
          <Link href={`/workspace/organization${q}`}>Organization profile &amp; claims</Link>
          <Link href={`/members${q}`}>Members</Link>
        </nav>
      </div>
      {workspace.organization.verificationState !== 'verified' ? (
        <div className="notice row spread">
          <span>
            Your published content becomes visible to buyers once the platform has verified your organization.
          </span>
          {workspace.organization.verificationState === 'unverified' && editable ? (
            <form action={requestVerification}>
              <input type="hidden" name="orgId" value={orgId} />
              <button type="submit">Request verification</button>
            </form>
          ) : null}
        </div>
      ) : null}
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
          {e.status === 'submitted' && editable ? (
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

      <h2>Drafts to review ({drafts.length})</h2>
      <p className="small muted">
        Claims drafted by you, your colleagues, AI from your uploaded documents, or your AI agent. Nothing is
        published automatically: check the wording and the strength of each claim.
      </p>
      {drafts.length === 0 ? (
        <p className="muted">Nothing to review.</p>
      ) : (
        [...new Set(drafts.map((c) => c.subject.id))].map((subjectId) => (
          <section key={subjectId} className="stack">
            <h3>{offeringName.get(subjectId) ?? 'Organization-level claims'}</h3>
            <ClaimList
              headings={false}
              claims={drafts.filter((c) => c.subject.id === subjectId)}
              orgId={orgId}
              evidence={workspace.evidence.filter((e) => e.offeringId === subjectId || e.offeringId === null)}
            />
          </section>
        ))
      )}

      <h2>Offerings ({workspace.offerings.length})</h2>
      {workspace.offerings.length === 0 ? (
        <p className="muted">No offerings yet. Create the first one below.</p>
      ) : (
        <TableScroll label="Offerings">
          <table>
            <thead>
              <tr>
                <th>Offering</th>
                <th>Maturity</th>
                <th>Status</th>
                <th>Claims</th>
              </tr>
            </thead>
            <tbody>
              {workspace.offerings.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link href={`/workspace/offerings/${o.id}${q}`}>{o.name}</Link>
                    <div className="small muted untrusted">{o.summary}</div>
                  </td>
                  <td>
                    <MaturityBadge maturity={o.maturity} />
                  </td>
                  <td>{OFFERING_STATUS_LABEL[o.status] ?? o.status}</td>
                  <td className="small">
                    {count(o.id, 'published')} published · {count(o.id, 'draft')} draft
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}

      {editable ? (
        <div className="grid2">
          <section className="card">
            <h3>New offering</h3>
            <ActionForm action={createOffering} submitLabel="Create draft offering">
              <input type="hidden" name="orgId" value={orgId} />
              <div>
                <label htmlFor="new-name">Name</label>
                <input id="new-name" name="name" required minLength={2} maxLength={160} />
              </div>
              <div className="grid2even">
                <div>
                  <label htmlFor="new-type">Type</label>
                  <select id="new-type" name="type" defaultValue="product">
                    <option value="product">Product</option>
                    <option value="service">Service</option>
                    <option value="technology_platform">Technology platform</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="new-maturity">Maturity</label>
                  <select id="new-maturity" name="maturity" defaultValue="pilot">
                    <option value="concept">Concept</option>
                    <option value="prototype">Prototype</option>
                    <option value="pilot">Pilot</option>
                    <option value="production">Production</option>
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="new-summary">One-sentence technical summary</label>
                <textarea id="new-summary" name="summary" required minLength={10} maxLength={400} />
              </div>
              <div>
                <label htmlFor="new-description">Description (optional)</label>
                <textarea id="new-description" name="description" maxLength={8000} />
              </div>
              <p className="small muted">
                It stays private until you publish it; you add claims on the next page.
              </p>
            </ActionForm>
          </section>
          <section className="card stack">
            <h3>Upload technical documentation</h3>
            <p className="small muted">
              PDF, text, Markdown or HTML up to 50 MB. Files are scanned for malware, text is extracted and
              claims are drafted for your review.
            </p>
            <ActionForm action={uploadDocument} submitLabel="Upload">
              <input type="hidden" name="orgId" value={orgId} />
              <OfferingSelect id="upload-offering" offerings={workspace.offerings} optional />
              <div>
                <label htmlFor="doc-title">Title (optional)</label>
                <input id="doc-title" name="title" />
              </div>
              <div>
                <label htmlFor="doc-file">File</label>
                <input
                  id="doc-file"
                  type="file"
                  name="file"
                  accept=".pdf,.txt,.md,.html,application/pdf,text/plain,text/markdown,text/html"
                  required
                />
              </div>
            </ActionForm>
            <details>
              <summary>Register a hosted demo video</summary>
              <ActionForm action={registerVideo} submitLabel="Register video">
                <input type="hidden" name="orgId" value={orgId} />
                <OfferingSelect id="video-offering" offerings={workspace.offerings} />
                <div>
                  <label htmlFor="video-title">Title</label>
                  <input id="video-title" name="title" required />
                </div>
                <div>
                  <label htmlFor="video-url">Video address (https://)</label>
                  <input id="video-url" name="url" type="url" required />
                </div>
                <div>
                  <label htmlFor="video-duration">Duration in seconds (optional)</label>
                  <input id="video-duration" name="durationSeconds" type="number" min={0} />
                </div>
                <div>
                  <label htmlFor="video-description">What does the demo show?</label>
                  <textarea id="video-description" name="description" />
                </div>
              </ActionForm>
            </details>
          </section>
        </div>
      ) : (
        <p className="small muted">You have read-only access to this workspace.</p>
      )}

      <h2>Uploaded files ({workspace.assets.length})</h2>
      {workspace.assets.length === 0 ? (
        <p className="muted">No files yet.</p>
      ) : (
        <TableScroll label="Uploaded files">
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>Processing</th>
                <th>Claims</th>
              </tr>
            </thead>
            <tbody>
              {workspace.assets.map((a) => (
                <tr key={a.id}>
                  <td>
                    {a.title}
                    <div className="small muted">
                      {a.offeringId ? offeringName.get(a.offeringId) : 'Organization-wide'}
                    </div>
                  </td>
                  <td>
                    <span
                      className={`badge ${a.processingState === 'quarantined' || a.processingState === 'failed' ? 'tone-bad' : ''}`}
                    >
                      {ASSET_STATE_LABEL[a.processingState] ?? a.processingState}
                    </span>
                    {a.failureReason ? <div className="small muted">{a.failureReason}</div> : null}
                  </td>
                  <td className="small muted">
                    {EXTRACTION_STATE_LABEL[a.extractionState] ?? a.extractionState}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </div>
  );
}

function OfferingSelect({
  id,
  offerings,
  optional = false,
}: {
  id: string;
  offerings: readonly { id: string; name: string }[];
  optional?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id}>Offering</label>
      <select id={id} name="offeringId" required={!optional} defaultValue="">
        <option value="" disabled={!optional}>
          {optional ? 'Organization-wide (no offering)' : 'Choose an offering'}
        </option>
        {offerings.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}
