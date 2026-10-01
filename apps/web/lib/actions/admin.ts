'use server';

import { ClaimView, OrganizationRecord } from '@atx/contracts';
import { revalidatePath } from 'next/cache';
import { api } from '../api';

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
