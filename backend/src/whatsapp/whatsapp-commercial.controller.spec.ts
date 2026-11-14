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
import { WAHA_WEBHOOK_KEY } from './whatsapp-webhook.controller';
import { WhatsAppCommercialController } from './whatsapp-commercial.controller';
import {
  commercialSessionName,
  WhatsAppConnectionsService,
} from './whatsapp-connections.service';
import { WHATSAPP_PROVIDER, type WhatsAppProvider } from './whatsapp-provider';
import { WhatsAppSessionService } from './whatsapp-session.service';
import { deriveWebhookKey } from './waha-signature';

const MASTER = 'master-webhook-secret';

/**
 * Stands in for JwtStrategy so the real RolesGuard and OrganizationRequiredGuard
 * still run: the role and the organization are what the token would carry.
 */
@Injectable()
class FakeAuth implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (!req.headers.authorization) throw new UnauthorizedException();
    const role = req.headers['x-test-role'] as string;
    req.user = {
      role,
      organizationId: (req.headers['x-test-org'] as string) || undefined,
      isSuperAdmin: role === 'SUPER_ADMIN',
    };
    return true;
  }
}

function fakeProvider(): WhatsAppProvider {
  return {
    ensureStarted: jest.fn().mockResolvedValue(undefined),
    start: jest.fn(),
    stop: jest.fn().mockResolvedValue(undefined),
    restart: jest.fn().mockResolvedValue(undefined),
    logout: jest.fn(),
    remove: jest.fn(),
    status: jest.fn().mockResolvedValue({ status: 'WORKING' }),
    qr: jest.fn().mockResolvedValue({ data: 'qr-base64' }),
    me: jest.fn().mockResolvedValue({ accountId: '57300@c.us' }),
  };
}

function fakeConnections() {
  return {
    getOrCreateCommercial: jest
      .fn()
      .mockImplementation((organizationId: string) =>
        Promise.resolve({ id: `row-${organizationId}` }),
      ),
    getOrCreateIntelligence: jest.fn(),
    recordStatus: jest.fn().mockResolvedValue({ id: 'row' }),
  };
}

