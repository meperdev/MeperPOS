import { ForbiddenException } from '@nestjs/common';
import { CookieCsrfGuard } from './cookie-csrf.guard';

describe('CookieCsrfGuard', () => {
  const guard = new CookieCsrfGuard();

  const makeContext = (request: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
    }) as never;

  const baseRequest = {
    method: 'POST',
    path: '/api/products',
    headers: {} as Record<string, unknown>,
    cookies: {} as Record<string, unknown>,
  };

  it('allows Bearer-authenticated requests without a CSRF header', () => {
    const request = {
      ...baseRequest,
      headers: { authorization: 'Bearer some-jwt' },
    };

    expect(guard.canActivate(makeContext(request))).toBe(true);
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'allows safe method %s without CSRF material',
    (method) => {
      const request = { ...baseRequest, method };

      expect(guard.canActivate(makeContext(request))).toBe(true);
    },
  );

  it('allows login from an allowed origin (same-site frontend)', () => {
    const request = {
      ...baseRequest,
      path: '/api/auth/login',
      headers: { origin: 'http://localhost:3000' },
    };

    expect(guard.canActivate(makeContext(request))).toBe(true);
  });

  it('allows login without an Origin header (native client, not a CSRF vector)', () => {
    const request = { ...baseRequest, path: '/api/auth/login' };

    expect(guard.canActivate(makeContext(request))).toBe(true);
  });

  it('rejects cross-site login with a foreign Origin (SEC-007)', () => {
    const request = {
      ...baseRequest,
      path: '/api/auth/login',
      headers: { origin: 'https://evil.example' },
    };

    expect(() => guard.canActivate(makeContext(request))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects cross-site login even when a foreign csrf cookie pair is presented (SEC-007)', () => {
    const request = {
      ...baseRequest,
      path: '/api/auth/login',
      cookies: { csrf_token: 'abc' },
      headers: { origin: 'https://evil.example', 'x-csrf-token': 'abc' },
    };

    expect(() => guard.canActivate(makeContext(request))).toThrow(
      ForbiddenException,
    );
  });

  it('allows exempt register path', () => {
    const request = { ...baseRequest, path: '/api/auth/register' };

    expect(guard.canActivate(makeContext(request))).toBe(true);
  });

  it('requires CSRF on refresh with trailing slash and query string (SEC-005)', () => {
    const request = {
      ...baseRequest,
      path: '/api/auth/refresh/',
      url: '/api/auth/refresh/?source=legacy',
      cookies: { csrf_token: 'abc' },
    };

    expect(() => guard.canActivate(makeContext(request))).toThrow(
      ForbiddenException,
    );
  });

  it('allows a refresh request carrying the matching double-submit header', () => {
    const request = {
      ...baseRequest,
      path: '/api/auth/refresh',
      cookies: { csrf_token: 'abc' },
      headers: { 'x-csrf-token': 'abc' },
    };

    expect(guard.canActivate(makeContext(request))).toBe(true);
  });

  it('requires a CSRF header on refresh: a cookie-only POST is rejected (SEC-005)', () => {
    const request = {
      ...baseRequest,
      path: '/api/auth/refresh',
      cookies: { csrf_token: 'abc' },
    };

    expect(() => guard.canActivate(makeContext(request))).toThrow(
      ForbiddenException,
    );
  });

  it('allows exempt select-organization path (pre-session, body-carried preAuthToken)', () => {
    const request = { ...baseRequest, path: '/api/auth/select-organization' };

    expect(guard.canActivate(makeContext(request))).toBe(true);
  });

  it('exempts only POST to the HMAC-authenticated WAHA webhook', () => {
    expect(
      guard.canActivate(
        makeContext({ ...baseRequest, path: '/api/whatsapp/webhook' }),
      ),
    ).toBe(true);
    expect(() =>
      guard.canActivate(
        makeContext({ ...baseRequest, path: '/api/whatsapp/webhook/other' }),
      ),
    ).toThrow(ForbiddenException);
    expect(() =>
      guard.canActivate(
        makeContext({
          ...baseRequest,
          method: 'PUT',
          path: '/api/whatsapp/webhook',
        }),
      ),
    ).toThrow(ForbiddenException);
    expect(() =>
      guard.canActivate(
        makeContext({ ...baseRequest, path: '/api/whatsapp/session' }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects cookie-authenticated mutation with missing CSRF header', () => {
    const request = {
      ...baseRequest,
      cookies: { csrf_token: 'token-value' },
    };

    expect(() => guard.canActivate(makeContext(request))).toThrow(
      new ForbiddenException('CSRF token mismatch'),
    );
  });

  it('rejects mutation with mismatched CSRF header value', () => {
    const request = {
      ...baseRequest,
      headers: { 'x-csrf-token': 'wrong-value' },
      cookies: { csrf_token: 'expected-value' },
    };

    expect(() => guard.canActivate(makeContext(request))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects when the csrf cookie is absent but header present', () => {
    const request = {
      ...baseRequest,
      headers: { 'x-csrf-token': 'orphan-header' },
    };

    expect(() => guard.canActivate(makeContext(request))).toThrow(
      ForbiddenException,
    );
  });

  it('accepts matching header/cookie pair on a cookie-authenticated mutation', () => {
    const token = 'a'.repeat(64);
    const request = {
      ...baseRequest,
      headers: { 'x-csrf-token': token },
      cookies: { csrf_token: token },
    };

    expect(guard.canActivate(makeContext(request))).toBe(true);
  });
});

describe('CookieCsrfGuard pre-auth Origin allowlist (SEC-007)', () => {
  const guard = new CookieCsrfGuard();
  const originalCorsOrigin = process.env.CORS_ORIGIN;
  const PROD_ORIGINS = [
    'https://pos.mepersoft.app',
    'https://pos-pwa.mepersoft.app',
  ];

  const makeContext = (request: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
    }) as never;

  const preAuthRequest = (path: string, origin: string) => ({
    method: 'POST',
    path,
    headers: { origin },
    cookies: {},
  });

  beforeEach(() => {
    process.env.CORS_ORIGIN = PROD_ORIGINS.join(',');
  });

  afterEach(() => {
    if (originalCorsOrigin === undefined) {
      delete process.env.CORS_ORIGIN;
    } else {
      process.env.CORS_ORIGIN = originalCorsOrigin;
    }
  });

  it.each(PROD_ORIGINS)(
    'allows login from %s when CORS_ORIGIN lists it (2026-11-22 PWA regression)',
    (origin) => {
      expect(
        guard.canActivate(
          makeContext(preAuthRequest('/api/auth/login', origin)),
        ),
      ).toBe(true);
    },
  );

  it('still rejects a foreign Origin when the production allowlist is configured', () => {
    expect(() =>
      guard.canActivate(
        makeContext(preAuthRequest('/api/auth/login', 'https://evil.example')),
      ),
    ).toThrow(new ForbiddenException('Cross-origin login rejected'));
  });

  it('rejects the Vercel preview Origin excluded from the production allowlist', () => {
    expect(() =>
      guard.canActivate(
        makeContext(
          preAuthRequest('/api/auth/login', 'https://meperpos.vercel.app'),
        ),
      ),
    ).toThrow(new ForbiddenException('Cross-origin login rejected'));
  });

  it('tolerates whitespace and trailing slashes in the configured CORS_ORIGIN', () => {
    process.env.CORS_ORIGIN =
      ' https://pos.mepersoft.app/ , https://pos-pwa.mepersoft.app ';

    for (const origin of PROD_ORIGINS) {
      expect(
        guard.canActivate(
          makeContext(preAuthRequest('/api/auth/login', origin)),
        ),
      ).toBe(true);
    }
  });

  it('applies the same allowlist to register', () => {
    expect(
      guard.canActivate(
        makeContext(
          preAuthRequest('/api/auth/register', 'https://pos-pwa.mepersoft.app'),
        ),
      ),
    ).toBe(true);
  });
});
