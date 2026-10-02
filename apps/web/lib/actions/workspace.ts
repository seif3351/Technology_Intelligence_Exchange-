'use server';

import {
  AssetRecord,
  ClaimView,
  Engagement,
  EvidenceView,
  ExternalVideoCreate,
  OfferingRecord,
  OrganizationRecord,
} from '@atx/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, describeError } from '../api';
import type { FormState } from './auth';

const text = (form: FormData, key: string): string => String(form.get(key) ?? '').trim();
const optional = (form: FormData, key: string): string | undefined => text(form, key) || undefined;
const list = (form: FormData, key: string): string[] =>
  text(form, key)
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
const version = (form: FormData): number => Number(text(form, 'version'));
const done = (message: string): FormState => {
  revalidatePath('/workspace', 'layout');
  return { message };
};
const failed = (error: unknown): FormState => ({ error: describeError(error) });

// ------------------------------------------------------------------ offerings

export async function createOffering(_state: FormState, form: FormData): Promise<FormState> {
  const orgId = text(form, 'orgId');
  const type = text(form, 'type');
  let id: string;
  try {
    const offering = await api(`/v1/organizations/${orgId}/offerings`, {
      method: 'POST',
      body: {
        type,
        name: text(form, 'name'),
        summary: text(form, 'summary'),
        description: text(form, 'description'),
        maturity: text(form, 'maturity'),
        details: { type },
      },
      schema: OfferingRecord,
    });
    id = offering.id;
  } catch (error) {
    return failed(error);
  }
  revalidatePath('/workspace', 'layout');
  redirect(`/workspace/offerings/${id}?org=${orgId}&created=1`);
}

export async function updateOffering(_state: FormState, form: FormData): Promise<FormState> {
  try {
    await api(`/v1/organizations/${text(form, 'orgId')}/offerings/${text(form, 'offeringId')}`, {
      method: 'PATCH',
      body: {
        expectedVersion: version(form),
        name: text(form, 'name'),
        summary: text(form, 'summary'),
        description: text(form, 'description'),
        maturity: text(form, 'maturity'),
        regions: list(form, 'regions'),
        commercial: {
          pricingModel: optional(form, 'pricingModel') ?? null,
          availability: list(form, 'availability'),
          notes: optional(form, 'commercialNotes') ?? null,
        },
      },
      schema: OfferingRecord,
    });
    return done('Offering details saved.');
  } catch (error) {
    return failed(error);
  }
}

export async function setOfferingStatus(_state: FormState, form: FormData): Promise<FormState> {
  const status = text(form, 'status');
  try {
    await api(`/v1/organizations/${text(form, 'orgId')}/offerings/${text(form, 'offeringId')}/status`, {
      method: 'POST',
      body: { status, expectedVersion: version(form) },
      schema: OfferingRecord,
    });
    return done(status === 'published' ? 'Offering published.' : 'Offering withdrawn from public view.');
  } catch (error) {
    return failed(error);
  }
}

// --------------------------------------------------------------------- claims

/** Qualifier inputs are named `q.<key>` (e.g. q.asil, q.aspiceLevel, q.certificationBody). */
const qualifiersFrom = (form: FormData): Record<string, string> =>
  Object.fromEntries(
    [...form.entries()]
      .filter(([key, value]) => key.startsWith('q.') && String(value).trim() !== '')
      .map(([key, value]) => [key.slice(2), String(value).trim()]),
  );
/** A date field (YYYY-MM-DD) as the end of that day in UTC; empty clears it. */
const endOfDay = (value: string): string | null => (value ? `${value}T23:59:59.000Z` : null);

const claimFields = (form: FormData) => ({
  predicate: text(form, 'predicate'),
  conceptId: text(form, 'conceptId'),
  statement: text(form, 'statement'),
  qualifiers: qualifiersFrom(form),
  sourceUrl: optional(form, 'sourceUrl') ?? null,
  evidenceIds: form.getAll('evidenceIds').map(String).filter(Boolean),
  expiresAt: endOfDay(text(form, 'validUntil')),
});

