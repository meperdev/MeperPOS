import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'http';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app-configuration';

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

/**
 * `Cache-Control: no-store` on the API surface (spec S3: "Asegura
 * Cache-Control: no-store para respuestas de autenticación y datos sensibles de
 * usuarios, ventas, inventario y sesiones").
 *
 * The rule is deliberately blanket rather than an endpoint list: every route of
 * this API answers with user- or organization-scoped data, so a mistake in a
 * per-endpoint list would silently leave a response cacheable. The health probe
 * is included — a cached health answer would report a stale instance state.
 *
 * Boots the real AppModule with the exact wiring production applies
 * (configureApp, shared with main.ts), the same pattern as
 * security-headers.int.spec.ts.
 */
describe('Cache-Control: no-store on API responses (spec S3)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('an unauthenticated auth response (401) is not storable', async () => {
    const res = await request(httpServer(app)).get('/api/auth/profile');

    expect(res.status).toBe(401);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('an unknown route (404) is not storable either, so the rule cannot be bypassed by path guessing', async () => {
    const res = await request(httpServer(app)).get('/api/nonexistent-route');

    expect(res.status).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('the health probe is not storable, so a stale instance state is never replayed from a cache', async () => {
    const res = await request(httpServer(app)).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
