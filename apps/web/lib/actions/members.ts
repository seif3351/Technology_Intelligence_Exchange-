'use server';

import { IssuedInvitation, MemberRecord } from '@atx/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { api, describeError } from '../api';
import type { FormState } from './auth';

const text = (form: FormData, key: string): string => String(form.get(key) ?? '').trim();

export interface MemberInviteState extends FormState {
  readonly url?: string;
  readonly emailed?: boolean;
}

export async function inviteMember(_state: MemberInviteState, form: FormData): Promise<MemberInviteState> {
  const orgId = text(form, 'orgId');
  try {
    const issued = await api(`/v1/organizations/${orgId}/invitations`, {
      method: 'POST',
      body: { email: text(form, 'email'), role: text(form, 'role') },
      schema: IssuedInvitation,
    });
    revalidatePath('/members');
    return {
      url: issued.url,
      emailed: issued.emailed,
      message: issued.emailed
        ? `Invitation emailed to ${issued.invitation.email}.`
        : `Email is not available: share the link below with ${issued.invitation.email}.`,
    };
  } catch (error) {
    return { error: describeError(error) };
  }
}

export async function changeRole(_state: FormState, form: FormData): Promise<FormState> {
  try {
    await api(`/v1/organizations/${text(form, 'orgId')}/members/${text(form, 'userId')}`, {
      method: 'PATCH',
      body: { role: text(form, 'role') },
      schema: MemberRecord,
    });
  } catch (error) {
    return { error: describeError(error) };
  }
  revalidatePath('/members');
  return { message: 'Role updated.' };
}

export async function removeMember(_state: FormState, form: FormData): Promise<FormState> {
  const orgId = text(form, 'orgId');
  try {
    await api(`/v1/organizations/${orgId}/members/${text(form, 'userId')}`, {
      method: 'DELETE',
      schema: z.object({ removed: z.literal(true) }),
    });
  } catch (error) {
    return { error: describeError(error) };
  }
  if (form.get('self') === '1') redirect('/account');
  revalidatePath('/members');
  return { message: 'Member removed.' };
}

export async function revokeMemberInvitation(form: FormData): Promise<void> {
  await api(`/v1/organizations/${text(form, 'orgId')}/invitations/${text(form, 'invitationId')}/revoke`, {
    method: 'POST',
    body: {},
    schema: z.object({ revoked: z.literal(true) }),
  });
  revalidatePath('/members');
}

export async function acceptInvitation(_state: FormState, form: FormData): Promise<FormState> {
  let organizationId: string;
  try {
    ({ organizationId } = await api('/v1/invitations/accept', {
      method: 'POST',
      body: { token: text(form, 'invite') },
      schema: z.object({ organizationId: z.string() }),
    }));
  } catch (error) {
    return { error: describeError(error) };
  }
  redirect(`/members?org=${organizationId}`);
}
