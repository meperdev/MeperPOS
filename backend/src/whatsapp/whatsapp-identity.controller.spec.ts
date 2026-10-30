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
import { WhatsAppIdentityController } from './whatsapp-identity.controller';
import type { WhatsAppIdentityView } from './whatsapp-identity.service';
import { WhatsAppIdentityService } from './whatsapp-identity.service';

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

function fakeIdentities() {
  return {
    issueChallenge: jest.fn().mockResolvedValue({
      code: 'ABCDEFGHJK',
      expiresAt: new Date('2026-01-01T00:10:00.000Z'),
    }),
    list: jest.fn().mockResolvedValue([]),
    revoke: jest.fn().mockResolvedValue(undefined),
    verify: jest.fn(),
    consume: jest.fn(),
    mayActAdministratively: jest.fn(),
  };
}

async function build(identities = fakeIdentities()): Promise<{
  app: INestApplication;
  identities: ReturnType<typeof fakeIdentities>;
}> {
  const module = await Test.createTestingModule({
    controllers: [WhatsAppIdentityController],
    providers: [{ provide: WhatsAppIdentityService, useValue: identities }],
  })
    .overrideGuard(JwtAuthGuard)
    .useClass(FakeAuth)
    .compile();
  const app = module.createNestApplication();
  await app.init();
  return { app, identities };
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

const CHALLENGE = '/whatsapp/identity/challenge';
const IDENTITIES = '/whatsapp/identity';

describe('administrative WhatsApp identity boundary', () => {
  it('lets an organization ADMIN issue a single-use code that is never cached', async () => {
    const { app, identities } = await build();
    try {
      const response = await request(app.getHttpServer())
        .post(CHALLENGE)
        .set(auth('ADMIN', 'org-a'));

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        code: 'ABCDEFGHJK',
        expiresAt: '2026-01-01T00:10:00.000Z',
      });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(identities.issueChallenge).toHaveBeenCalledWith('user-1', 'org-a');
    } finally {
      await app.close();
    }
  });

  it('rejects MEMBER and CASHIER on every identity route', async () => {
    const { app, identities } = await build();
    const server = app.getHttpServer();
    try {
      for (const role of ['MEMBER', 'CASHIER', 'INVENTORY_USER']) {
        const challenge = await request(server)
          .post(CHALLENGE)
          .set(auth(role, 'org-a'));
        expect([role, challenge.status]).toEqual([role, 403]);

        const list = await request(server)
          .get(IDENTITIES)
          .set(auth(role, 'org-a'));
        expect([role, list.status]).toEqual([role, 403]);

        const revoke = await request(server)
          .delete(`${IDENTITIES}/identity-1`)
          .set(auth(role, 'org-a'));
        expect([role, revoke.status]).toEqual([role, 403]);
      }
      expect(identities.issueChallenge).not.toHaveBeenCalled();
      expect(identities.list).not.toHaveBeenCalled();
      expect(identities.revoke).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('admits OWNER because it inherits ADMIN', async () => {
    const { app } = await build();
    try {
      const response = await request(app.getHttpServer())
        .post(CHALLENGE)
        .set(auth('OWNER', 'org-a'));
      expect(response.status).toBe(201);
    } finally {
      await app.close();
    }
  });

  it('addresses the token organization even when the request names another one', async () => {
    const { app, identities } = await build();
    const server = app.getHttpServer();
    try {
      await request(server)
        .post(CHALLENGE)
        .set(auth('ADMIN', 'org-a', { 'x-organization-id': 'org-b' }));
      await request(server)
        .get(IDENTITIES)
        .set(auth('ADMIN', 'org-a', { 'x-organization-id': 'org-b' }));
      await request(server)
        .delete(`${IDENTITIES}/identity-1`)
        .set(auth('ADMIN', 'org-a', { 'x-organization-id': 'org-b' }));

      expect(identities.issueChallenge).toHaveBeenCalledWith('user-1', 'org-a');
      expect(identities.issueChallenge).not.toHaveBeenCalledWith(
        'user-1',
        'org-b',
      );
      expect(identities.list).toHaveBeenCalledWith('user-1', 'org-a');
      expect(identities.revoke).toHaveBeenCalledWith(
        'user-1',
        'org-a',
        'identity-1',
      );
    } finally {
      await app.close();
    }
  });

  it('requires authentication and an organization scope', async () => {
    const { app, identities } = await build();
    const server = app.getHttpServer();
    try {
      expect((await request(server).post(CHALLENGE)).status).toBe(401);
      expect((await request(server).get(IDENTITIES)).status).toBe(401);
      expect((await request(server).delete(`${IDENTITIES}/x`)).status).toBe(
        401,
      );

      // An ADMIN without an organization has no tenant to link a number into.
      for (const send of [
        () => request(server).post(CHALLENGE).set(auth('ADMIN')),
        () => request(server).get(IDENTITIES).set(auth('ADMIN')),
        () => request(server).delete(`${IDENTITIES}/x`).set(auth('ADMIN')),
      ]) {
        expect((await send()).status).toBe(403);
      }
      expect(identities.issueChallenge).not.toHaveBeenCalled();
      expect(identities.list).not.toHaveBeenCalled();
      expect(identities.revoke).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('lists only the caller own identities', async () => {
    const views: WhatsAppIdentityView[] = [
      {
        id: 'identity-1',
        phone: '573001112233',
        status: 'VERIFIED',
        verifiedAt: new Date('2026-01-01T00:00:00.000Z'),
        organizationId: 'org-a',
      },
    ];
    const identities = fakeIdentities();
    identities.list.mockResolvedValue(views);
    const { app } = await build(identities);
    try {
      const response = await request(app.getHttpServer())
        .get(IDENTITIES)
        .set(auth('ADMIN', 'org-a', { 'x-test-user': 'user-1' }));

      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        {
          id: 'identity-1',
          phone: '573001112233',
          status: 'VERIFIED',
          verifiedAt: '2026-01-01T00:00:00.000Z',
          organizationId: 'org-a',
        },
      ]);
      // Scoped by the token user and organization, so another caller's rows
      // cannot be listed by asking for them.
      expect(identities.list).toHaveBeenCalledWith('user-1', 'org-a');
    } finally {
      await app.close();
    }
  });

  it('revokes with the caller scope and answers 204', async () => {
    const { app, identities } = await build();
    try {
      const response = await request(app.getHttpServer())
        .delete(`${IDENTITIES}/identity-1`)
        .set(auth('ADMIN', 'org-a'));

      expect(response.status).toBe(204);
      expect(response.text).toBe('');
      expect(identities.revoke).toHaveBeenCalledWith(
        'user-1',
        'org-a',
        'identity-1',
      );
    } finally {
      await app.close();
    }
  });

  it('reports a scoped revoke that matched nothing as not found', async () => {
    const identities = fakeIdentities();
    identities.revoke.mockRejectedValue(
      new (jest.requireActual('@nestjs/common').NotFoundException)(),
    );
    const { app } = await build(identities);
    try {
      const response = await request(app.getHttpServer())
        .delete(`${IDENTITIES}/identity-of-someone-else`)
        .set(auth('ADMIN', 'org-a'));

      expect(response.status).toBe(404);
      expect(identities.revoke).toHaveBeenCalledWith(
        'user-1',
        'org-a',
        'identity-of-someone-else',
      );
    } finally {
      await app.close();
    }
  });
});
