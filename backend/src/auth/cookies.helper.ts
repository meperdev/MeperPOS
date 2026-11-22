import { randomBytes } from 'crypto';
import { Response } from 'express';
import { ACCESS_TOKEN_TTL_MS } from './auth.constants';

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';
export const CSRF_TOKEN_COOKIE = 'csrf_token';

/**
 * TTLs mirror AuthService.generateTokenPair(): access JWTs are signed with
 * expiresIn ACCESS_TOKEN_TTL_SECONDS (the cookie maxAge reuses the shared
 * ACCESS_TOKEN_TTL_MS constant from auth.constants.ts so the JWT and its
 * cookie can never drift) and refresh-token rows expire 7 days after
 * issuance.
 *
 * REFRESH_TTL_MS is the lifetime of the whole cookie session: refresh_token
 * and csrf_token both use it, because POST /api/auth/refresh is CSRF-guarded
 * and needs both cookies to survive a browser restart together.
 */
export const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface AuthCookieOptions {
  httpOnly: boolean;
  sameSite: 'lax' | 'none';
  secure: boolean;
  path: string;
  maxAge?: number;
}

export interface CookieDescriptor {
  name: string;
  value?: string;
  options: AuthCookieOptions;
}

/**
 * Cross-site deployments (Vercel frontend -> Railway API) require
 * SameSite=None; Secure, while localhost development works best with Lax.
 */
function resolveSitePolicy(): { sameSite: 'lax' | 'none'; secure: boolean } {
  return process.env.NODE_ENV === 'production'
    ? { sameSite: 'none', secure: true }
    : { sameSite: 'lax', secure: false };
}

export function generateCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Builds Set-Cookie descriptors for a fresh session:
 * - access_token: httpOnly, site-wide (path /)
 * - refresh_token: httpOnly, scoped to /api/auth so it is only sent to auth routes
 * - csrf_token: readable by JS (double-submit CSRF pattern), same maxAge as
 *   refresh_token (REFRESH_TTL_MS). It must not be session-scoped: the
 *   CSRF-guarded refresh needs it after a browser restart drops session
 *   cookies, or a valid 7-day session ends in 403 + /login.
 *
 * The existing csrf_token cookie is reused when present so open tabs keep a
 * stable header value across token rotations.
 */
export function buildAuthCookies(
  tokens: { accessToken: string; refreshToken: string },
  existingCsrfToken?: string | null,
): CookieDescriptor[] {
  const { sameSite, secure } = resolveSitePolicy();
  const csrfToken =
    existingCsrfToken && existingCsrfToken.length > 0
      ? existingCsrfToken
      : generateCsrfToken();

  return [
    {
      name: ACCESS_TOKEN_COOKIE,
      value: tokens.accessToken,
      options: {
        httpOnly: true,
        sameSite,
        secure,
        path: '/',
        maxAge: ACCESS_TOKEN_TTL_MS,
      },
    },
    {
      name: REFRESH_TOKEN_COOKIE,
      value: tokens.refreshToken,
      options: {
        httpOnly: true,
        sameSite,
        secure,
        path: '/api/auth',
        maxAge: REFRESH_TTL_MS,
      },
    },
    {
      name: CSRF_TOKEN_COOKIE,
      value: csrfToken,
      options: {
        httpOnly: false,
        sameSite,
        secure,
        path: '/',
        maxAge: REFRESH_TTL_MS,
      },
    },
  ];
}

/**
 * Descriptors for expiring every auth cookie on logout. Express's
 * clearCookie() adds the past Expires header (and ignores any maxAge); each
 * cookie must repeat the path (refresh_token: /api/auth), sameSite and secure
 * it was set with, or the browser will not remove it.
 */
export function buildClearedAuthCookies(): CookieDescriptor[] {
  const { sameSite, secure } = resolveSitePolicy();

  return [
    {
      name: ACCESS_TOKEN_COOKIE,
      options: { httpOnly: true, sameSite, secure, path: '/' },
    },
    {
      name: REFRESH_TOKEN_COOKIE,
      options: { httpOnly: true, sameSite, secure, path: '/api/auth' },
    },
    {
      name: CSRF_TOKEN_COOKIE,
      options: { httpOnly: false, sameSite, secure, path: '/' },
    },
  ];
}

/** Applies the given descriptors to the passthrough response. */
function writeCookies(res: Response, descriptors: CookieDescriptor[]): void {
  for (const descriptor of descriptors) {
    res.cookie(descriptor.name, descriptor.value ?? '', descriptor.options);
  }
}

/** Sets all session cookies on a passthrough response. */
export function applyAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
  existingCsrfToken?: string | null,
): void {
  writeCookies(res, buildAuthCookies(tokens, existingCsrfToken));
}

/** Expires all three auth cookies on a passthrough response. */
export function clearAuthCookies(res: Response): void {
  for (const descriptor of buildClearedAuthCookies()) {
    res.clearCookie(descriptor.name, descriptor.options);
  }
}
