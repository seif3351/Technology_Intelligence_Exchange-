import { InvitationPreview, RegistrationPolicy } from '@atx/contracts';
import Link from 'next/link';
import { api, currentUser } from '@/lib/api';
import { AcceptInvitation } from './accept-invitation';
import { SignupForm } from './signup-form';

export const dynamic = 'force-dynamic';

const TOKEN = /^[A-Za-z0-9_-]{20,200}$/;

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  const policy = await api('/v1/auth/registration', { schema: RegistrationPolicy, anonymous: true });
  const token = invite && TOKEN.test(invite) ? invite : null;
  const invitation = token
    ? await api('/v1/invitations/lookup', {
        method: 'POST',
        body: { token },
        schema: InvitationPreview,
        anonymous: true,
      }).catch(() => null)
    : null;

  if (token && !invitation) {
    return (
      <div className="stack narrower">
        <h1>Invitation not valid</h1>
        <p className="notice">
          This invitation link is invalid, has expired or was already used. Ask the person who invited you for
          a new link, or <Link href="/login">sign in</Link> if you already have an account.
        </p>
      </div>
    );
  }
  if (!invitation && policy.mode === 'invite') {
    return (
      <div className="stack narrower">
        <h1>Join the Automotive Technology Exchange</h1>
        <p className="notice">
          During the pilot, accounts are created by invitation. Use the link in your invitation email, or
          contact the ATX team to request access. Already registered? <Link href="/login">Sign in</Link>.
        </p>
      </div>
    );
  }
  const me = invitation?.organizationName ? await currentUser() : null;
  if (invitation?.organizationName && token && me) {
    return (
      <div className="stack narrower">
        <h1>Join {invitation.organizationName}</h1>
        <p>
          You were invited as <strong>{invitation.role}</strong>. The invitation is for {invitation.email}; it
          can only be accepted by the account with that email address.
        </p>
        <AcceptInvitation token={token} />
      </div>
    );
  }
  return (
    <div className="stack narrower">
      <h1>Create your account</h1>
      {invitation?.organizationName ? (
        <p className="notice">
          You were invited to join <strong>{invitation.organizationName}</strong> as {invitation.role}.
        </p>
      ) : null}
      <SignupForm invite={token} email={invitation?.email ?? null} termsVersion={policy.termsVersion} />
      <p className="small muted">
        Already registered?{' '}
        <Link href={token ? `/login?next=${encodeURIComponent(`/signup?invite=${token}`)}` : '/login'}>
          Sign in
        </Link>
        {invitation?.organizationName ? ' to accept the invitation with your existing account' : ''}.
      </p>
    </div>
  );
}
