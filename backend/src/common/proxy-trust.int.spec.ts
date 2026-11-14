import { Controller, Get, INestApplication, Req } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import type { Server } from 'http';
import request from 'supertest';
import { configureApp } from '../app-configuration';
import { DEFAULT_TRUST_PROXY_HOPS, resolveTrustProxyHops } from './proxy-trust';

/**
 * Proxy trust and client-IP resolution (spec S4.2, S4.4, S4.7).
 *
 * The confirmed finding: `trust proxy` was unset while the API runs behind the
 * Railway edge, so `req.ip` was the proxy address. That made the per-IP rate
 * limiter bucket every client together and wrote proxy addresses into the
 * audit log. The rule under test: the resolved client IP is the entry of
 * `X-Forwarded-For` that the configured hop count still allows, so a
 * client-supplied (forged) left-most entry can never become the client IP.
 *
 * `configureApp` is the exact wiring main.ts applies, so this spec exercises
 * the production path rather than a copy of it.
 */
@Controller('echo')
class EchoIpController {
  @Get('ip')
  ip(@Req() req: Request): { ip: string | undefined } {
    return { ip: req.ip };
  }
}

async function bootApp(hops: string | undefined): Promise<INestApplication> {
  const previous = process.env.TRUST_PROXY_HOPS;
  if (hops === undefined) {
    delete process.env.TRUST_PROXY_HOPS;
  } else {
    process.env.TRUST_PROXY_HOPS = hops;
  }

  try {
    const moduleRef = await Test.createTestingModule({
      controllers: [EchoIpController],
    }).compile();

    const app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    return app;
  } finally {
    if (previous === undefined) {
      delete process.env.TRUST_PROXY_HOPS;
    } else {
      process.env.TRUST_PROXY_HOPS = previous;
    }
  }
}

async function resolveClientIp(
  app: INestApplication,
  forwardedFor?: string,
): Promise<string | undefined> {
  const server = app.getHttpServer() as Server;
  const call = request(server).get('/api/echo/ip');

  const res =
    forwardedFor === undefined
      ? await call
      : await call.set('X-Forwarded-For', forwardedFor);

  return (res.body as { ip?: string }).ip;
}

describe('client IP resolution behind the edge proxy (spec S4.2)', () => {
  it('with the default single hop, a forged left-most X-Forwarded-For entry does NOT become the client IP', async () => {
    const app = await bootApp(undefined);
    try {
      // 9.9.9.9 is what the trusted proxy appended; 1.2.3.4 is client-supplied.
      expect(await resolveClientIp(app, '1.2.3.4, 9.9.9.9')).toBe('9.9.9.9');
    } finally {
      await app.close();
    }
  });

  it('with the default single hop and no forwarded header, the socket address is used (no header, no trust)', async () => {
    const app = await bootApp(undefined);
    try {
      // Express reports IPv4 sockets in IPv4-mapped IPv6 form here.
      expect(await resolveClientIp(app)).toMatch(/127\.0\.0\.1$/);
    } finally {
      await app.close();
    }
  });

  it('trusting two hops resolves the entry two positions from the right (topology is explicit, never a wildcard)', async () => {
    const app = await bootApp('2');
    try {
      expect(await resolveClientIp(app, '1.2.3.4, 9.9.9.9')).toBe('1.2.3.4');
    } finally {
      await app.close();
    }
  });

  it('TRUST_PROXY_HOPS=0 disables trust entirely, for a directly exposed process', async () => {
    const app = await bootApp('0');
    try {
      const ip = await resolveClientIp(app, '1.2.3.4, 9.9.9.9');

      expect(ip).toMatch(/127\.0\.0\.1$/);
      expect(ip).not.toBe('9.9.9.9');
    } finally {
      await app.close();
    }
  });

  it('the parser defaults to one hop when the variable is unset and accepts only a bounded hop count', () => {
    expect(resolveTrustProxyHops({} as NodeJS.ProcessEnv)).toBe(
      DEFAULT_TRUST_PROXY_HOPS,
    );
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: '  ' })).toBe(
      DEFAULT_TRUST_PROXY_HOPS,
    );
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: '3' })).toBe(3);
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: 'false' })).toBe(false);
    expect(() => resolveTrustProxyHops({ TRUST_PROXY_HOPS: 'true' })).toThrow(
      /TRUST_PROXY_HOPS/,
    );
    expect(() => resolveTrustProxyHops({ TRUST_PROXY_HOPS: '-1' })).toThrow(
      /TRUST_PROXY_HOPS/,
    );
    expect(() => resolveTrustProxyHops({ TRUST_PROXY_HOPS: '1.5' })).toThrow(
      /TRUST_PROXY_HOPS/,
    );
    expect(() => resolveTrustProxyHops({ TRUST_PROXY_HOPS: '99' })).toThrow(
      /TRUST_PROXY_HOPS/,
    );
  });
});
