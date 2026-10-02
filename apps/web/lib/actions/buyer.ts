'use server';

import { Engagement, EngagementPreview, RequirementView, ValidationIssue } from '@atx/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { api, describeError } from '../api';
import { decodeConstraintParams } from '../constraints';
import type { FormState } from './auth';

const text = (form: FormData, key: string): string => String(form.get(key) ?? '').trim();

export async function createRequirement(_state: FormState, form: FormData): Promise<FormState> {
  const orgId = text(form, 'orgId');
  let id: string;
  try {
    const result = await api(`/v1/organizations/${orgId}/requirements`, {
      method: 'POST',
      body: {
        title: text(form, 'title'),
        description: text(form, 'description'),
        confidentialTerms: text(form, 'confidentialTerms')
          .split(/[,\n]/)
          .map((t) => t.trim())
          .filter(Boolean),
      },
      schema: z.object({ requirement: RequirementView, issues: z.array(ValidationIssue) }),
    });
    id = result.requirement.id;
  } catch (error) {
    return { error: describeError(error) };
  }
  redirect(`/buyer/requirements/${id}?org=${orgId}`);
}

/** Saves the constraints a buyer sees on the search page as a private requirement. */
export async function saveSearchAsRequirement(_state: FormState, form: FormData): Promise<FormState> {
  const orgId = text(form, 'orgId');
  const constraints = decodeConstraintParams(form.getAll('c').map(String));
  if (constraints.length === 0) return { error: 'There are no constraints to save.' };
  const searchText = text(form, 'description');
  let id: string;
  try {
    const result = await api(`/v1/organizations/${orgId}/requirements`, {
      method: 'POST',
      body: {
        title: text(form, 'title'),
        // The requirement keeps the search text as its private description (at least 10 characters).
        description:
          searchText.length >= 10 ? searchText : `Saved from search: ${searchText || 'constraints'}`,
        constraints,
      },
      schema: z.object({ requirement: RequirementView, issues: z.array(ValidationIssue) }),
    });
    id = result.requirement.id;
  } catch (error) {
    return { error: describeError(error) };
  }
  redirect(`/buyer/requirements/${id}?org=${orgId}`);
}

export interface RequestState extends FormState {
  readonly preview?: z.infer<typeof EngagementPreview>;
  readonly draft?: Record<string, string>;
  readonly idempotencyKey?: string;
  readonly submitted?: boolean;
}

const draftFrom = (form: FormData) => {
  const draft: Record<string, string> = {
    buyerOrganizationId: text(form, 'buyerOrganizationId'),
    offeringId: text(form, 'offeringId'),
    type: text(form, 'type'),
    message: text(form, 'message'),
    contactName: text(form, 'contactName'),
    contactEmail: text(form, 'contactEmail'),
  };
  if (text(form, 'requirementId')) draft['requirementId'] = text(form, 'requirementId');
  if (text(form, 'disclosedSummary')) draft['disclosedSummary'] = text(form, 'disclosedSummary');
  return draft;
};

/** Step 1: build the exact disclosure preview. Nothing is sent. */
export async function prepareRequest(_state: RequestState, form: FormData): Promise<RequestState> {
  const draft = draftFrom(form);
  try {
    const preview = await api('/v1/engagements/prepare', {
      method: 'POST',
      body: draft,
      schema: EngagementPreview,
    });
    return { preview, draft, idempotencyKey: crypto.randomUUID() };
  } catch (error) {
    return { error: describeError(error), draft };
  }
}

/**
 * Step 2: only after the user explicitly approved the preview. The reviewed
 * draft travels in hidden fields; the API verifies it against the digest bound
 * into the confirmation token, so any change after review is rejected.
 */
export async function confirmRequest(_state: RequestState, form: FormData): Promise<RequestState> {
  if (form.get('approve') !== 'yes')
    return { error: 'Tick the approval box to confirm exactly what will be shared.' };
  try {
    await api('/v1/engagements', {
      method: 'POST',
      body: {
        ...draftFrom(form),
        confirmationToken: text(form, 'confirmationToken'),
        idempotencyKey: text(form, 'idempotencyKey'),
      },
      schema: z.object({ engagement: Engagement, replayed: z.boolean() }),
    });
    return { submitted: true, message: 'Request sent to the supplier.' };
  } catch (error) {
    return { error: describeError(error) };
  }
}

export async function setRequirementAlerts(form: FormData): Promise<void> {
  const orgId = String(form.get('orgId') ?? '');
  const requirementId = String(form.get('requirementId') ?? '');
  await api(`/v1/organizations/${orgId}/requirements/${requirementId}/alerts`, {
    method: 'PUT',
    body: { enabled: form.get('enabled') === 'true' },
    schema: z.object({ enabled: z.boolean() }),
  });
  revalidatePath(`/buyer/requirements/${requirementId}`);
}
