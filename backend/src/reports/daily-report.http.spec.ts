import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { OrgRole, Prisma } from '@prisma/client';
import request from 'supertest';
import { JwtStrategy } from '../auth/jwt.strategy';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminOrganizationInterceptor } from '../common/interceptors/admin-organization.interceptor';
import { PrismaService } from '../prisma/prisma.service';
import { DailyReportController } from './daily-report.controller';
import { DailyReportService } from './daily-report.service';

// Synthetic credentials only. The real Passport strategy and route guards run;
// Prisma is an in-memory boundary so this suite never connects to a database.
const secret = 'daily-report-test-only-secret';
const jwt = new JwtService({ secret });
const token = (sub: string, organizationId: string | null, role = 'ADMIN') =>
  jwt.sign({
    sub,
    email: `${sub}@example.invalid`,
    tokenVersion: 1,
    organizationId,
    role,
  });

describe('daily report HTTP boundary', () => {
  let app: INestApplication;
  const sales = [
    {
      organizationId: 'org-a',
      id: 'a',
      saleNumber: 1,
      total: new Prisma.Decimal('12.00'),
      customer: {
        organizationId: 'org-a',
        name: 'Alice A',
        documentNumber: 'A',
      },
      items: [],
    },
    {
      organizationId: 'org-b',
      id: 'b',
      saleNumber: 2,
      total: new Prisma.Decimal('99.00'),
      customer: {
        organizationId: 'org-b',
        name: 'SECRET B',
        documentNumber: 'B',
      },
      items: [],
    },
  ];
  const tx = {
    sale: {
      findMany: jest.fn(
        ({
          where,
        }: {
          where: { organizationId: string; createdAt: { gte: Date } };
        }) =>
          Promise.resolve(
            sales
              .filter((s) => s.organizationId === where.organizationId)
              .map((s) => ({ ...s, createdAt: where.createdAt.gte })),
          ),
      ),
    },
    expense: { findMany: jest.fn().mockResolvedValue([]) },
    product: { findMany: jest.fn().mockResolvedValue([]) },
    purchaseOrder: { findMany: jest.fn().mockResolvedValue([]) },
    moneyLoan: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const prisma = {
    user: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve({
          id: where.id,
          active: true,
          tokenVersion: 1,
          isSuperAdmin: where.id === 'super',
        }),
      ),
    },
    organizationUser: {
      findFirst: jest.fn(
        ({ where }: { where: { userId: string; organizationId: string } }) =>
          Promise.resolve(
            where.organizationId === 'org-a'
              ? {
                  organizationId: 'org-a',
                  role:
                    where.userId === 'member' ? OrgRole.MEMBER : OrgRole.ADMIN,
                }
              : null,
          ),
      ),
    },
    organization: {
      findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }),
    },
    $transaction: jest.fn((fn: (value: typeof tx) => unknown) => fn(tx)),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [DailyReportController],
      providers: [
        DailyReportService,
        JwtStrategy,
        RolesGuard,
        OrganizationRequiredGuard,
        AdminOrganizationInterceptor,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { getOrThrow: () => secret } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(['/api/reports/daily-report', '/api/reports/daily-report/pdf'])(
    'denies missing authentication, insufficient roles, and mismatched memberships on %s',
    async (url) => {
      await request(app.getHttpServer()).get(url).expect(401);
      await request(app.getHttpServer())
        .get(url)
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
      await request(app.getHttpServer())
        .get(url)
        .set('Authorization', `Bearer ${token('admin', null)}`)
        .expect(401);
      await request(app.getHttpServer())
        .get(url)
        .set('Authorization', `Bearer ${token('member', 'org-a', 'MEMBER')}`)
        .expect(403);
      await request(app.getHttpServer())
        .get(url)
        .set('Authorization', `Bearer ${token('admin', 'org-b')}`)
        .expect(401);
      await request(app.getHttpServer())
        .get(url)
        .set('Authorization', `Bearer ${token('super', null, 'SUPER_ADMIN')}`)
        .expect(403);
      expect(tx.sale.findMany).not.toHaveBeenCalled();
    },
  );

  it('uses membership scope despite spoofed tenant header and query', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/reports/daily-report?organizationId=org-b')
      .set('x-organization-id', 'org-b')
      .set('Authorization', `Bearer ${token('admin', 'org-a')}`)
      .expect(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body.salesTotal).toBe('12.00');
    expect(response.text).toContain('Alice A');
    expect(response.text).not.toContain('SECRET B');
    expect(tx.sale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-a' }),
      }),
    );
    for (const model of [
      tx.expense,
      tx.product,
      tx.purchaseOrder,
      tx.moneyLoan,
    ]) {
      expect(model.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: 'org-a' }),
        }),
      );
    }
  });

  it('scopes a super administrator to an explicitly selected organization', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/reports/daily-report')
      .set('x-organization-id', 'org-b')
      .set('Authorization', `Bearer ${token('super', null, 'SUPER_ADMIN')}`)
      .expect(200);
    expect(response.text).toContain('SECRET B');
    expect(response.text).not.toContain('Alice A');
    expect(tx.sale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-b' }),
      }),
    );
  });

  it('returns an administrator PDF for the authorized tenant only', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/reports/daily-report/pdf')
      .set('x-organization-id', 'org-b')
      .set('Authorization', `Bearer ${token('admin', 'org-a')}`)
      .expect(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['cache-control']).toBe('private, no-store');
    const pdf = (response.body as Buffer).toString('latin1');
    expect(pdf).toContain('Alice A');
    expect(pdf).not.toContain('SECRET B');
  });
});
