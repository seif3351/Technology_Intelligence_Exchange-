'use server';

import { LoginRequest, RegisterRequest, TokenResponse } from '@atx/contracts';
import { redirect } from 'next/navigation';
import { api, describeError } from '../api';
import { clearSession, setSessionToken } from '../session';

export interface FormState {
  readonly error?: string;
  readonly message?: string;
}

/** Login keeps the entered email: React resets uncontrolled fields after an action completes. */
export interface LoginState extends FormState {
  readonly email?: string;
}

const safeRedirectTarget = (value: FormDataEntryValue | null): string => {
  const target = typeof value === 'string' ? value : '/';
  // Only same-origin relative paths: prevents open redirects.
  return target.startsWith('/') && !target.startsWith('//') ? target : '/';
};

export async function login(_state: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get('email') ?? '').slice(0, 254);
  const parsed = LoginRequest.safeParse({ email, password: form.get('password') });
  if (!parsed.success) return { error: 'Enter a valid email and password.', email };
  try {
    const token = await api('/v1/auth/login', {
      method: 'POST',
      body: parsed.data,
      schema: TokenResponse,
      anonymous: true,
    });
    await setSessionToken(token.accessToken, token.expiresIn);
  } catch (error) {
    return { error: describeError(error), email };
  }
  redirect(safeRedirectTarget(form.get('next')));
}

export async function logout(): Promise<void> {
  await clearSession();
  redirect('/');
}

export async function signup(_state: FormState, form: FormData): Promise<FormState> {
  const invitationToken = String(form.get('invite') ?? '').trim();
  const parsed = RegisterRequest.safeParse({
    email: String(form.get('email') ?? '').trim(),
    password: form.get('password'),
    displayName: String(form.get('displayName') ?? '').trim(),
    acceptTerms: form.get('acceptTerms') === 'on' ? true : undefined,
    ...(invitationToken ? { invitationToken } : {}),
  });
  if (!parsed.success) {
    const fields = new Set(parsed.error.issues.map((issue) => String(issue.path[0])));
    if (fields.has('acceptTerms')) return { error: 'Please accept the terms of use and privacy notice.' };
    if (fields.has('password')) return { error: 'Choose a password of at least 12 characters.' };
    return { error: 'Enter your name and a valid email address.' };
  }
  try {
    const token = await api('/v1/auth/register', {
      method: 'POST',
      body: parsed.data,
      schema: TokenResponse,
      anonymous: true,
    });
    await setSessionToken(token.accessToken, token.expiresIn);
  } catch (error) {
    return { error: describeError(error) };
  }
  redirect('/onboarding');
}
