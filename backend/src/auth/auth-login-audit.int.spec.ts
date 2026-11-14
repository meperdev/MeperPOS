import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app-configuration';
import { waitForAuditRows } from '../testing/wait-for-audit-rows';

/**
 * Login-cycle audit durability (R-LOGIN-1..5, spec audit-event-persistence).
 *
 * Boots the real AppModule with production wiring and drives actual HTTP auth
 * flows, then polls the AuditLog table through a DIRECT Prisma client (the
 * established auth-body-exposure / users int pattern) because the interceptor
 * writes post-response (fire-and-forget tap).
 *
 * Actors created directly via Prisma in beforeAll:
 *   - single-org user (one organizationUser row)      -> R-LOGIN-1
 *   - multi-org user (two organizationUser rows)      -> R-LOGIN-2/3/4
 *   - superadmin (isSuperAdmin: true, NO organizationUser row) -> R-LOGIN-5
 *
 * Expectations:
 *   R-LOGIN-1: single-org login (auto-resolved org) persists LOGIN_SUCCESS.
 *   R-LOGIN-2: multi-org + valid organizationId persists LOGIN_SUCCESS;
 *              membership-rejected 401 writes NO row.
 *   R-LOGIN-3: multi-org without organizationId returns
 *              requiresOrganizationSelection and writes NO row.
 *   R-LOGIN-4: selectOrganization completes login and persists an
 *              AUTH_ORG_SELECTED row for the selected org. RED until the
 *              select-organization route is wired in task 4.1.
 *   R-LOGIN-5: superadmin login (organizationId null) writes NO row
 *              (empty-org FK guard, warn-skip).
 */
