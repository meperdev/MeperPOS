import { response, type Response } from 'express';
import { applyAuthCookies, clearAuthCookies } from './cookies.helper';

/**
 * Real Express serialization of the csrf_token cookie (no port opened): the
 * persistent cookie set at login must be expired on logout at the same scope,
 * or the browser keeps it for the full refresh lifetime.
 */
describe('csrf_token Set-Cookie headers through Express', () => {
  it('expires the persistent production CSRF cookie at its original scope', () => {
    const env = jest.replaceProperty(process, 'env', {
      ...process.env,
      NODE_ENV: 'production',
    });

    try {
      const append = jest.fn<void, [string, string]>();
      const res = Object.assign(Object.create(response) as Response, {
        req: {},
        append,
      });

      applyAuthCookies(res, { accessToken: 'access', refreshToken: 'refresh' });
      clearAuthCookies(res);

      const headers = append.mock.calls
        .filter(
          ([name, value]) =>
            name === 'Set-Cookie' && value.startsWith('csrf_token='),
        )
        .map(([, value]) => value);
      expect(headers).toHaveLength(2);
      const [set, clear] = headers;

      expect(set).toContain('Max-Age=604800');
      for (const header of headers) {
        expect(header).toContain('; Path=/;');
        expect(header).toContain('; Secure; SameSite=None');
        expect(header).not.toContain('HttpOnly');
      }
      expect(clear).toBe(
        'csrf_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; SameSite=None',
      );
    } finally {
      env.restore();
    }
  });
});
