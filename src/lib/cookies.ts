import type { Context } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { env } from '../env.js';

export const AUTH_COOKIE = 'token';

const MAX_AGE_SECONDS = 60 * 60 * 24; // 24h — matches JWT TTL.

const isProd = env.NODE_ENV === 'production';

// SameSite=None requires Secure, which browsers reject over plain HTTP. In prod
// (HTTPS) we need None for cross-site cookies; in dev we fall back to Lax so the
// cookie works on http://localhost.
const cookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? ('None' as const) : ('Lax' as const),
  path: '/',
};

export function setAuthCookie(c: Context, token: string): void {
  setCookie(c, AUTH_COOKIE, token, { ...cookieOptions, maxAge: MAX_AGE_SECONDS });
}

export function clearAuthCookie(c: Context): void {
  deleteCookie(c, AUTH_COOKIE, cookieOptions);
}

export function getAuthToken(c: Context): string | undefined {
  return getCookie(c, AUTH_COOKIE);
}
