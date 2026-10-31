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
import { WhatsAppDeliveryController } from './whatsapp-delivery.controller';
import { WhatsAppDeliveryService } from './whatsapp-delivery.service';
import { WhatsAppIdentityService } from './whatsapp-identity.service';

const DAY = new Date('2026-02-10T00:00:00.000Z');

/**
 * Stands in for JwtStrategy so the real RolesGuard and OrganizationRequiredGuard
 * still run: the user, the role and the organization are what the token carries,
 * never what the request says.
 */
@Injectable()
class FakeAuth implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (!req.headers.authorization) throw new UnauthorizedException();
    const role = req.headers['x-test-role'] as string;
    req.user = {
      userId: (req.headers['x-test-user'] as string) || 'user-1',
      role,
      organizationId: (req.headers['x-test-org'] as string) || undefined,
      isSuperAdmin: role === 'SUPER_ADMIN',
    };
    return true;
  }
}

function fakePrisma() {
  return {
    whatsAppConnection: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    whatsAppDelivery: { findMany: jest.fn().mockResolvedValue([]) },
    whatsAppIdentity: { findMany: jest.fn().mockResolvedValue([]) },
    organizationUser: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

function fakeIdentities(
  rows: Array<{
    id: string;
    phone: string;
    status: string;
    verifiedAt: Date | null;
    organizationId: string | null;
  }> = [],
) {
  return {
    list: jest.fn().mockResolvedValue(rows),
    issueChallenge: jest.fn(),
    revoke: jest.fn(),
    verify: jest.fn(),
    consume: jest.fn(),
    mayActAdministratively: jest.fn(),
  };
}

function fakeDeliveries() {
  return {
    onDemand: jest.fn().mockResolvedValue({
      status: 'sent',
      providerMessageId: 'provider-message-1',
    }),
    scheduled: jest.fn(),
    findScheduled: jest.fn(),
  };
}

async function build(
  prisma = fakePrisma(),
  identities = fakeIdentities(),
  deliveries = fakeDeliveries(),
): Promise<{
  app: INestApplication;
  prisma: ReturnType<typeof fakePrisma>;
  identities: ReturnType<typeof fakeIdentities>;
  deliveries: ReturnType<typeof fakeDeliveries>;
}> {
  const module = await Test.createTestingModule({
    controllers: [WhatsAppDeliveryController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: WhatsAppIdentityService, useValue: identities },
      { provide: WhatsAppDeliveryService, useValue: deliveries },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useClass(FakeAuth)
    .compile();
  const app = module.createNestApplication();
  await app.init();
  return { app, prisma, identities, deliveries };
}

const auth = (
  role: string,
  organizationId?: string,
  extra: Record<string, string> = {},
) => ({
  Authorization: 'Bearer test',
  'x-test-role': role,
  ...(organizationId ? { 'x-test-org': organizationId } : {}),
  ...extra,
});

const ROUTES = [
  { method: 'get' as const, path: '/whatsapp/deliveries' },
  { method: 'post' as const, path: '/whatsapp/deliveries/report' },
];

const VERIFIED_ADMIN = {
  id: 'identity-1',
  phone: '573001112233',
  status: 'VERIFIED',
  verifiedAt: new Date('2026-01-02T10:00:00.000Z'),
  organizationId: 'org-a',
};

describe('WhatsApp delivery boundary', () => {
  it('lists the calling organization history newest first, bounded to 30 rows', async () => {
    const prisma = fakePrisma();
    prisma.whatsAppConnection.findMany.mockResolvedValue([{ id: 'conn-a' }]);
    prisma.whatsAppDelivery.findMany.mockResolvedValue([
      {
        id: 'delivery-2',
        kind: 'ON_DEMAND',
        reportDate: DAY,
        status: 'SENT',
        failureReason: null,
        sentAt: new Date('2026-02-10T12:00:00.000Z'),
        attempts: 1,
      },
    ]);
    const { app } = await build(prisma);
    try {
      const response = await request(app.getHttpServer())
        .get('/whatsapp/deliveries')
        .set(auth('ADMIN', 'org-a'));

      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        {
          id: 'delivery-2',
          kind: 'ON_DEMAND',
          reportDate: DAY.toISOString(),
          status: 'SENT',
          failureReason: null,
          sentAt: '2026-02-10T12:00:00.000Z',
          attempts: 1,
        },
      ]);
      expect(prisma.whatsAppDelivery.findMany).toHaveBeenCalledWith({
        where: { connectionId: { in: ['conn-a'] } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 30,
        select: {
          id: true,
          kind: true,
          reportDate: true,
          status: true,
          failureReason: true,
          sentAt: true,
          attempts: true,
        },
      });
    } finally {
      await app.close();
    }
  });

  it('scopes the list to the token organization even when the request names another one', async () => {
    const prisma = fakePrisma();
    prisma.whatsAppConnection.findMany.mockResolvedValue([{ id: 'conn-a' }]);
    const { app } = await build(prisma);
    try {
      const response = await request(app.getHttpServer())
        .get('/whatsapp/deliveries')
        .set(auth('ADMIN', 'org-a', { 'x-organization-id': 'org-b' }));

      expect(response.status).toBe(200);
      expect(prisma.whatsAppConnection.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-a' },
        select: { id: true },
      });
      expect(prisma.whatsAppDelivery.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { connectionId: { in: ['conn-a'] } },
        }),
      );
    } finally {
      await app.close();
    }
  });

  it('answers an empty history without querying deliveries at all', async () => {
    const prisma = fakePrisma();
    const { app } = await build(prisma);
    try {
      const response = await request(app.getHttpServer())
        .get('/whatsapp/deliveries')
        .set(auth('ADMIN', 'org-a'));

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
      expect(prisma.whatsAppDelivery.findMany).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('shows central-channel rows only when that channel speaks for this one organization', async () => {
    const shared = fakePrisma();
    shared.whatsAppConnection.findFirst.mockResolvedValue({
      id: 'conn-central',
    });
    shared.whatsAppIdentity.findMany.mockResolvedValue([
      { userId: 'user-a', organizationId: 'org-a' },
      { userId: 'user-b', organizationId: 'org-b' },
    ]);
    shared.organizationUser.findMany.mockResolvedValue([
      { userId: 'user-a', organizationId: 'org-a' },
      { userId: 'user-b', organizationId: 'org-b' },
    ]);
    const sharedApp = await build(shared);
    try {
      const response = await request(sharedApp.app.getHttpServer())
        .get('/whatsapp/deliveries')
        .set(auth('ADMIN', 'org-a'));

      expect(response.status).toBe(200);
      // Two organizations share the central channel: their rows belong to
      // neither tenant, so the list stays empty instead of guessing.
      expect(shared.whatsAppDelivery.findMany).not.toHaveBeenCalled();
    } finally {
      await sharedApp.app.close();
    }

    const sole = fakePrisma();
    sole.whatsAppConnection.findFirst.mockResolvedValue({ id: 'conn-central' });
    sole.whatsAppIdentity.findMany.mockResolvedValue([
      { userId: 'user-a', organizationId: 'org-a' },
    ]);
    sole.organizationUser.findMany.mockResolvedValue([
      { userId: 'user-a', organizationId: 'org-a' },
    ]);
    const soleApp = await build(sole);
    try {
      const response = await request(soleApp.app.getHttpServer())
        .get('/whatsapp/deliveries')
        .set(auth('ADMIN', 'org-a'));

      expect(response.status).toBe(200);
      expect(sole.whatsAppDelivery.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { connectionId: { in: ['conn-central'] } },
        }),
      );
    } finally {
      await soleApp.app.close();
    }
  });

  it('withholds central rows from an organization the channel does not speak for', async () => {
    const prisma = fakePrisma();
    prisma.whatsAppConnection.findFirst.mockResolvedValue({
      id: 'conn-central',
    });
    prisma.whatsAppIdentity.findMany.mockResolvedValue([
      { userId: 'user-b', organizationId: 'org-b' },
    ]);
    prisma.organizationUser.findMany.mockResolvedValue([
      { userId: 'user-b', organizationId: 'org-b' },
    ]);
    const { app } = await build(prisma);
    try {
      const response = await request(app.getHttpServer())
        .get('/whatsapp/deliveries')
        .set(auth('ADMIN', 'org-a'));

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
      expect(prisma.whatsAppDelivery.findMany).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('sends the report to the caller own verified identity and returns the service outcome', async () => {
    const prisma = fakePrisma();
    const identities = fakeIdentities([
      {
        ...VERIFIED_ADMIN,
        id: 'identity-revoked',
        phone: '573009998888',
        status: 'REVOKED',
        verifiedAt: null,
      },
      VERIFIED_ADMIN,
    ]);
    const deliveries = fakeDeliveries();
    const { app } = await build(prisma, identities, deliveries);
    try {
      const response = await request(app.getHttpServer())
        .post('/whatsapp/deliveries/report')
        .set(auth('ADMIN', 'org-a', { 'x-organization-id': 'org-b' }));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'sent',
        providerMessageId: 'provider-message-1',
      });
      expect(identities.list).toHaveBeenCalledWith('user-1', 'org-a');
      expect(deliveries.onDemand).toHaveBeenCalledWith({
        organizationId: 'org-a',
        phone: '573001112233',
      });
    } finally {
      await app.close();
    }
  });

  it('surfaces a failed send with its fixed reason instead of a success', async () => {
    const deliveries = fakeDeliveries();
    deliveries.onDemand.mockResolvedValue({
      status: 'failed',
      reason: 'report_failed',
    });
    const { app } = await build(
      fakePrisma(),
      fakeIdentities([VERIFIED_ADMIN]),
      deliveries,
    );
    try {
      const response = await request(app.getHttpServer())
        .post('/whatsapp/deliveries/report')
        .set(auth('ADMIN', 'org-a'));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'failed',
        reason: 'report_failed',
      });
    } finally {
      await app.close();
    }
  });

  it('answers a caller without a verified identity with a 409, not a 500 or a silent send', async () => {
    const deliveries = fakeDeliveries();
    const { app } = await build(
      fakePrisma(),
      fakeIdentities([
        { ...VERIFIED_ADMIN, status: 'PENDING', verifiedAt: null },
      ]),
      deliveries,
    );
    try {
      const response = await request(app.getHttpServer())
        .post('/whatsapp/deliveries/report')
        .set(auth('ADMIN', 'org-a'));

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        status: 'no_identity',
        reason: 'no_recipient',
      });
      expect(deliveries.onDemand).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('converts the service no-identity outcome into the same 409', async () => {
    const deliveries = fakeDeliveries();
    deliveries.onDemand.mockResolvedValue({ status: 'no_identity' });
    const { app } = await build(
      fakePrisma(),
      fakeIdentities([VERIFIED_ADMIN]),
      deliveries,
    );
    try {
      const response = await request(app.getHttpServer())
        .post('/whatsapp/deliveries/report')
        .set(auth('ADMIN', 'org-a'));

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        status: 'no_identity',
        reason: 'no_recipient',
      });
    } finally {
      await app.close();
    }
  });

  it('admits OWNER because it inherits ADMIN', async () => {
    const { app } = await build(
      fakePrisma(),
      fakeIdentities([VERIFIED_ADMIN]),
      fakeDeliveries(),
    );
    try {
      const response = await request(app.getHttpServer())
        .post('/whatsapp/deliveries/report')
        .set(auth('OWNER', 'org-a'));

      expect(response.status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('rejects MEMBER, CASHIER and INVENTORY_USER on every delivery route', async () => {
    const prisma = fakePrisma();
    const identities = fakeIdentities([VERIFIED_ADMIN]);
    const deliveries = fakeDeliveries();
    const { app } = await build(prisma, identities, deliveries);
    const server = app.getHttpServer();
    try {
      for (const route of ROUTES) {
        for (const role of ['MEMBER', 'CASHIER', 'INVENTORY_USER']) {
          const response = await request(server)
            [route.method](route.path)
            .set(auth(role, 'org-a'));
          expect([route.method, route.path, role, response.status]).toEqual([
            route.method,
            route.path,
            role,
            403,
          ]);
        }
      }
      expect(deliveries.onDemand).not.toHaveBeenCalled();
      expect(identities.list).not.toHaveBeenCalled();
      expect(prisma.whatsAppDelivery.findMany).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejects SUPER_ADMIN without an organization scope', async () => {
    const deliveries = fakeDeliveries();
    const { app } = await build(
      fakePrisma(),
      fakeIdentities([VERIFIED_ADMIN]),
      deliveries,
    );
    try {
      const response = await request(app.getHttpServer())
        .post('/whatsapp/deliveries/report')
        .set(auth('SUPER_ADMIN'));

      expect(response.status).toBe(403);
      expect(deliveries.onDemand).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('requires authentication on both routes', async () => {
    const { app } = await build();
    const server = app.getHttpServer();
    try {
      expect((await request(server).get('/whatsapp/deliveries')).status).toBe(
        401,
      );
      expect(
        (await request(server).post('/whatsapp/deliveries/report')).status,
      ).toBe(401);
    } finally {
      await app.close();
    }
  });
});