export async function addClaim(_state: FormState, form: FormData): Promise<FormState> {
  const subjectType = text(form, 'subjectType') === 'organization' ? 'organization' : 'offering';
  try {
    await api(`/v1/organizations/${text(form, 'orgId')}/claims`, {
      method: 'POST',
      body: { subject: { type: subjectType, id: text(form, 'subjectId') }, ...claimFields(form) },
      schema: ClaimView,
    });
    return done('Draft claim added. Check its wording, then publish it.');
  } catch (error) {
    return failed(error);
  }
}

export async function reviseClaim(_state: FormState, form: FormData): Promise<FormState> {
  try {
    await api(`/v1/organizations/${text(form, 'orgId')}/claims/${text(form, 'claimId')}`, {
      method: 'PATCH',
      body: { expectedVersion: version(form), ...claimFields(form) },
      schema: ClaimView,
    });
    return done('Claim updated.');
  } catch (error) {
    return failed(error);
  }
}

/** Publish a draft or retract a claim (drafts are "discarded" by retracting them). */
export async function claimAction(_state: FormState, form: FormData): Promise<FormState> {
  const action = text(form, 'action') === 'publish' ? 'publish' : 'retract';
  try {
    await api(`/v1/organizations/${text(form, 'orgId')}/claims/${text(form, 'claimId')}/${action}`, {
      method: 'POST',
      body: { expectedVersion: version(form) },
      schema: ClaimView,
    });
    return done(action === 'publish' ? 'Claim published.' : 'Claim withdrawn.');
  } catch (error) {
    return failed(error);
  }
}

// ------------------------------------------------------------------- evidence

export async function addEvidence(_state: FormState, form: FormData): Promise<FormState> {
  const kind = text(form, 'kind');
  try {
    await api(`/v1/organizations/${text(form, 'orgId')}/evidence`, {
      method: 'POST',
      body: {
        offeringId: optional(form, 'offeringId') ?? null,
        kind,
        title: text(form, 'title'),
        description: text(form, 'description'),
        url: optional(form, 'url') ?? null,
        ...(kind === 'production_reference'
          ? { customerDisclosure: text(form, 'customerDisclosure') === 'named' ? 'named' : 'anonymized' }
          : {}),
      },
      schema: EvidenceView,
    });
    return done('Evidence added. Link it to the claims it supports.');
  } catch (error) {
    return failed(error);
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
      'Uploaded. The document is scanned and analysed in the background; AI-drafted claims will appear under "Drafts to review".',
    );
  } catch (error) {
    return failed(error);
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
    return { error: 'Please choose an offering and give the video a title and an https:// address.' };
  try {
    await api(`/v1/organizations/${text(form, 'orgId')}/videos`, {
      method: 'POST',
      body: parsed.data,
      schema: AssetRecord,
    });
    return done('Demo video registered.');
  } catch (error) {
    return failed(error);
  }
}

// --------------------------------------------------------------- organization

export async function updateOrganization(_state: FormState, form: FormData): Promise<FormState> {
  try {
    await api(`/v1/organizations/${text(form, 'orgId')}`, {
      method: 'PATCH',
      body: {
        expectedVersion: version(form),
        summary: text(form, 'summary'),
        description: text(form, 'description'),
        website: optional(form, 'website') ?? null,
        headquartersCountry: optional(form, 'headquartersCountry')?.toUpperCase() ?? null,
        regions: list(form, 'regions'),
        employeeRange: optional(form, 'employeeRange') ?? null,
      },
      schema: OrganizationRecord,
    });
    return done('Organization profile saved.');
  } catch (error) {
    return failed(error);
  }
}

export async function requestVerification(form: FormData): Promise<void> {
  await api(`/v1/organizations/${text(form, 'orgId')}/verification-request`, {
    method: 'POST',
    schema: OrganizationRecord,
  });
  revalidatePath('/workspace', 'layout');
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
    return failed(error);
  }
  revalidatePath('/workspace', 'layout');
  return { message: status === 'acknowledged' ? 'Accepted; the buyer has been notified.' : 'Declined.' };
}
