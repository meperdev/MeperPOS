import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp, configureErrorHandling } from '../app-configuration';

describe('Initial location provisioning (HTTP integration)', () => {
  const prefix = `location-${randomUUID()}`;
  const slugs = [`${prefix}-a`, `${prefix}-b`];
  let app: INestApplication;
  let prisma: PrismaClient;
  let superId: string;
  let authorization: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    configureErrorHandling(app);
    await app.init();

    prisma = new PrismaClient();
    const user = await prisma.user.create({
      data: {
        name: 'Provisioning test administrator',
        email: `${prefix}@example.test`,
        password: 'not-a-login-credential',
        isSuperAdmin: true,
      },
    });
    superId = user.id;
    const jwt = app.get(JwtService);
    authorization = `Bearer ${jwt.sign({
      sub: user.id,
      email: user.email,
      organizationId: null,
      role: 'SUPER_ADMIN',
      tokenVersion: user.tokenVersion,
    })}`;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.organization.deleteMany({ where: { slug: { in: slugs } } });
      if (superId) {
        await prisma.user.delete({ where: { id: superId } });
      }
      await prisma.$disconnect();
    }
    await app?.close();
  });

  const locationsFor = (organizationId: string) =>
    prisma.$queryRaw<{ name: string; isDefault: boolean }[]>`
      SELECT "name", "isDefault" FROM "Location" WHERE "organizationId" = ${organizationId}
    `;

  it('creates one owned initial site for each new organization and preserves create/delete contracts', async () => {
    const expected = [{ name: 'Sede principal', isDefault: true }];
    const create = (slug: string, name: string) =>
      request(app.getHttpServer())
        .post('/api/admin/organizations')
        .set('Authorization', authorization)
        .send({ slug, name });

    const first = await create(slugs[0], 'Location A').expect(201);
    const firstId = first.body.organization.id as string;
    expect(first.body).toMatchObject({
      organization: { slug: slugs[0], name: 'Location A' },
      message: 'Organization created successfully. No admin assigned.',
    });
    expect(first.body.organization).not.toHaveProperty('locations');
    expect(await locationsFor(firstId)).toEqual(expected);

    const second = await create(slugs[1], 'Location B').expect(201);
    const secondId = second.body.organization.id as string;
    expect(await locationsFor(secondId)).toEqual(expected);

    const duplicate = await create(slugs[0], 'Duplicate').expect(409);
    expect(duplicate.body.message).toBe('Organization slug already exists');
    expect(await locationsFor(firstId)).toEqual(expected);
    expect(await locationsFor(secondId)).toEqual(expected);

    const deleted = await request(app.getHttpServer())
      .delete(`/api/admin/organizations/${firstId}`)
      .set('Authorization', authorization)
      .send({ confirmOrganizationName: 'Location A' })
      .expect(200);
    expect(deleted.body).toEqual({ success: true });
    expect(await locationsFor(firstId)).toEqual([]);
    expect(await locationsFor(secondId)).toEqual(expected);
  });
});
