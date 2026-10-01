'use client';

import { useActionState } from 'react';
import { type InvitationState, inviteToPlatform } from '@/lib/actions/admin';

export function InviteForm() {
  const [state, action, pending] = useActionState<InvitationState, FormData>(inviteToPlatform, {});
  return (
    <form action={action} className="card stack">
      <div className="row">
        <div>
          <label htmlFor="invite-email">Invite a person to register</label>
          <input id="invite-email" name="email" type="email" required placeholder="name@company.com" />
        </div>
        <div>
          <button type="submit" className="primary" disabled={pending}>
            {pending ? 'Creating…' : 'Create invitation'}
          </button>
        </div>
      </div>
      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.url ? (
        <div className="stack">
          <p className="notice">
            Send this link to {state.email} only. It is shown once, works for that email address only and
            expires in 14 days.
          </p>
          <textarea readOnly value={state.url} aria-label="Invitation link" />
        </div>
      ) : null}
    </form>
  );
}
