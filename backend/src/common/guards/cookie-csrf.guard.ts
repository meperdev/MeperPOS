import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { CSRF_TOKEN_COOKIE } from '../../auth/cookies.helper';
import { resolveAllowedOrigins } from '../../config/allowed-origins';

/**
 * Entry points that run before a session exists (or authenticate via a
 * body-carried pre-auth token instead of cookies) cannot be abused through
 * cookie riding and must stay reachable by the legacy Bearer-less frontend:
 * select-organization authenticates with the short-lived preAuthToken in the
 * request body, not with browser-held credentials.
 */
const CSRF_EXEMPT_PATHS = new Set([
  // SEC-007: login/register are NOT blindly exempt anymore — they go through
  // the pre-auth Origin check in this guard (see isPreAuthOriginAllowed).
  '/api/auth/register',
  // select-organization stays exempt: it authenticates with the short-lived
  // preAuthToken in the request body, not with browser-held credentials.
  '/api/auth/select-organization',
]);

/** Pre-auth entry points that must pass the Origin allowlist instead of a
 * CSRF token (no session cookie exists yet to double-submit against). */
const PRE_AUTH_ORIGIN_CHECKED_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/register',
]);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit CSRF protection for cookie sessions.
 *
 * Requests carrying an Authorization Bearer header are token-authenticated
 * and therefore immune to cookie riding, so they are skipped entirely. The
 * web frontend is a memory-token client that sends Bearer + cookies together
 * on every request, so the skip is what keeps it unaffected; a cross-site
 * attacker cannot set the Authorization header. Same-origin XSS bypasses CSRF
 * anyway, so dropping this skip would add no real protection while coupling
 * backend 403s to frontend header hygiene.
 */
@Injectable()
export class CookieCsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    const method: string = String(request.method ?? '').toUpperCase();
    if (SAFE_METHODS.has(method)) {
      return true;
    }

    const authHeader: unknown = request.headers?.authorization;
    if (
      typeof authHeader === 'string' &&
      authHeader.toLowerCase().startsWith('bearer')
    ) {
      return true;
    }

    const rawPath = String(request.path ?? request.url ?? '');
    const path = this.normalizePath(rawPath);
    // The only handler at this exact POST path independently verifies WAHA HMAC.
    if (method === 'POST' && path === '/api/whatsapp/webhook') {
      return true;
    }
    if (
      method === 'POST' &&
      PRE_AUTH_ORIGIN_CHECKED_PATHS.has(path)
    ) {
      return this.isPreAuthOriginAllowed(request);
    }

    if (CSRF_EXEMPT_PATHS.has(path)) {
      return true;
    }

    const headerToken: unknown = request.headers?.['x-csrf-token'];
    const cookieToken: unknown = request.cookies?.[CSRF_TOKEN_COOKIE];

    if (
      typeof headerToken === 'string' &&
      typeof cookieToken === 'string' &&
      headerToken.length > 0 &&
      headerToken.length === cookieToken.length &&
      timingSafeEqual(Buffer.from(headerToken), Buffer.from(cookieToken))
    ) {
      return true;
    }

    throw new ForbiddenException('CSRF token mismatch');
  }

  private normalizePath(path: string): string {
    const withoutQuery = path.split('?')[0];
    if (withoutQuery.length > 1) {
      return withoutQuery.replace(/\/+$/, '');
    }
    return withoutQuery;
  }

  /**
   * SEC-007: cross-site login (and register) CSRF defence. A browser always
   * attaches Origin to cross-origin POSTs, so an Origin outside the
   * deployment allowlist means a third-party site is trying to log the
   * victim into an attacker-controlled session. Absent Origin (native
   * clients) is allowed: without ambient cookies there is nothing to ride.
   */
  private isPreAuthOriginAllowed(request: {
    headers?: Record<string, unknown>;
  }): boolean {
    const origin: unknown = request.headers?.origin;

    if (typeof origin !== 'string' || origin.length === 0) {
      return true;
    }

    const allowed = resolveAllowedOrigins(process.env);
    if (allowed.includes(origin)) {
      return true;
    }

    throw new ForbiddenException('Cross-origin login rejected');
  }
}