describe('Auth login-cycle audit rows (R-LOGIN-1..5)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let orgAId: string;
  let orgBId: string;
  let singleOrgId: string;
  let singleOrgEmail: string;
  let multiOrgId: string;
  let multiOrgEmail: string;
  let superAdminId: string;
  let superAdminEmail: string;

  const password = 'Login-Audit-Pass-123!';
  const unique = `auth-login-audit-${Date.now()}`;

  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * This spec drives a six-login cycle from what would otherwise be one client,
   * and `login` allows 5 attempts per client per minute (common/throttle-limits.ts).
   * Each request therefore presents its own client address, which is also what a
   * real deployment sees: the trusted edge proxy (TRUST_PROXY_HOPS, default 1)
   * appends the actual client IP. Rate limiting itself is covered by
   * common/proxy-trust.int.spec.ts and the multi-instance 429 proof.
   */
  let clientCounter = 0;
  const asDistinctClient = (): Record<string, string> => {
    clientCounter += 1;
    return { 'X-Forwarded-For': `10.0.0.${clientCounter}` };
  };

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

    const [single, multi, superAdmin] = await Promise.all([
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
              {
                organizationId: orgAId,
                joinedAt: new Date(Date.now() - 60000),
              },
              { organizationId: orgBId },
            ],
          },
        },
      }),
      prisma.user.create({
        data: {
          email: `${unique}-super@example.com`,
          password: hashed,
          name: 'Super Admin User',
          isSuperAdmin: true,
        },
      }),
    ]);
    singleOrgId = single.id;
    singleOrgEmail = single.email;
    multiOrgId = multi.id;
    multiOrgEmail = multi.email;
    superAdminId = superAdmin.id;
    superAdminEmail = superAdmin.email;
  }, 60000);

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { organizationId: { in: [orgAId, orgBId] } },
    });
    await prisma.user.deleteMany({
      where: {
        id: { in: [singleOrgId, multiOrgId, superAdminId] },
      },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [orgAId, orgBId] } },
    });
    await prisma.$disconnect();
    await app.close();
  });

  it('R-LOGIN-1: single-org login persists a LOGIN_SUCCESS row with the auto-resolved org', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set(asDistinctClient())
      .send({ email: singleOrgEmail, password });

    expect(res.status).toBe(201);
    expect(res.body.user.organizationId).toBe(orgAId);

    const rows = await waitForAuditRows({
      expectedCount: 1,
      fetchRows: () =>
        prisma.auditLog.findMany({
          where: {
            userId: singleOrgId,
            action: 'LOGIN_SUCCESS',
            organizationId: orgAId,
          },
          orderBy: { createdAt: 'asc' },
        }),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(singleOrgId);
    expect(rows[0].organizationId).toBe(orgAId);
    expect(rows[0].action).toBe('LOGIN_SUCCESS');
    expect(rows[0].resource).toBe('Auth');
  });

  it('R-LOGIN-2: multi-org login with a validated organizationId persists a LOGIN_SUCCESS row', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set(asDistinctClient())
      .send({ email: multiOrgEmail, password, organizationId: orgAId });

    expect(res.status).toBe(201);
    expect(res.body.user.organizationId).toBe(orgAId);

    const rows = await waitForAuditRows({
      expectedCount: 1,
      fetchRows: () =>
        prisma.auditLog.findMany({
          where: {
            userId: multiOrgId,
            action: 'LOGIN_SUCCESS',
            organizationId: orgAId,
          },
          orderBy: { createdAt: 'asc' },
        }),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].organizationId).toBe(orgAId);
    expect(rows[0].action).toBe('LOGIN_SUCCESS');
  });

  it('R-LOGIN-2: multi-org login with a non-member organizationId is rejected with NO audit row', async () => {
    const foreignOrgId = crypto.randomUUID();

    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set(asDistinctClient())
      .send({ email: multiOrgEmail, password, organizationId: foreignOrgId });

    expect(res.status).toBe(401);

    // The login threw, so the interceptor tap never fires; give any (wrong)
    // scheduled write a bounded settle window, then assert absence.
    await sleep(400);
    const rows = await prisma.auditLog.findMany({
      where: {
        userId: multiOrgId,
        action: 'LOGIN_SUCCESS',
        organizationId: foreignOrgId,
      },
    });
    expect(rows).toHaveLength(0);
  });

  it('R-LOGIN-3: multi-org login without organizationId requires selection and writes NO row', async () => {
    const baseline = await prisma.auditLog.count({
      where: { userId: multiOrgId, action: 'LOGIN_SUCCESS' },
    });

    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set(asDistinctClient())
      .send({ email: multiOrgEmail, password });

    expect(res.status).toBe(201);
    expect(res.body.requiresOrganizationSelection).toBe(true);
    expect(res.body.user).toBeUndefined();

    await sleep(400);
    const after = await prisma.auditLog.count({
      where: { userId: multiOrgId, action: 'LOGIN_SUCCESS' },
    });
    expect(after).toBe(baseline);
  });

  it('R-LOGIN-4: selectOrganization completes login and persists an AUTH_ORG_SELECTED row for the selected org', async () => {
    const pre = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set(asDistinctClient())
      .send({ email: multiOrgEmail, password });

    expect(pre.status).toBe(201);
    expect(pre.body.requiresOrganizationSelection).toBe(true);

    const res = await request(app.getHttpServer())
      .post('/api/auth/select-organization')
      .send({ preAuthToken: pre.body.preAuthToken, organizationId: orgBId });

    expect(res.status).toBe(201);
    expect(res.body.user.organizationId).toBe(orgBId);

    const rows = await waitForAuditRows({
      expectedCount: 1,
      fetchRows: () =>
        prisma.auditLog.findMany({
          where: {
            userId: multiOrgId,
            action: 'AUTH_ORG_SELECTED',
            organizationId: orgBId,
          },
          orderBy: { createdAt: 'asc' },
        }),
    });

    // RED until task 4.1 wires @AuditAction('AUTH_ORG_SELECTED') onto the
    // select-organization route.
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(multiOrgId);
    expect(rows[0].organizationId).toBe(orgBId);
    expect(rows[0].action).toBe('AUTH_ORG_SELECTED');
  });

  it('R-LOGIN-5: superadmin login (organizationId null) writes NO audit row', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set(asDistinctClient())
      .send({ email: superAdminEmail, password });

    expect(res.status).toBe(201);
    expect(res.body.user.organizationId).toBeNull();

    // Response actor carries organizationId null -> empty-org FK guard
    // warn-skips; bounded settle window then assert absence.
    await sleep(400);
    const rows = await prisma.auditLog.findMany({
      where: { userId: superAdminId, action: 'LOGIN_SUCCESS' },
    });
    expect(rows).toHaveLength(0);
  });
});
