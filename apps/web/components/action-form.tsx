'use client';

import { useActionState } from 'react';
import type { FormState } from '@/lib/actions/auth';

/** A form bound to a server action that reports success/error inline. */
export function ActionForm({
  action,
  children,
  submitLabel,
  className = 'stack',
  variant = 'primary',
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  children: React.ReactNode;
  submitLabel: string;
  className?: string;
  /** Secondary for less common or negative choices (e.g. declining). */
  variant?: 'primary' | 'secondary';
}) {
  const [state, run, pending] = useActionState<FormState, FormData>(action, {});
  return (
    <form action={run} className={className}>
      {children}
      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p className="success" role="status">
          {state.message}
        </p>
      ) : null}
      <div>
        <button type="submit" className={variant === 'primary' ? 'primary' : undefined} disabled={pending}>
          {pending ? 'Working…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
