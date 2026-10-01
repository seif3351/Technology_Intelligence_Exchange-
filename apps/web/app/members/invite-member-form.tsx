'use client';

import { useActionState } from 'react';
import { type MemberInviteState, inviteMember } from '@/lib/actions/members';

export function InviteMemberForm({ orgId, roles }: { orgId: string; roles: readonly string[] }) {
  const [state, action, pending] = useActionState<MemberInviteState, FormData>(inviteMember, {});
  return (
    <form action={action} className="card stack">
      <input type="hidden" name="orgId" value={orgId} />
      <div className="row">
        <div>
          <label htmlFor="member-email">Colleague&apos;s email</label>
          <input id="member-email" name="email" type="email" required />
        </div>
        <div>
          <label htmlFor="member-role">Role</label>
          <select id="member-role" name="role" defaultValue="editor">
            {roles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </div>
        <div>
          <button type="submit" className="primary" disabled={pending}>
            {pending ? 'Inviting…' : 'Invite'}
          </button>
        </div>
      </div>
      <p className="small muted">
        viewer: read private data · editor: edit offerings, claims and requirements · admin: also manage
        members · owner: everything, including owners.
      </p>
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
      {state.url && !state.emailed ? (
        <textarea readOnly value={state.url} aria-label="Invitation link" />
      ) : null}
    </form>
  );
}
