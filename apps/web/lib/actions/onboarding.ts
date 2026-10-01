'use server';

import { OrganizationCreate, OrganizationRecord } from '@atx/contracts';
import { redirect } from 'next/navigation';
import { api, describeError } from '../api';
import type { FormState } from './auth';

const text = (form: FormData, key: string): string => String(form.get(key) ?? '').trim();

export async function createOrganization(_state: FormState, form: FormData): Promise<FormState> {
  const parsed = OrganizationCreate.safeParse({
    name: text(form, 'name'),
    kind: text(form, 'kind'),
    summary: text(form, 'summary'),
    website: text(form, 'website') || null,
    headquartersCountry: text(form, 'country').toUpperCase() || null,
  });
  if (!parsed.success)
    return { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  let kind: string;
  try {
    kind = (await api('/v1/organizations', { method: 'POST', body: parsed.data, schema: OrganizationRecord }))
      .kind;
  } catch (error) {
    return { error: describeError(error) };
  }
  redirect(kind === 'buyer' ? '/buyer/requirements' : '/workspace');
}
