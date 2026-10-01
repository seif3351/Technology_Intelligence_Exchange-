import { RequirementView } from '@atx/contracts';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { ActionForm } from '@/components/action-form';
import { createRequirement } from '@/lib/actions/buyer';
import { api, currentUser } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function RequirementsPage() {
  const me = await currentUser();
  if (!me) redirect('/login?next=/buyer/requirements');
  const buyerOrg = me.memberships.find(
    (m) => m.organizationKind === 'buyer' || m.organizationKind === 'hybrid',
  );
  if (!buyerOrg)
    return <p className="notice">Requirements are available to members of buyer organizations.</p>;
  const { items } = await api(`/v1/organizations/${buyerOrg.organizationId}/requirements`, {
    schema: z.object({ items: z.array(RequirementView) }),
  });
  return (
    <div className="stack">
      <h1>Private requirements — {buyerOrg.organizationName}</h1>
      <p className="muted">
        Requirements are private to your organization. Suppliers never see them unless you explicitly share
        selected technical constraints in a request.
      </p>
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Constraints</th>
            <th>Confidential terms</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id}>
              <td>
                <Link href={`/buyer/requirements/${r.id}?org=${buyerOrg.organizationId}`}>{r.title}</Link>
              </td>
              <td>{r.constraints.length}</td>
              <td>{r.confidentialTermCount} protected</td>
              <td>
                {r.status} · {r.visibility}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className="card narrow">
        <h3>New requirement</h3>
        <ActionForm action={createRequirement} submitLabel="Save private draft">
          <input type="hidden" name="orgId" value={buyerOrg.organizationId} />
          <div>
            <label htmlFor="title">Title</label>
            <input id="title" name="title" required minLength={3} />
          </div>
          <div>
            <label htmlFor="description">Technical requirement</label>
            <textarea id="description" name="description" required minLength={10} />
          </div>
          <div>
            <label htmlFor="confidentialTerms">Confidential terms (comma-separated)</label>
            <input
              id="confidentialTerms"
              name="confidentialTerms"
              placeholder="Project names, vehicle programs, customers, internal identifiers"
            />
            <p className="small muted">
              These terms are removed before interpretation and can never be sent to a supplier.
            </p>
          </div>
        </ActionForm>
      </section>
    </div>
  );
}
