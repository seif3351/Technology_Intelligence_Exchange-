'use server';

import { OAuthAuthorizationRequest } from '@atx/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { api, describeError } from '../api';
import type { FormState } from './auth';

const FIELDS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'code_challenge',
  'code_challenge_method',
  'scope',
  'state',
  'resource',
] as const;

/** Consent decision: the API validates everything again and returns where to send the browser. */
export async function decideAuthorization(_state: FormState, form: FormData): Promise<FormState> {
  const raw = Object.fromEntries(
    FIELDS.flatMap((field) => {
      const value = form.get(field);
      return typeof value === 'string' && value !== '' ? [[field, value]] : [];
    }),
  );
  const parsed = OAuthAuthorizationRequest.safeParse(raw);
  if (!parsed.success) return { error: 'This authorization request is incomplete.' };
  let redirectTo: string;
  try {
    ({ redirectTo } = await api('/v1/oauth/authorization/decision', {
      method: 'POST',
      body: { ...parsed.data, approve: form.get('decision') === 'approve' },
      schema: z.object({ redirectTo: z.string() }),
    }));
  } catch (error) {
    return { error: describeError(error) };
  }
  redirect(redirectTo);
}

export async function revokeConnection(form: FormData): Promise<void> {
  await api(`/v1/oauth/connections/${String(form.get('grantId') ?? '')}/revoke`, {
    method: 'POST',
    body: {},
    schema: z.object({ revoked: z.literal(true) }),
  });
  revalidatePath('/account');
}
