import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app-configuration';
import { AuthService } from './auth.service';
import { CSRF_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from './cookies.helper';
import {
  setupTwoOrgFixture,
  type TwoOrgFixture,
} from '../testing/two-org-fixture';

/**
 * Refresh-token session integrity (issue #48, spec 3.R1 + amendments 1-2).
 *
 * Real-database integration specs against AuthService: the two-org fixture
 * seeds two organizations and a multi-org member M (org A first-joined, org B
 * selected at login). The refresh flow must preserve the selected org
 * (amendment 1 / design D3.1) and keep concurrent tabs alive with a 60s
 * reuse-grace window (amendment 2 / design D3.2).
 */
describe('AuthService.refresh — org preservation (spec 3.R1, amendment 1)', () => {
  let fixture: TwoOrgFixture;
  let prisma: TwoOrgFixture['prisma'];
  let service: AuthService;
  let jwtService: JwtService;
  let orgAId: string;
  let orgBId: string;
  let multiOrgUserId: string;
  let multiOrgEmail: string;

  const password = 'Refresh-Int-Pass-123!';

  beforeAll(async () => {
    fixture = await setupTwoOrgFixture('refresh-int');
    prisma = fixture.prisma;
    orgAId = fixture.orgAId;
    orgBId = fixture.orgBId;

    jwtService = new JwtService({ secret: 'refresh-int-test-secret' });
    service = new AuthService(prisma as never, jwtService);

    const hashed = await bcrypt.hash(password, 4);
    const user = await prisma.user.create({
      data: {
        email: `refresh-int-multi-${Date.now()}@example.com`,
        password: hashed,
        name: 'Multi Org Member',
        tokenVersion: 0,
        organizationUsers: {
          create: [
            { organizationId: orgAId, role: 'MEMBER', joinedAt: new Date(Date.now() - 60000) },
            { organizationId: orgBId, role: 'MEMBER', joinedAt: new Date() },
          ],
        },
      },
    });
    multiOrgUserId = user.id;
    multiOrgEmail = user.email;
  }, 30000);

  afterAll(async () => {
    await fixture.teardown(async () => {
      await prisma.refreshToken.deleteMany({
        where: { userId: multiOrgUserId },
      });
    });
  });

  function decodeOrg(accessToken: string): string | null {
    const payload = jwtService.verify<{ organizationId: string | null }>(
      accessToken,
    );
    return payload.organizationId;
  }

  it('login honors the explicitly selected organization (sanity precondition)', async () => {
    const result = await service.login({
      email: multiOrgEmail,
      password,
      organizationId: orgBId,
    });

    expect(decodeOrg(result.accessToken)).toBe(orgBId);
  });

  it('refresh preserves the selected organization (org B stays org B)', async () => {
    const login = await service.login({
      email: multiOrgEmail,
      password,
      organizationId: orgBId,
    });

    const refreshed = await service.refresh(login.refreshToken);

    expect(decodeOrg(refreshed.accessToken)).toBe(orgBId);
  });

  it('refresh of a legacy null-org row falls back to first-joined membership (migration safety)', async () => {
    const raw = crypto.randomBytes(40).toString('hex');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await prisma.refreshToken.create({
      data: { userId: multiOrgUserId, token: hash, expiresAt },
    });

    const refreshed = await service.refresh(raw);

    expect(decodeOrg(refreshed.accessToken)).toBe(orgAId);
  });
});

describe('AuthService.refresh — 60s concurrent-tab reuse grace (spec 3.R1, amendment 2)', () => {
  let fixture: TwoOrgFixture;
  let prisma: TwoOrgFixture['prisma'];
  let service: AuthService;
  let jwtService: JwtService;
  let orgAId: string;
  let orgBId: string;
  let multiOrgUserId: string;
  let multiOrgEmail: string;

  const password = 'Refresh-Grace-Pass-123!';

  function sha256(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  /** Revokes every active row for the member so each test starts isolated. */
  async function revokeAllActiveRows(): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { userId: multiOrgUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  beforeAll(async () => {
    fixture = await setupTwoOrgFixture('refresh-grace');
    prisma = fixture.prisma;
    orgAId = fixture.orgAId;
    orgBId = fixture.orgBId;

    jwtService = new JwtService({ secret: 'refresh-int-test-secret' });
    service = new AuthService(prisma as never, jwtService);

    const hashed = await bcrypt.hash(password, 4);
    const user = await prisma.user.create({
      data: {
        email: `refresh-grace-multi-${Date.now()}@example.com`,
        password: hashed,
        name: 'Multi Org Tab Sharer',
        tokenVersion: 0,
        organizationUsers: {
          create: [
            { organizationId: orgAId, role: 'MEMBER', joinedAt: new Date(Date.now() - 60000) },
            { organizationId: orgBId, role: 'MEMBER', joinedAt: new Date() },
          ],
        },
      },
    });
    multiOrgUserId = user.id;
    multiOrgEmail = user.email;
  }, 30000);

  afterAll(async () => {
    await fixture.teardown(async () => {
      await prisma.refreshToken.deleteMany({
        where: { userId: multiOrgUserId },
      });
    });
  });

  function decodeOrg(accessToken: string): string | null {
    const payload = jwtService.verify<{ organizationId: string | null }>(
      accessToken,
    );
    return payload.organizationId;
  }

  it('keeps the losing tab alive: a just-revoked token within 60s of a newer active row issues a fresh pair bound to that row org', async () => {
    await revokeAllActiveRows();

    // Both tabs share the session cookie holding this raw refresh token.
    const shared = await service.login({
      email: multiOrgEmail,
      password,
      organizationId: orgBId,
    });

    // Tab A wins the rotation: the shared row is revoked and replaced by a
    // newer active row for the same user (created seconds ago).
    await service.refresh(shared.refreshToken);

    // Tab B presents the same (now revoked) raw token moments later.
    const tabB = await service.refresh(shared.refreshToken);

    expect(decodeOrg(tabB.accessToken)).toBe(orgBId);
  });

  it('rejects with 401 a token revoked by logout even when a newer active row exists (SEC-005: logout beats grace)', async () => {
    await revokeAllActiveRows();

    // Two sessions of the same user: A stays active, B logs out.
    const sessionA = await service.login({
      email: multiOrgEmail,
      password,
      organizationId: orgBId,
    });
    const sessionB = await service.login({
      email: multiOrgEmail,
      password,
      organizationId: orgBId,
    });

    // B logs out with its cookie present: the presented token is revoked by
    // LOGOUT, not by rotation.
    await service.logout(sessionB.refreshToken);

    // A replay of B's token while A's active row is fresh (<60s) must NOT
    // refill: revocation by logout is an explicit session end, so a stolen
    // cookie copy cannot mint a new session after the victim logged out.
    await expect(service.refresh(sessionB.refreshToken)).rejects.toMatchObject(
      { status: 401 },
    );

    // Sanity: A's own token is untouched by B's logout.
    const refreshedA = await service.refresh(sessionA.refreshToken);
    expect(decodeOrg(refreshedA.accessToken)).toBe(orgBId);
  });

  it('rejects a revoked token with 401 when the newest active row is older than the 60s grace window', async () => {
    await revokeAllActiveRows();

    const rawRevoked = crypto.randomBytes(40).toString('hex');
    const rawNewer = crypto.randomBytes(40).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    const sixtyOneSecondsAgo = new Date(Date.now() - 61_000);

    // The replacement row exists and is active, but was created 61s ago —
    // outside the grace window. Presenting the revoked token is a genuine
    // reuse signal and must stay a 401.
    await prisma.refreshToken.create({
      data: {
        userId: multiOrgUserId,
        token: sha256(rawRevoked),
        organizationId: orgBId,
        expiresAt,
        revokedAt: sixtyOneSecondsAgo,
      },
    });
    await prisma.refreshToken.create({
      data: {
        userId: multiOrgUserId,
        token: sha256(rawNewer),
        organizationId: orgBId,
        expiresAt,
        createdAt: sixtyOneSecondsAgo,
      },
    });

    await expect(service.refresh(rawRevoked)).rejects.toThrow(
      'Refresh token revoked',
    );
  });
});

/**
 * Browser restart (bug: csrf_token outlived by refresh_token).
 *
 * A browser restart drops every session cookie (no Max-Age / Expires) and
 * keeps the persistent ones. POST /api/auth/refresh is CSRF-guarded, so the
 * double-submit csrf_token must persist exactly as long as refresh_token or
 * a still-valid 7-day session dies with a 403 on the first page boot. Boots
 * the real AppModule so CookieCsrfGuard runs in front of the handler.
 */
describe('POST /api/auth/refresh after a browser restart (csrf_token lifetime)', () => {
  let app: INestApplication;
  let fixture: TwoOrgFixture;
  let prisma: TwoOrgFixture['prisma'];
  let userId: string;
  let email: string;

  const password = 'Refresh-Restart-Pass-123!';

  interface ParsedCookie {
    name: string;
    value: string;
    persistent: boolean;
  }

  function parseSetCookies(header: unknown): ParsedCookie[] {
    const lines = Array.isArray(header) ? (header as string[]) : [];
    return lines.map((line) => {
      const [pair, ...attributes] = line.split(';').map((p) => p.trim());
      const eq = pair.indexOf('=');
      return {
        name: pair.slice(0, eq),
        value: pair.slice(eq + 1),
        persistent: attributes.some((a) => /^(max-age|expires)=/i.test(a)),
      };
    });
  }

  /** What the browser still holds after a restart: persistent cookies only. */
  function survivingCookies(cookies: ParsedCookie[]): ParsedCookie[] {
    return cookies.filter((c) => c.persistent);
  }

  function cookieHeader(cookies: ParsedCookie[]): string {
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  }

  async function login(): Promise<ParsedCookie[]> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password });
    expect(res.status).toBe(201);
    return parseSetCookies(res.headers['set-cookie']);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();

    fixture = await setupTwoOrgFixture('refresh-restart');
    prisma = fixture.prisma;

    const user = await prisma.user.create({
      data: {
        email: `refresh-restart-${Date.now()}@example.com`,
        password: await bcrypt.hash(password, 4),
        name: 'Browser Restart User',
        tokenVersion: 0,
        organizationUsers: { create: { organizationId: fixture.orgAId } },
      },
    });
    userId = user.id;
    email = user.email;
  }, 60000);

  afterAll(async () => {
    await fixture.teardown(async () => {
      await prisma.refreshToken.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    });
    await app.close();
  });

  it('keeps refresh working: the persisted csrf_token is sent back with the persisted refresh_token -> 201', async () => {
    const surviving = survivingCookies(await login());
    const refresh = surviving.find((c) => c.name === REFRESH_TOKEN_COOKIE);
    const csrf = surviving.find((c) => c.name === CSRF_TOKEN_COOKIE);

    expect(refresh).toBeDefined();
    // Pre-fix csrf_token was session-only and vanished here.
    expect(csrf).toBeDefined();

    const res = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader(surviving))
      .set('x-csrf-token', (csrf as ParsedCookie).value)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toEqual(expect.any(String));
  });

  it('still rejects with 403 a valid refresh cookie sent without the CSRF cookie or header', async () => {
    const refresh = (await login()).find((c) => c.name === REFRESH_TOKEN_COOKIE);
    expect(refresh).toBeDefined();

    const res = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader([refresh as ParsedCookie]))
      .send({});

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain('CSRF token mismatch');
  });

  it('still rejects with 403 a valid refresh cookie plus CSRF cookie but no x-csrf-token header (cookie riding)', async () => {
    // A cross-site request rides every cookie the browser holds but cannot
    // read csrf_token to echo it in the header.
    const cookies = await login();
    expect(cookies.map((c) => c.name)).toEqual(
      expect.arrayContaining([REFRESH_TOKEN_COOKIE, CSRF_TOKEN_COOKIE]),
    );

    const res = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader(cookies))
      .send({});

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain('CSRF token mismatch');
  });
});
