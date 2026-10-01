import { AuditEventRecord, ClaimView, OrganizationRef } from '@atx/contracts';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { TrustBadge } from '@/components/badges';
import { decideVerification, reviewClaim } from '@/lib/actions/admin';
import { api, currentUser } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const me = await currentUser();
  if (!me || me.user.platformRole !== 'platform_admin') redirect('/login?next=/admin');
  const [queue, claims, moderation, audit, demand] = await Promise.all([
    api('/v1/admin/verification-queue', { schema: z.object({ items: z.array(OrganizationRef.extend({ kind: z.string(), website: z.string().nullable(), requestedAt: z.string() })) }) }),
    api('/v1/admin/claims/review-queue', { schema: z.object({ items: z.array(ClaimView) }) }),
    api('/v1/admin/moderation', { schema: z.object({ items: z.array(ClaimView.extend({ signals: z.array(z.string()) })) }) }),
    api('/v1/admin/audit?limit=40', { schema: z.object({ items: z.array(AuditEventRecord) }) }),
    api('/v1/admin/demand-signals', { schema: z.object({ items: z.array(z.object({ concept: z.string(), conceptId: z.string(), requirementCount: z.number() })) }) }),
  ]);
  return (
    <div className="stack">
      <h1>Platform administration</h1>
      <h2>Organization verification ({queue.items.length})</h2>
      <table>
        <tbody>
          {queue.items.map((org) => (
            <tr key={org.id}>
              <td>{org.name}</td>
              <td className="small">{org.kind}</td>
              <td className="small">{org.website}</td>
              <td className="row">
                {['verified', 'rejected'].map((state) => (
                  <form key={state} action={decideVerification}>
                    <input type="hidden" name="orgId" value={org.id} />
                    <input type="hidden" name="state" value={state} />
                    <button type="submit">{state === 'verified' ? 'Verify' : 'Reject'}</button>
                  </form>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Content moderation ({moderation.items.length})</h2>
      <p className="small muted">Published statements containing instruction-like text aimed at AI agents.</p>
      <table>
        <tbody>
          {moderation.items.map((c) => (
            <tr key={c.id}>
              <td className="untrusted">{c.statement}</td>
              <td className="small">{c.signals.length} signal(s)</td>
              <td>
                <form action={reviewClaim}>
                  <input type="hidden" name="claimId" value={c.id} />
                  <input type="hidden" name="outcome" value="rejected" />
                  <button type="submit">Reject claim</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Evidence review ({claims.items.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Claim</th>
            <th>Statement</th>
            <th>Basis</th>
            <th>Evidence</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {claims.items.slice(0, 25).map((c) => (
            <tr key={c.id}>
              <td>
                {c.predicateLabel} {c.concept.label}
              </td>
              <td className="untrusted small">{c.statement}</td>
              <td>
                <TrustBadge tier={c.trustTier} label={c.trustLabel} />
              </td>
              <td>{c.provenance.evidenceIds?.length ?? 0}</td>
              <td className="row">
                {(c.provenance.evidenceIds?.length ?? 0) > 0 ? (
                  <form action={reviewClaim}>
                    <input type="hidden" name="claimId" value={c.id} />
                    <input type="hidden" name="outcome" value="platform_verified" />
                    <button type="submit">Mark verified</button>
                  </form>
                ) : null}
                <form action={reviewClaim}>
                  <input type="hidden" name="claimId" value={c.id} />
                  <input type="hidden" name="outcome" value="disputed" />
                  <button type="submit">Dispute</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Anonymized demand</h2>
      <p className="small">{demand.items.length === 0 ? 'No published demand signals yet.' : demand.items.map((d) => `${d.concept} (${d.requirementCount})`).join(', ')}</p>
      <h2>Audit log (latest 40)</h2>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Action</th>
            <th>Resource</th>
            <th>Outcome</th>
            <th>Channel</th>
          </tr>
        </thead>
        <tbody>
          {audit.items.map((e) => (
            <tr key={e.id}>
              <td className="small">{e.occurredAt.replace('T', ' ').slice(0, 19)}</td>
              <td>{e.action}</td>
              <td className="small">
                {e.resourceType} {e.resourceId?.slice(0, 8)}
              </td>
              <td>{e.outcome}</td>
              <td className="small">{String(e.actor['channel'] ?? e.actor['type'])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
