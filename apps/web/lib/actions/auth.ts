'use server';

import { LoginRequest, TokenResponse } from '@atx/contracts';
import { redirect } from 'next/navigation';
import { api, describeError } from '../api';
import { clearSession, setSessionToken } from '../session';

export interface FormState {
  readonly error?: string;
  readonly message?: string;
}

const safeRedirectTarget = (value: FormDataEntryValue | null): string => {
  const target = typeof value === 'string' ? value : '/';
  // Only same-origin relative paths: prevents open redirects.
  return target.startsWith('/') && !target.startsWith('//') ? target : '/';
};

export async function login(_state: FormState, form: FormData): Promise<FormState> {
  const parsed = LoginRequest.safeParse({ email: form.get('email'), password: form.get('password') });
  if (!parsed.success) return { error: 'Enter a valid email and password.' };
  try {
    const token = await api('/v1/auth/login', {
      method: 'POST',
      body: parsed.data,
      schema: TokenResponse,
      anonymous: true,
    });
    await setSessionToken(token.accessToken, token.expiresIn);
  } catch (error) {
    return { error: describeError(error) };
  }
  redirect(safeRedirectTarget(form.get('next')));
}

export async function logout(): Promise<void> {
  await clearSession();
  redirect('/');
}
