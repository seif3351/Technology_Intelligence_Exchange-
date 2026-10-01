'use client';

import { useActionState } from 'react';
import type { FormState } from '@/lib/actions/auth';
import { decideAuthorization } from '@/lib/actions/oauth';

export function ConsentForm({ params }: { params: Record<string, string | undefined> }) {
  const [state, action, pending] = useActionState<FormState, FormData>(decideAuthorization, {});
  return (
    <form action={action} className="stack">
      {Object.entries(params).map(([key, value]) =>
        value === undefined ? null : <input key={key} type="hidden" name={key} value={value} />,
      )}
      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}
      <div className="row">
        <button type="submit" name="decision" value="approve" className="primary" disabled={pending}>
          Allow access
        </button>
        <button type="submit" name="decision" value="deny" disabled={pending}>
          Deny
        </button>
      </div>
    </form>
  );
}
