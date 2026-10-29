import { Test } from '@nestjs/testing';
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppSessionService } from './whatsapp-session.service';

@Injectable()
class FakeAuth implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (!req.headers.authorization) throw new UnauthorizedException();
    req.user = {
      role: req.headers['x-test-role'],
      organizationId: req.headers['x-test-org'],
    };
    return true;
  }
}

describe('WhatsApp administrator boundary', () => {
  it('requires authentication, ADMIN role and a trusted organization', async () => {
    const service = {
      connect: jest.fn(),
      status: jest.fn().mockResolvedValue({ status: 'WORKING' }),
      qr: jest.fn().mockResolvedValue({ data: 'qr' }),
    };
    const module = await Test.createTestingModule({
      controllers: [WhatsAppController],
      providers: [{ provide: WhatsAppSessionService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(FakeAuth)
      .compile();
    const app = module.createNestApplication();
    await app.init();
    try {
      expect(
        (await request(app.getHttpServer()).get('/whatsapp/session')).status,
      ).toBe(401);
      expect(
        (
          await request(app.getHttpServer())
            .get('/whatsapp/session')
            .set('Authorization', 'Bearer test')
            .set('x-test-role', 'MEMBER')
            .set('x-test-org', 'org-a')
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app.getHttpServer())
            .get('/whatsapp/session')
            .set('Authorization', 'Bearer test')
            .set('x-test-role', 'ADMIN')
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app.getHttpServer())
            .get('/whatsapp/session')
            .set('Authorization', 'Bearer test')
            .set('x-test-role', 'ADMIN')
            .set('x-test-org', 'org-a')
            .set('x-organization-id', 'org-b')
        ).status,
      ).toBe(200);
      expect(service.status).toHaveBeenCalledWith('org-a');
      expect(service.status).toHaveBeenCalledTimes(1);
      const deniedQr = await request(app.getHttpServer())
        .get('/whatsapp/session/qr')
        .set('Authorization', 'Bearer test')
        .set('x-test-role', 'MEMBER')
        .set('x-test-org', 'org-a');
      expect(deniedQr.status).toBe(403);
      expect(deniedQr.text).not.toContain('qr');
      const qr = await request(app.getHttpServer())
        .get('/whatsapp/session/qr')
        .set('Authorization', 'Bearer test')
        .set('x-test-role', 'ADMIN')
        .set('x-test-org', 'org-b');
      expect(qr.status).toBe(200);
      expect(qr.headers['cache-control']).toBe('private, no-store');
      expect(service.qr).toHaveBeenCalledTimes(1);
      expect(service.qr).toHaveBeenCalledWith('org-b');
    } finally {
      await app.close();
    }
  });
});
