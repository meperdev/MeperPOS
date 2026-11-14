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
import { WhatsAppIntelligenceController } from './whatsapp-intelligence.controller';
import {
  INTELLIGENCE_SESSION,
  WhatsAppConnectionsService,
} from './whatsapp-connections.service';
import { WHATSAPP_PROVIDER, type WhatsAppProvider } from './whatsapp-provider';
import { WhatsAppSessionService } from './whatsapp-session.service';
import { deriveWebhookKey } from './waha-signature';

const MASTER = 'master-webhook-secret';

/**
 * Stands in for JwtStrategy. A super-admin carries no organization, which is
 * exactly the caller this controller must serve while OrganizationRequiredGuard
 * stays absent.
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
    logout: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn(),
    status: jest.fn().mockResolvedValue({ status: 'WORKING' }),
    qr: jest.fn().mockResolvedValue({ data: 'qr-base64' }),
    me: jest.fn().mockResolvedValue({ accountId: '57311@c.us' }),
  };
}

function fakeConnections() {
  return {
    getOrCreateCommercial: jest.fn(),
    getOrCreateIntelligence: jest.fn().mockResolvedValue({ id: 'central-row' }),
    recordStatus: jest.fn().mockResolvedValue({ id: 'central-row' }),
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
    controllers: [WhatsAppIntelligenceController],
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
  { method: 'post' as const, path: '/whatsapp/intelligence/session' },
  { method: 'get' as const, path: '/whatsapp/intelligence/session' },
  { method: 'get' as const, path: '/whatsapp/intelligence/session/qr' },
  { method: 'post' as const, path: '/whatsapp/intelligence/session/stop' },
  { method: 'post' as const, path: '/whatsapp/intelligence/session/restart' },
  { method: 'post' as const, path: '/whatsapp/intelligence/session/logout' },
];

describe('intelligence WhatsApp session boundary', () => {
  it('lets a platform SUPER_ADMIN drive the central session without an organization', async () => {
    const { app, provider, connections } = await build(MASTER);
    const server = app.getHttpServer();
    try {
      const connected = await request(server)
        .post('/whatsapp/intelligence/session')
        .set(auth('SUPER_ADMIN'));
      expect(connected.status).toBe(200);
      expect(connected.body).toEqual({ status: 'WORKING' });
      expect(provider.ensureStarted).toHaveBeenCalledWith(
        INTELLIGENCE_SESSION,
        deriveWebhookKey(MASTER, INTELLIGENCE_SESSION),
      );
      expect(connections.getOrCreateIntelligence).toHaveBeenCalledTimes(1);
      expect(connections.getOrCreateCommercial).not.toHaveBeenCalled();
      expect(connections.recordStatus).toHaveBeenCalledWith(
        'central-row',
        'WORKING',
        '57311@c.us',
      );

      const status = await request(server)
        .get('/whatsapp/intelligence/session')
        .set(auth('SUPER_ADMIN'));
      expect(status.status).toBe(200);
      expect(status.body).toEqual({ status: 'WORKING' });
      expect(provider.status).toHaveBeenCalledWith(INTELLIGENCE_SESSION);

      const qr = await request(server)
        .get('/whatsapp/intelligence/session/qr')
        .set(auth('SUPER_ADMIN'));
      expect(qr.status).toBe(200);
      expect(qr.body).toEqual({ data: 'qr-base64' });
      expect(qr.headers['cache-control']).toBe('private, no-store');
      expect(provider.qr).toHaveBeenCalledWith(INTELLIGENCE_SESSION);

      const stopped = await request(server)
        .post('/whatsapp/intelligence/session/stop')
        .set(auth('SUPER_ADMIN'));
      expect(stopped.status).toBe(204);
      expect(provider.stop).toHaveBeenCalledWith(INTELLIGENCE_SESSION);

      const restarted = await request(server)
        .post('/whatsapp/intelligence/session/restart')
        .set(auth('SUPER_ADMIN'));
      expect(restarted.status).toBe(204);
      expect(provider.restart).toHaveBeenCalledWith(INTELLIGENCE_SESSION);

      const loggedOut = await request(server)
        .post('/whatsapp/intelligence/session/logout')
        .set(auth('SUPER_ADMIN'));
      expect(loggedOut.status).toBe(204);
      expect(provider.logout).toHaveBeenCalledWith(INTELLIGENCE_SESSION);
    } finally {
      await app.close();
    }
  });

  it('rejects an organization ADMIN, an org role and an unauthenticated caller', async () => {
    const { app, provider, connections } = await build(MASTER);
    const server = app.getHttpServer();
    try {
      expect(
        (await request(server).get('/whatsapp/intelligence/session')).status,
      ).toBe(401);

      for (const route of ROUTES) {
        for (const role of ['ADMIN', 'OWNER', 'MEMBER', 'CASHIER']) {
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
      expect(provider.logout).not.toHaveBeenCalled();
      expect(provider.status).not.toHaveBeenCalled();
      expect(connections.getOrCreateIntelligence).not.toHaveBeenCalled();
      expect(connections.getOrCreateCommercial).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('keeps the central session unreachable through any organization', async () => {
    const { app, provider } = await build(MASTER);
    try {
      const response = await request(app.getHttpServer())
        .get('/whatsapp/intelligence/session')
        .set(auth('SUPER_ADMIN', undefined, { 'x-organization-id': 'org-a' }));
      expect(response.status).toBe(200);
      expect(provider.status).toHaveBeenCalledWith(INTELLIGENCE_SESSION);
      expect(provider.status).toHaveBeenCalledTimes(1);
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
          .set(auth('SUPER_ADMIN'));
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
      expect(provider.logout).not.toHaveBeenCalled();
      expect(provider.status).not.toHaveBeenCalled();
      expect(connections.getOrCreateIntelligence).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
