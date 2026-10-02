import type { Metadata } from 'next';
import { SecretToken } from '@atx/contracts';
import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { resetPassword } from '@/lib/actions/account';

export const metadata: Metadata = { title: 'Reset password' };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token || !SecretToken.safeParse(token).success)
    return (
      <div className="stack narrower">
        <h1>Link not valid</h1>
        <p className="notice">
          <Link href="/forgot-password">Request a new reset link</Link>.
        </p>
      </div>
    );
  return (
    <div className="stack narrower">
      <h1>Choose a new password</h1>
      <p className="small muted">
        This signs you out everywhere, including AI agent tokens and connected apps.
      </p>
      <ActionForm action={resetPassword} submitLabel="Set new password">
        <input type="hidden" name="token" value={token} />
        <div>
          <label htmlFor="newPassword">New password (at least 12 characters)</label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
          />
        </div>
      </ActionForm>
    </div>
  );
}
