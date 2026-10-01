'use client';

import { ActionForm } from '@/components/action-form';
import { acceptInvitation } from '@/lib/actions/members';

export function AcceptInvitation({ token }: { token: string }) {
  return (
    <ActionForm action={acceptInvitation} submitLabel="Accept invitation">
      <input type="hidden" name="invite" value={token} />
    </ActionForm>
  );
}
