import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp, configureErrorHandling } from '../app-configuration';

describe('Organization modules (HTTP integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let orgA: string;
  let orgB: string;
  let userId: string;
  let superId: string;
  let customerA: string;
  let customerB: string;
  let adminToken: string;
  let secondToken: string;
  let superToken: string;

  beforeAll(async () => {
    const testModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = testModule.createNestApplication({ logger: false });
    configureApp(app);
    configureErrorHandling(app);
    await app.init();
    prisma = new PrismaClient();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const a = await prisma.organization.create({
      data: { name: 'Modules A', slug: `modules-a-${suffix}` },
    });
    const b = await prisma.organization.create({
      data: { name: 'Modules B', slug: `modules-b-${suffix}` },
    });
    orgA = a.id;
    orgB = b.id;
    const user = await prisma.user.create({
      data: {
        name: 'Admin',
        email: `modules-${suffix}@example.com`,
        password: 'not-a-password',
      },
    });
    const superUser = await prisma.user.create({
      data: {
        name: 'Super',
        email: `modules-super-${suffix}@example.com`,
        password: 'not-a-password',
        isSuperAdmin: true,
      },
    });
    userId = user.id;
    superId = superUser.id;
    await prisma.organizationUser.createMany({
      data: [
        { organizationId: orgA, userId, role: 'ADMIN' },
        { organizationId: orgB, userId, role: 'ADMIN' },
      ],
    });
    const ca = await prisma.customer.create({
      data: {
        organizationId: orgA,
        name: 'A',
        documentType: 'CC',
        documentNumber: `a-${suffix}`,
        placaMoto: 'OLD123',
      },
    });
    const cb = await prisma.customer.create({
      data: {
        organizationId: orgB,
        name: 'B',
        documentType: 'CC',
        documentNumber: `b-${suffix}`,
      },
    });
    customerA = ca.id;
    customerB = cb.id;
    const jwt = app.get(JwtService);
    const sign = (
      id: string,
      email: string,
      organizationId: string | null,
      role: string,
    ) => jwt.sign({ sub: id, email, organizationId, role, tokenVersion: 0 });
    adminToken = sign(userId, user.email, orgA, 'ADMIN');
    secondToken = sign(userId, user.email, orgB, 'ADMIN');
    superToken = sign(superId, superUser.email, null, 'SUPER_ADMIN');
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.organization.deleteMany({
        where: { id: { in: [orgA, orgB].filter(Boolean) } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [userId, superId].filter(Boolean) } },
      });
      await prisma.$disconnect();
    }
    await app?.close();
  });

  it('restricts configuration to SuperAdmin and enforces each organization independently', async () => {
    const auth = (token: string) => `Bearer ${token}`;
    const route = `/api/admin/organizations/${orgA}/modules/vehicles`;
    await request(app.getHttpServer())
      .patch(route)
      .set('Authorization', auth(adminToken))
      .send({ enabled: false })
      .expect(403);
    expect(
      await prisma.organizationModule.findUnique({
        where: {
          organizationId_module: { organizationId: orgA, module: 'vehicles' },
        },
      }),
    ).toBeNull();
    await request(app.getHttpServer())
      .patch(route)
      .set('Authorization', auth(superToken))
      .send({ enabled: false })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/customers/${customerA}/vehicles`)
      .set('Authorization', auth(adminToken))
      .send({ plate: 'AAA123' })
      .expect(403);
    const masked = await request(app.getHttpServer())
      .get(`/api/customers/${customerA}`)
      .set('Authorization', auth(adminToken))
      .expect(200);
    expect(masked.body.placaMoto).toBeNull();
    expect(
      (await prisma.customer.findUniqueOrThrow({ where: { id: customerA } }))
        .placaMoto,
    ).toBe('OLD123');
    await request(app.getHttpServer())
      .post(`/api/customers/${customerB}/vehicles`)
      .set('Authorization', auth(secondToken))
      .send({ plate: 'BBB123', model: 'Model B' })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/customers/${customerA}/vehicles`)
      .set('Authorization', auth(secondToken))
      .expect(404);
    await request(app.getHttpServer())
      .patch(route)
      .set('Authorization', auth(superToken))
      .send({ enabled: true })
      .expect(200);
    const restored = await request(app.getHttpServer())
      .get(`/api/customers/${customerA}`)
      .set('Authorization', auth(adminToken))
      .expect(200);
    expect(restored.body.placaMoto).toBe('OLD123');
  });

  it('lists the module catalog for an organization and for its members', async () => {
    const auth = (token: string) => `Bearer ${token}`;
    await request(app.getHttpServer())
      .get(`/api/admin/organizations/${orgA}/modules`)
      .set('Authorization', auth(adminToken))
      .expect(403);

    const asSuperAdmin = await request(app.getHttpServer())
      .get(`/api/admin/organizations/${orgA}/modules`)
      .set('Authorization', auth(superToken))
      .expect(200);
    expect(asSuperAdmin.body).toHaveLength(1);
    expect(asSuperAdmin.body[0]).toEqual(
      expect.objectContaining({ id: 'vehicles', name: 'Vehículos' }),
    );
    expect(typeof asSuperAdmin.body[0].enabled).toBe('boolean');

    const asMember = await request(app.getHttpServer())
      .get('/api/business-modules')
      .set('Authorization', auth(secondToken))
      .expect(200);
    expect(asMember.body).toHaveLength(1);
    expect(typeof asMember.body[0].enabled).toBe('boolean');

    await request(app.getHttpServer())
      .patch(`/api/admin/organizations/${orgA}/modules/unknown-module`)
      .set('Authorization', auth(superToken))
      .send({ enabled: false })
      .expect(400);
  });
});
