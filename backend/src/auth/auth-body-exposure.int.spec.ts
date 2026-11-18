import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app-configuration';

/**
 * Auth-material exposure surface (issue #48, spec 3.R2 — design Option B).
 *
 * Boots the real AppModule with production wiring and drives the actual HTTP
 * auth flows: accessToken stays in the JSON body (the documented controlled
 * path that seeds the frontend memory store), while refreshToken is NEVER
 * present in any response body — the httpOnly, /api/auth-scoped cookie is the
 * only refresh transport.
 */
describe('Auth body exposure — cookie-only refresh transport (spec 3.R2, Option B)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let orgAId: string;
  let orgBId: string;
  let singleOrgEmail: string;
  let multiOrgEmail: string;

  const password = 'Body-Exposure-Pass-123!';
  const unique = `body-exposure-${Date.now()}`;

  function findCookie(
    cookies: string[] | undefined,
    name: string,
  ): string | undefined {
    return cookies?.find((c) => c.startsWith(`${name}=`));
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();

    prisma = new PrismaClient();

    const [orgA, orgB, hashed] = await Promise.all([
      prisma.organization.create({
        data: {
          name: `${unique} Org A`,
          slug: `${unique}-org-a`,
          plan: 'BASIC',
          active: true,
        },
      }),
      prisma.organization.create({
        data: {
          name: `${unique} Org B`,
          slug: `${unique}-org-b`,
          plan: 'BASIC',
          active: true,
        },
      }),
      bcrypt.hash(password, 4),
    ]);
    orgAId = orgA.id;
    orgBId = orgB.id;

    const [single, multi] = await Promise.all([
      prisma.user.create({
        data: {
          email: `${unique}-single@example.com`,
          password: hashed,
          name: 'Single Org User',
          organizationUsers: { create: { organizationId: orgAId } },
        },
      }),
      prisma.user.create({
        data: {
          email: `${unique}-multi@example.com`,
          password: hashed,
          name: 'Multi Org User',
          organizationUsers: {
            create: [
              { organizationId: orgAId, joinedAt: new Date(Date.now() - 60000) },
              { organizationId: orgBId },
            ],
          },
        },
      }),
    ]);
    singleOrgEmail = single.email;
    multiOrgEmail = multi.email;
  }, 60000);

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { in: [singleOrgEmail, multiOrgEmail] } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [orgAId, orgBId] } },
    });
    await prisma.$disconnect();
    await app.close();
  });

  it('login returns accessToken but no refreshToken in the body (cookie set instead)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: singleOrgEmail, password });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeUndefined();
    expect(findCookie(res.headers['set-cookie'], 'refresh_token')).toBeDefined();
  });

  it('refresh returns accessToken but no refreshToken in the body (rotated cookie only)', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: singleOrgEmail, password });
    const refreshCookie = findCookie(
      login.headers['set-cookie'],
      'refresh_token',
    );
    expect(refreshCookie).toBeDefined();

    // SEC-005: refresh is no longer CSRF-exempt; the real frontend sends the
    // double-submit header minted at login alongside the refresh cookie.
    const csrfCookie = findCookie(login.headers['set-cookie'], 'csrf_token');
    expect(csrfCookie).toBeDefined();
    const csrfValue = (csrfCookie as string)
      .split(';')[0]
      .split('=')[1];

    const res = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', `${refreshCookie}; ${csrfCookie}`)
      .set('x-csrf-token', csrfValue)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeUndefined();
    // Rotation re-issues the refresh cookie for the next cycle.
    expect(findCookie(res.headers['set-cookie'], 'refresh_token')).toBeDefined();
  });

  it('select-organization returns accessToken but no refreshToken in the body', async () => {
    const pre = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: multiOrgEmail, password });

    expect(pre.status).toBe(201);
    expect(pre.body.requiresOrganizationSelection).toBe(true);
    expect(pre.body.refreshToken).toBeUndefined();

    const res = await request(app.getHttpServer())
      .post('/api/auth/select-organization')
      .send({
        preAuthToken: pre.body.preAuthToken,
        organizationId: orgBId,
      });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeUndefined();
  });

  it('select-org returns accessToken but no refreshToken in the body', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: multiOrgEmail, password, organizationId: orgAId });

    expect(login.status).toBe(201);
    expect(login.body.accessToken).toBeDefined();

    const res = await request(app.getHttpServer())
      .post('/api/auth/select-org')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ organizationId: orgBId });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeUndefined();
  });
});
