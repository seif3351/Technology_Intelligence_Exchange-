import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { resendVerification, signOutEverywhere } from '@/lib/actions/account';
import { currentUser } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const me = await currentUser();
  if (!me) redirect('/login?next=/account');
  return (
    <div className="stack narrow">
      <h1>Your account</h1>
      <div className="card stack">
        <div>
          <strong>{me.user.displayName}</strong>
        </div>
        <div className="small">
          Email {me.user.emailVerified ? 'confirmed' : <strong>not confirmed yet</strong>}
        </div>
        {me.user.emailVerified ? null : (
          <ActionForm action={resendVerification} submitLabel="Send a new confirmation link">
            <p className="small muted">
              Confirm your email to create an organization or send requests to suppliers.
            </p>
          </ActionForm>
        )}
      </div>
      <div className="card stack">
        <h2>Organizations</h2>
        <ul>
          {me.memberships.map((m) => (
            <li key={m.organizationId}>
              {m.organizationName}{' '}
              <span className="small muted">
                ({m.organizationKind}, {m.role})
              </span>
            </li>
          ))}
        </ul>
        <Link href="/onboarding">Set up another organization</Link>
      </div>
      <div className="card stack">
        <h2>Security</h2>
        <p className="small">
          Lost a device or shared an agent token by mistake? This ends every session and invalidates all agent
          tokens you created.
        </p>
        <form action={signOutEverywhere}>
          <button type="submit">Sign out everywhere</button>
        </form>
      </div>
    </div>
  );
}
