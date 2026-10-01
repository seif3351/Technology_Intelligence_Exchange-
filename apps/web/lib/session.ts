import 'server-only';
import { cookies } from 'next/headers';
import { webConfig } from './config';

/**
 * Backend-for-frontend session: the API access token lives only in an
 * httpOnly, SameSite=Lax cookie and is attached server-side. Client-side
 * JavaScript never sees it. Mutations go through Server Actions, which Next.js
 * protects against CSRF by comparing Origin and Host.
 */
const COOKIE = 'atx_session';

export const getSessionToken = async (): Promise<string | null> => (await cookies()).get(COOKIE)?.value ?? null;

export const setSessionToken = async (token: string, maxAgeSeconds: number): Promise<void> => {
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: webConfig.secureCookies,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  });
};

export const clearSession = async (): Promise<void> => {
  (await cookies()).delete(COOKIE);
};