async function build(
  masterKey: string | undefined,
  provider = fakeProvider(),
  connections = fakeConnections(),
): Promise<{
  app: INestApplication;
  provider: WhatsAppProvider;
  connections: ReturnType<typeof fakeConnections>;
}> {
  const module = await Test.createTestingModule({
    controllers: [WhatsAppCommercialController],
    providers: [
      WhatsAppSessionService,
      { provide: WHATSAPP_PROVIDER, useValue: provider },
      { provide: WhatsAppConnectionsService, useValue: connections },
      { provide: WAHA_WEBHOOK_KEY, useValue: masterKey },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useClass(FakeAuth)
    .compile();
  const app = module.createNestApplication();
  await app.init();
  return { app, provider, connections };
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
  { method: 'post' as const, path: '/whatsapp/commercial/session' },
  { method: 'get' as const, path: '/whatsapp/commercial/session' },
  { method: 'get' as const, path: '/whatsapp/commercial/session/qr' },
  { method: 'post' as const, path: '/whatsapp/commercial/session/stop' },
  { method: 'post' as const, path: '/whatsapp/commercial/session/restart' },
];

describe('commercial WhatsApp session boundary', () => {
  it('lets an organization ADMIN drive its own session under its derived name', async () => {
    const { app, provider, connections } = await build(MASTER);
    const server = app.getHttpServer();
    const session = commercialSessionName('org-a');
    try {
      const connected = await request(server)
        .post('/whatsapp/commercial/session')
        .set(auth('ADMIN', 'org-a'));
      expect(connected.status).toBe(200);
      expect(connected.body).toEqual({ status: 'WORKING' });
      expect(provider.ensureStarted).toHaveBeenCalledWith(
        session,
        deriveWebhookKey(MASTER, session),
      );
      expect(connections.getOrCreateCommercial).toHaveBeenCalledWith('org-a');
      expect(connections.recordStatus).toHaveBeenCalledWith(
        'row-org-a',
        'WORKING',
        '57300@c.us',
      );

      const status = await request(server)
        .get('/whatsapp/commercial/session')
        .set(auth('ADMIN', 'org-a'));
      expect(status.status).toBe(200);
      expect(status.body).toEqual({ status: 'WORKING' });
      expect(provider.status).toHaveBeenCalledWith(session);

      const qr = await request(server)
        .get('/whatsapp/commercial/session/qr')
        .set(auth('ADMIN', 'org-a'));
      expect(qr.status).toBe(200);
      expect(qr.body).toEqual({ data: 'qr-base64' });
      expect(provider.qr).toHaveBeenCalledWith(session);

      const stopped = await request(server)
        .post('/whatsapp/commercial/session/stop')
        .set(auth('ADMIN', 'org-a'));
      expect(stopped.status).toBe(204);
      expect(provider.stop).toHaveBeenCalledWith(session);

      const restarted = await request(server)
        .post('/whatsapp/commercial/session/restart')
        .set(auth('ADMIN', 'org-a'));
      expect(restarted.status).toBe(204);
      expect(provider.restart).toHaveBeenCalledWith(session);
    } finally {
      await app.close();
    }
  });

  it('serves the QR with private, no-store caching', async () => {
    const { app } = await build(MASTER);
    try {
      const qr = await request(app.getHttpServer())
        .get('/whatsapp/commercial/session/qr')
        .set(auth('ADMIN', 'org-a'));
      expect(qr.status).toBe(200);
      expect(qr.headers['cache-control']).toBe('private, no-store');
    } finally {
      await app.close();
    }
  });

  it('addresses the token organization even when the request names another one', async () => {
    const { app, provider, connections } = await build(MASTER);
    try {
      const response = await request(app.getHttpServer())
        .get('/whatsapp/commercial/session')
        .set(auth('ADMIN', 'org-a', { 'x-organization-id': 'org-b' }));
      expect(response.status).toBe(200);
      expect(connections.getOrCreateCommercial).toHaveBeenCalledWith('org-a');
      expect(connections.getOrCreateCommercial).not.toHaveBeenCalledWith(
        'org-b',
      );
      expect(provider.status).toHaveBeenCalledWith(
        commercialSessionName('org-a'),
      );
      expect(provider.status).not.toHaveBeenCalledWith(
        commercialSessionName('org-b'),
      );
    } finally {
      await app.close();
    }
  });

  it('admits OWNER because it inherits ADMIN', async () => {
    const { app } = await build(MASTER);
    try {
      const response = await request(app.getHttpServer())
        .get('/whatsapp/commercial/session')
        .set(auth('OWNER', 'org-a'));
      expect(response.status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('rejects MEMBER and CASHIER on every commercial route', async () => {
    const { app, provider, connections } = await build(MASTER);
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
      expect(provider.ensureStarted).not.toHaveBeenCalled();
      expect(provider.qr).not.toHaveBeenCalled();
      expect(provider.stop).not.toHaveBeenCalled();
      expect(provider.restart).not.toHaveBeenCalled();
      expect(provider.status).not.toHaveBeenCalled();
      expect(connections.getOrCreateCommercial).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('requires authentication and an organization scope', async () => {
    const { app } = await build(MASTER);
    const server = app.getHttpServer();
    try {
      expect(
        (await request(server).get('/whatsapp/commercial/session')).status,
      ).toBe(401);
      expect(
        (
          await request(server)
            .get('/whatsapp/commercial/session')
            .set(auth('ADMIN'))
        ).status,
      ).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('fails closed without the master webhook secret', async () => {
    const { app, provider, connections } = await build(undefined);
    const server = app.getHttpServer();
    try {
      for (const route of ROUTES) {
        const response = await request(server)
          [route.method](route.path)
          .set(auth('ADMIN', 'org-a'));
        expect([route.method, route.path, response.status]).toEqual([
          route.method,
          route.path,
          403,
        ]);
      }
      expect(provider.ensureStarted).not.toHaveBeenCalled();
      expect(provider.qr).not.toHaveBeenCalled();
      expect(provider.stop).not.toHaveBeenCalled();
      expect(provider.restart).not.toHaveBeenCalled();
      expect(provider.status).not.toHaveBeenCalled();
      expect(connections.getOrCreateCommercial).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
