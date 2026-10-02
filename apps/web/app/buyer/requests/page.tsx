import type { Metadata } from 'next';
import { Engagement } from '@atx/contracts';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { api, currentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Requests sent' };

export const dynamic = 'force-dynamic';

const STATUS_TEXT: Record<string, string> = {
  submitted: 'Waiting for the supplier',
  acknowledged: 'Accepted by the supplier',
  declined: 'Declined by the supplier',
  withdrawn: 'Withdrawn',
  closed: 'Closed',
};

export default async function BuyerRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const me = await currentUser();
  if (!me) redirect('/login?next=/buyer/requests');
  const { org } = await searchParams;
  const buyerOrgs = me.memberships.filter(
    (m) => m.organizationKind === 'buyer' || m.organizationKind === 'hybrid',
  );
  const membership = buyerOrgs.find((m) => m.organizationId === org) ?? buyerOrgs[0];
  if (!membership)
    return (
      <p className="notice">
        Requests are available to members of buyer organizations.{' '}
        <Link href="/onboarding">Set up your organization</Link>.
      </p>
    );
  const { items } = await api(
    `/v1/organizations/${membership.organizationId}/engagements?direction=outgoing`,
    {
      schema: z.object({ items: z.array(Engagement) }),
    },
  );
  return (
    <div className="stack">
      <h1>Requests sent — {membership.organizationName}</h1>
      <p className="small muted">
        Demo, workshop, PoC and RFI requests your organization sent. When a supplier accepts, their contact
        person appears here and the request contact is notified by email.
      </p>
      {items.length === 0 ? <p className="muted">No requests yet. Start from an offering page.</p> : null}
      {items.map((e) => (
        <div key={e.id} className="card stack" data-testid="outgoing-request">
          <div className="row">
            <strong>{e.type.toUpperCase()}</strong>
            {e.offeringId ? <Link href={`/offerings/${e.offeringId}`}>offering</Link> : null}
            <span className="badge">{STATUS_TEXT[e.status] ?? e.status}</span>
            <span className="small muted">sent {e.createdAt.slice(0, 10)}</span>
          </div>
          <p className="small">
            Your message: <span>{e.disclosure.message}</span>
          </p>
          {e.supplierResponse ? (
            <div className="stack">
              {e.supplierResponse.contactName ? (
                <div>
                  Supplier contact: <strong className="untrusted">{e.supplierResponse.contactName}</strong>{' '}
                  &lt;
                  <a href={`mailto:${e.supplierResponse.contactEmail ?? ''}`}>
                    {e.supplierResponse.contactEmail}
                  </a>
                  &gt;
                </div>
              ) : null}
              {e.supplierResponse.message ? (
                <p className="untrusted">“{e.supplierResponse.message}”</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
