import Link from 'next/link';
import { z } from 'zod';
import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

const TOKEN = /^[A-Za-z0-9_-]{20,200}$/;

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const ok =
    token && TOKEN.test(token)
      ? await api('/v1/auth/email-verification/confirm', {
          method: 'POST',
          body: { token },
          schema: z.object({ verified: z.literal(true) }),
          anonymous: true,
        })
          .then(() => true)
          .catch(() => false)
      : false;
  return (
    <div className="stack narrower">
      <h1>{ok ? 'Email confirmed' : 'Link not valid'}</h1>
      {ok ? (
        <p className="success">
          Thank you — your email address is confirmed. <Link href="/onboarding">Continue</Link>.
        </p>
      ) : (
        <p className="notice">
          This confirmation link is invalid, expired or was already used. Sign in and request a new one from
          your <Link href="/account">account page</Link>.
        </p>
      )}
    </div>
  );
}
