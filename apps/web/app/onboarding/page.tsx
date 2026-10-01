import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { createOrganization } from '@/lib/actions/onboarding';
import { currentUser } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const me = await currentUser();
  if (!me) redirect('/login?next=/onboarding');
  return (
    <div className="stack narrow">
      <h1>Set up your organization</h1>
      {me.memberships.length > 0 ? (
        <div className="card stack">
          <p>You are a member of:</p>
          <ul>
            {me.memberships.map((m) => (
              <li key={m.organizationId}>
                {m.organizationName}{' '}
                <span className="small muted">
                  ({m.organizationKind}, {m.role})
                </span>{' '}
                —{' '}
                <Link href={m.organizationKind === 'buyer' ? '/buyer/requirements' : '/workspace'}>open</Link>
              </li>
            ))}
          </ul>
          <p className="small muted">
            Joining a colleague&apos;s organization? Ask an administrator of that organization to invite you
            instead of creating a new one.
          </p>
        </div>
      ) : (
        <p>
          Create the organization you represent. Suppliers publish technology profiles; buyers (OEMs, Tier-1s)
          search and keep private requirements. Choose <em>both</em> if you do both.
        </p>
      )}
      <ActionForm action={createOrganization} submitLabel="Create organization">
        <div>
          <label htmlFor="name">Organization name</label>
          <input id="name" name="name" required minLength={2} maxLength={160} />
        </div>
        <div>
          <label htmlFor="kind">Role on the exchange</label>
          <select id="kind" name="kind" defaultValue="supplier">
            <option value="supplier">Supplier — we offer products, platforms or engineering services</option>
            <option value="buyer">Buyer — we evaluate technologies (OEM / Tier-1)</option>
            <option value="hybrid">Both</option>
          </select>
        </div>
        <div>
          <label htmlFor="summary">One-sentence summary</label>
          <input id="summary" name="summary" required minLength={10} maxLength={400} />
        </div>
        <div className="row">
          <div>
            <label htmlFor="website">Website (https)</label>
            <input id="website" name="website" type="url" placeholder="https://" />
          </div>
          <div>
            <label htmlFor="country">Headquarters country (ISO code)</label>
            <input id="country" name="country" maxLength={2} placeholder="DE" />
          </div>
        </div>
        <p className="small muted">
          Supplier content becomes visible to buyers only after the ATX team verifies your organization. You
          can prepare your profile in the meantime.
        </p>
      </ActionForm>
    </div>
  );
}
