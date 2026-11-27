import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessModulesService } from './business-modules.service';
import { BUSINESS_MODULE_CATALOG } from './module-catalog';
import { AdminModuleCatalogController } from './admin-module-catalog.controller';

/**
 * The global module catalog is platform data, so its authorization boundary is
 * checked over HTTP with the real RolesGuard: a SUPER_ADMIN may read it, every
 * organization role is refused and no stored per-organization state is needed.
 */
@Injectable()
class FakeAuth implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (!req.headers.authorization) throw new UnauthorizedException();
    const role = req.headers['x-test-role'] as string;
    req.user = {
      userId: 'user-1',
      email: 'user-1@example.test',
      role,
      organizationId: req.headers['x-test-org'] as string | undefined,
      isSuperAdmin: role === 'SUPER_ADMIN',
      tokenVersion: 0,
    };
    return true;
  }
}

const CATALOG_ROUTE = '/admin/modules';

function storedModuleState() {
  return {
    organization: { findUnique: jest.fn() },
    organizationModule: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
  };
}

async function build(prisma = storedModuleState()): Promise<{
  app: INestApplication;
  prisma: ReturnType<typeof storedModuleState>;
}> {
  const moduleRef = await Test.createTestingModule({
    controllers: [AdminModuleCatalogController],
    providers: [
      BusinessModulesService,
      { provide: PrismaService, useValue: prisma },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useClass(FakeAuth)
    .compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, prisma };
}

const auth = (role: string, extra: Record<string, string> = {}) => ({
  Authorization: 'Bearer test',
  'x-test-role': role,
  ...extra,
});

describe('AdminModuleCatalogController', () => {
  it('returns the real catalog to a superadmin without organization scope', async () => {
    const { app, prisma } = await build();
    try {
      const response = await request(app.getHttpServer())
        .get(CATALOG_ROUTE)
        .set(auth('SUPER_ADMIN'));

      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        {
          id: 'vehicles',
          name: 'Vehículos',
          description: 'Placas, modelos y vehículos asociados a cada cliente.',
        },
      ]);
      expect(response.body).toEqual(
        BUSINESS_MODULE_CATALOG.map(({ id, name, description }) => ({
          id,
          name,
          description,
        })),
      );
      // Catalog definitions are global, so no organization row is consulted
      // and the read never stores per-organization state.
      expect(prisma.organization.findUnique).not.toHaveBeenCalled();
      expect(prisma.organizationModule.findMany).not.toHaveBeenCalled();
      expect(prisma.organizationModule.upsert).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('refuses every organization role on the global catalog', async () => {
    const { app } = await build();
    const server = app.getHttpServer();
    try {
      for (const role of ['ADMIN', 'CASHIER', 'INVENTORY_USER']) {
        const response = await request(server)
          .get(CATALOG_ROUTE)
          .set(auth(role, { 'x-test-org': 'org-a' }));

        expect([role, response.status]).toEqual([role, 403]);
        expect(JSON.stringify(response.body)).not.toContain('Vehículos');
      }
    } finally {
      await app.close();
    }
  });

  it('requires authentication', async () => {
    const { app } = await build();
    try {
      const response = await request(app.getHttpServer()).get(CATALOG_ROUTE);
      expect(response.status).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('offers no mutation of the global catalog', async () => {
    const { app } = await build();
    const server = app.getHttpServer();
    try {
      for (const send of [
        () => request(server).post(CATALOG_ROUTE).set(auth('SUPER_ADMIN')),
        () => request(server).patch(CATALOG_ROUTE).set(auth('SUPER_ADMIN')),
        () => request(server).delete(CATALOG_ROUTE).set(auth('SUPER_ADMIN')),
      ]) {
        expect((await send()).status).toBe(404);
      }
    } finally {
      await app.close();
    }
  });
});
