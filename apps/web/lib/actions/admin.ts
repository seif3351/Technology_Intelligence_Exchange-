'use server';

import { ClaimView, IssuedInvitation, OrganizationRecord } from '@atx/contracts';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { api, describeError } from '../api';
import type { FormState } from './auth';

const text = (form: FormData, key: string): string => String(form.get(key) ?? '').trim();

export async function decideVerification(form: FormData): Promise<void> {
  await api(`/v1/admin/organizations/${text(form, 'orgId')}/verification`, {
    method: 'POST',
    body: { state: text(form, 'state'), reason: null },
    schema: OrganizationRecord,
  });
  revalidatePath('/admin');
}

export async function reviewClaim(form: FormData): Promise<void> {
  await api(`/v1/admin/claims/${text(form, 'claimId')}/review`, {
    method: 'POST',
    body: { outcome: text(form, 'outcome'), notes: null },
    schema: ClaimView,
  });
  revalidatePath('/admin');
}

export interface InvitationState extends FormState {
  readonly url?: string;
  readonly email?: string;
}

export async function inviteToPlatform(_state: InvitationState, form: FormData): Promise<InvitationState> {
  try {
    const issued = await api('/v1/admin/invitations', {
      method: 'POST',
      body: { email: text(form, 'email') },
      schema: IssuedInvitation,
    });
    revalidatePath('/admin');
    return { url: issued.url, email: issued.invitation.email };
  } catch (error) {
    return { error: describeError(error) };
  }
}

export async function revokeInvitation(form: FormData): Promise<void> {
  await api(`/v1/admin/invitations/${text(form, 'invitationId')}/revoke`, {
    method: 'POST',
    body: {},
    schema: z.object({ revoked: z.literal(true) }),
  });
  revalidatePath('/admin');
}
