import {
  ACCESS_TOKEN_COOKIE,
  CSRF_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TTL_MS,
  applyAuthCookies,
  buildAuthCookies,
  buildClearedAuthCookies,
  clearAuthCookies,
  generateCsrfToken,
} from './cookies.helper';
import { ACCESS_TOKEN_TTL_MS } from './auth.constants';

describe('cookies.helper', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const tokens = { accessToken: 'access-jwt', refreshToken: 'raw-refresh' };

  const makeRes = () => ({
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('buildAuthCookies', () => {
    it('uses SameSite=None + Secure in production (cross-site deployment)', () => {
      process.env.NODE_ENV = 'production';

      const cookies = buildAuthCookies(tokens);

      for (const cookie of cookies) {
        expect(cookie.options.sameSite).toBe('none');
        expect(cookie.options.secure).toBe(true);
      }
    });

    it('uses SameSite=Lax without Secure outside production (localhost)', () => {
      process.env.NODE_ENV = 'development';

      const cookies = buildAuthCookies(tokens);

      for (const cookie of cookies) {
        expect(cookie.options.sameSite).toBe('lax');
        expect(cookie.options.secure).toBe(false);
      }
    });

    it('configures access_token httpOnly, site-wide, maxAge mirroring the JWT TTL', () => {
      const access = buildAuthCookies(tokens).find(
        (c) => c.name === ACCESS_TOKEN_COOKIE,
      );

      expect(access).toMatchObject({
        value: tokens.accessToken,
        options: {
          httpOnly: true,
          path: '/',
          maxAge: ACCESS_TOKEN_TTL_MS,
        },
      });
    });

    it('scopes refresh_token to /api/auth with 7d maxAge', () => {
      const refresh = buildAuthCookies(tokens).find(
        (c) => c.name === REFRESH_TOKEN_COOKIE,
      );

      expect(refresh).toMatchObject({
        value: tokens.refreshToken,
        options: {
          httpOnly: true,
          path: '/api/auth',
          maxAge: 7 * 24 * 60 * 60 * 1000,
        },
      });
    });

    it('keeps csrf_token JS-readable, site-wide, with the same maxAge as refresh_token', () => {
      const cookies = buildAuthCookies(tokens);
      const csrf = cookies.find((c) => c.name === CSRF_TOKEN_COOKIE);
      const refresh = cookies.find((c) => c.name === REFRESH_TOKEN_COOKIE);

      expect(csrf?.options.httpOnly).toBe(false);
      expect(csrf?.options.path).toBe('/');
      expect(csrf?.value).toHaveLength(64);
      // POST /api/auth/refresh is CSRF-guarded: a session-only csrf_token
      // would be dropped on browser restart while the 7-day refresh_token
      // survives, turning every restored session into a 403 + /login.
      expect(refresh?.options.maxAge).toBe(REFRESH_TTL_MS);
      expect(csrf?.options.maxAge).toBe(REFRESH_TTL_MS);
      expect(csrf?.options.maxAge).toBe(refresh?.options.maxAge);
    });

    it('reuses an existing csrf token when provided', () => {
      const csrf = buildAuthCookies(tokens, 'existing-csrf').find(
        (c) => c.name === CSRF_TOKEN_COOKIE,
      );

      expect(csrf?.value).toBe('existing-csrf');
    });
  });

  describe('buildClearedAuthCookies', () => {
    it('expires all three cookies keeping the refresh path scoped', () => {
      const cleared = buildClearedAuthCookies();

      expect(cleared.map((c) => c.name)).toEqual([
        ACCESS_TOKEN_COOKIE,
        REFRESH_TOKEN_COOKIE,
        CSRF_TOKEN_COOKIE,
      ]);

      const refresh = cleared.find((c) => c.name === REFRESH_TOKEN_COOKIE);
      expect(refresh?.options.path).toBe('/api/auth');
    });

    it.each(['development', 'production'])(
      'clears each cookie with the same path, httpOnly, sameSite and secure it was set with (%s)',
      (env) => {
        process.env.NODE_ENV = env;
        const set = buildAuthCookies(tokens);
        const cleared = buildClearedAuthCookies();

        for (const name of [
          ACCESS_TOKEN_COOKIE,
          REFRESH_TOKEN_COOKIE,
          CSRF_TOKEN_COOKIE,
        ]) {
          const setOptions = set.find((c) => c.name === name)?.options;
          const clearedOptions = cleared.find((c) => c.name === name)?.options;

          expect(clearedOptions).toBeDefined();
          expect(clearedOptions).toMatchObject({
            path: setOptions?.path,
            httpOnly: setOptions?.httpOnly,
            sameSite: setOptions?.sameSite,
            secure: setOptions?.secure,
          });
          // The cleared descriptor carries no lifetime of its own:
          // clearCookie() supplies the past Expires.
          expect(clearedOptions?.maxAge).toBeUndefined();
        }
      },
    );
  });

  describe('applyAuthCookies / clearAuthCookies', () => {
    it('writes every descriptor onto the response', () => {
      process.env.NODE_ENV = 'development';
      const res = makeRes();

      applyAuthCookies(res as never, tokens);

      expect(res.cookie).toHaveBeenCalledTimes(3);
      expect(res.cookie).toHaveBeenCalledWith(
        ACCESS_TOKEN_COOKIE,
        tokens.accessToken,
        expect.objectContaining({ httpOnly: true }),
      );
    });

    it('clears every auth cookie on the response', () => {
      const res = makeRes();

      clearAuthCookies(res as never);

      expect(res.clearCookie).toHaveBeenCalledTimes(3);
      expect(res.clearCookie).toHaveBeenCalledWith(
        CSRF_TOKEN_COOKIE,
        expect.objectContaining({ httpOnly: false, path: '/' }),
      );
    });
  });

  describe('generateCsrfToken', () => {
    it('produces unique hex tokens', () => {
      const a = generateCsrfToken();
      const b = generateCsrfToken();

      expect(a).not.toBe(b);
      expect(a).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
