'use server';

import {
  AssetRecord,
  ClaimCreate,
  ClaimView,
  Engagement,
  ExternalVideoCreate,
  OfferingCreate,
  OfferingRecord,
  OrganizationRecord,
} from '@atx/contracts';
import { revalidatePath } from 'next/cache';
import { api, describeError } from '../api';
import type { FormState } from './auth';

const text = (form: FormData, key: string): string => String(form.get(key) ?? '').trim();
const optional = (form: FormData, key: string): string | undefined => text(form, key) || undefined;
const done = (message: string): FormState => {
  revalidatePath('/workspace');
  return { message };
};

export async function createOffering(_state: FormState, form: FormData): Promise<FormState> {
  const orgId = text(form, 'orgId');
  const type = text(form, 'type');
  const parsed = OfferingCreate.safeParse({
    slug: text(form, 'slug'),
    type,
    name: text(form, 'name'),
    summary: text(form, 'summary'),
    description: text(form, 'description'),
    maturity: text(form, 'maturity'),
    details: type === 'service' ? { type: 'service' } : { type },
  });
  if (!parsed.success)
    return { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  try {
    await api(`/v1/organizations/${orgId}/offerings`, {
      method: 'POST',
      body: parsed.data,
      schema: OfferingRecord,
    });
    return done('Draft offering created.');
  } catch (error) {
    return { error: describeError(error) };
  }
}

export async function addClaim(_state: FormState, form: FormData): Promise<FormState> {
  const orgId = text(form, 'orgId');
  const parsed = ClaimCreate.safeParse({
    subject: { type: 'offering', id: text(form, 'offeringId') },
    predicate: text(form, 'predicate'),
    conceptId: text(form, 'conceptId'),
    statement: text(form, 'statement'),
    sourceUrl: optional(form, 'sourceUrl') ?? null,
    qualifiers: optional(form, 'asil') ? { asil: text(form, 'asil') } : undefined,
  });
  if (!parsed.success)
    return { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  try {
    await api(`/v1/organizations/${orgId}/claims`, { method: 'POST', body: parsed.data, schema: ClaimView });
    return done('Draft claim added. Publish it after review.');
  } catch (error) {
    return { error: describeError(error) };
  }
}

export async function changeClaim(form: FormData): Promise<void> {
  const orgId = text(form, 'orgId');
  const action = text(form, 'action') === 'retract' ? 'retract' : 'publish';
  await api(`/v1/organizations/${orgId}/claims/${text(form, 'claimId')}/${action}`, {
    method: 'POST',
    body: { expectedVersion: Number(text(form, 'version')) },
    schema: ClaimView,
  });
  revalidatePath('/workspace');
}

export async function setOfferingStatus(_state: FormState, form: FormData): Promise<FormState> {
  try {
    await api(`/v1/organizations/${text(form, 'orgId')}/offerings/${text(form, 'offeringId')}/status`, {
      method: 'POST',
      body: { status: text(form, 'status'), expectedVersion: Number(text(form, 'version')) },
      schema: OfferingRecord,
    });
    return done(`Offering ${text(form, 'status')}.`);
  } catch (error) {
    return { error: describeError(error) };
  }
}

export async function uploadDocument(_state: FormState, form: FormData): Promise<FormState> {
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a file to upload.' };
  const params = new URLSearchParams({ kind: 'document', title: text(form, 'title') || file.name });
  if (optional(form, 'offeringId')) params.set('offeringId', text(form, 'offeringId'));
  try {
    await api(`/v1/organizations/${text(form, 'orgId')}/assets?${params.toString()}`, {
      method: 'PUT',
      raw: { bytes: await file.arrayBuffer(), contentType: file.type || 'application/octet-stream' },
      schema: AssetRecord,
    });
    return done(
      'Uploaded. The document is scanned and analysed in the background; AI-drafted claims will appear below for your review.',
    );
  } catch (error) {
    return { error: describeError(error) };
  }
}

export async function registerVideo(_state: FormState, form: FormData): Promise<FormState> {
  const parsed = ExternalVideoCreate.safeParse({
    offeringId: text(form, 'offeringId'),
    title: text(form, 'title'),
    description: text(form, 'description'),
    url: text(form, 'url'),
    durationSeconds: optional(form, 'durationSeconds') ? Number(text(form, 'durationSeconds')) : null,
  });
  if (!parsed.success)
    return { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  try {
    await api(`/v1/organizations/${text(form, 'orgId')}/videos`, {
      method: 'POST',
      body: parsed.data,
      schema: AssetRecord,
    });
    return done('Demo video registered.');
  } catch (error) {
    return { error: describeError(error) };
  }
}

export async function requestVerification(form: FormData): Promise<void> {
  await api(`/v1/organizations/${text(form, 'orgId')}/verification-request`, {
    method: 'POST',
    schema: OrganizationRecord,
  });
  revalidatePath('/workspace');
}

export async function respondToEngagement(_state: FormState, form: FormData): Promise<FormState> {
  const status = text(form, 'status');
  try {
    await api(`/v1/organizations/${text(form, 'orgId')}/engagements/${text(form, 'engagementId')}/respond`, {
      method: 'POST',
      body: {
        status,
        message: text(form, 'message') || null,
        contactName: text(form, 'contactName') || null,
        contactEmail: text(form, 'contactEmail') || null,
      },
      schema: Engagement,
    });
  } catch (error) {
    return { error: describeError(error) };
  }
  revalidatePath('/workspace');
  return { message: status === 'acknowledged' ? 'Accepted; the buyer has been notified.' : 'Declined.' };
}
