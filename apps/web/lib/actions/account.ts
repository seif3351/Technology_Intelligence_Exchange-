'use server';

import { PasswordResetConfirm, PasswordResetRequest } from '@atx/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { api, describeError } from '../api';
import { clearSession } from '../session';
import type { FormState } from './auth';

export async function requestPasswordReset(_state: FormState, form: FormData): Promise<FormState> {
  const parsed = PasswordResetRequest.safeParse({ email: String(form.get('email') ?? '').trim() });
  if (!parsed.success) return { error: 'Enter a valid email address.' };
  try {
    await api('/v1/auth/password-reset/request', {
      method: 'POST',
      body: parsed.data,
      schema: z.object({ accepted: z.literal(true) }),
      anonymous: true,
    });
  } catch (error) {
    return { error: describeError(error) };
  }
  return {
    message: 'If an account exists for this address, a reset link is on its way. It is valid for one hour.',
  };
}

export async function resetPassword(_state: FormState, form: FormData): Promise<FormState> {
  const parsed = PasswordResetConfirm.safeParse({
    token: String(form.get('token') ?? ''),
    newPassword: form.get('newPassword'),
  });
  if (!parsed.success) return { error: 'Choose a password of at least 12 characters.' };
  try {
    await api('/v1/auth/password-reset/confirm', {
      method: 'POST',
      body: parsed.data,
      schema: z.object({ reset: z.literal(true) }),
      anonymous: true,
    });
  } catch (error) {
    return { error: describeError(error) };
  }
  await clearSession();
  redirect('/login?reset=1');
}

export async function resendVerification(_state: FormState): Promise<FormState> {
  try {
    const { sent } = await api('/v1/auth/email-verification/resend', {
      method: 'POST',
      body: {},
      schema: z.object({ sent: z.boolean() }),
    });
    return sent
      ? { message: 'A new confirmation link was sent.' }
      : { message: 'Your email is already confirmed.' };
  } catch (error) {
    return { error: describeError(error) };
  }
}

export async function signOutEverywhere(): Promise<void> {
  await api('/v1/auth/sign-out-everywhere', {
    method: 'POST',
    body: {},
    schema: z.object({ revoked: z.literal(true) }),
  });
  await clearSession();
  revalidatePath('/');
  redirect('/login');
}
