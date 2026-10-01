'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { type FormState, signup } from '@/lib/actions/auth';

export function SignupForm({
  invite,
  email,
  termsVersion,
}: {
  invite: string | null;
  email: string | null;
  termsVersion: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(signup, {});
  return (
    <form action={action} className="stack">
      {invite ? <input type="hidden" name="invite" value={invite} /> : null}
      <div>
        <label htmlFor="displayName">Your name</label>
        <input id="displayName" name="displayName" autoComplete="name" required maxLength={120} />
      </div>
      <div>
        <label htmlFor="email">Work email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={email ?? ''}
          readOnly={email !== null}
        />
      </div>
      <div>
        <label htmlFor="password">Password (at least 12 characters)</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </div>
      <label className="row plain">
        <input type="checkbox" name="acceptTerms" className="inline-check" required /> I accept the{' '}
        <Link href="/terms" target="_blank">
          terms of use
        </Link>{' '}
        and the{' '}
        <Link href="/privacy" target="_blank">
          privacy notice
        </Link>{' '}
        <span className="small muted">(version {termsVersion})</span>
      </label>
      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}
      <button type="submit" className="primary" disabled={pending}>
        {pending ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  );
}
