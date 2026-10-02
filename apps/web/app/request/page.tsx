import type { Metadata } from 'next';
import { OfferingDetail, RequirementView } from '@atx/contracts';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { api, currentUser } from '@/lib/api';
import { RequestForm } from './request-form';

export const metadata: Metadata = { title: 'Request a demo, workshop, PoC or RFI' };

export const dynamic = 'force-dynamic';

export default async function RequestPage({
  searchParams,
}: {
  searchParams: Promise<{ offeringId?: string }>;
}) {
  const { offeringId } = await searchParams;
  const me = await currentUser();
  if (!me) redirect(`/login?next=${encodeURIComponent(`/request?offeringId=${offeringId ?? ''}`)}`);
  const buyerOrg = me.memberships.find(
    (m) => m.organizationKind === 'buyer' || m.organizationKind === 'hybrid',
  );
  if (!buyerOrg || !offeringId)
    return <p className="notice">Requests can be sent by members of a buyer organization.</p>;
  const offering = await api(`/v1/offerings/${encodeURIComponent(offeringId)}`, { schema: OfferingDetail });
  const { items } = await api(`/v1/organizations/${buyerOrg.organizationId}/requirements`, {
    schema: z.object({ items: z.array(RequirementView) }),
  });
  return (
    <div className="stack narrow">
      <h1>Request a demo, workshop, PoC or RFI</h1>
      <p className="muted">
        To <strong>{offering.organization.name}</strong> about <strong>{offering.name}</strong>. You will see
        exactly what will be shared before anything is sent.
      </p>
      <RequestForm
        offeringId={offering.id}
        buyerOrganizationId={buyerOrg.organizationId}
        defaultName={me.user.displayName}
        requirements={items.map((r) => ({ id: r.id, title: r.title }))}
      />
    </div>
  );
}
