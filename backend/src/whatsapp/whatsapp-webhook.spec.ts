import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { createHmac } from 'crypto';
import { CookieCsrfGuard } from '../common/guards/cookie-csrf.guard';
import {
  WhatsAppWebhookController,
  WAHA_WEBHOOK_KEY,
} from './whatsapp-webhook.controller';

@Module({
  controllers: [WhatsAppWebhookController],
  providers: [
    { provide: WAHA_WEBHOOK_KEY, useValue: 'test-key' },
    { provide: APP_GUARD, useClass: CookieCsrfGuard },
  ],
})
class TestModule {}

describe('WAHA webhook HTTP boundary', () => {
  it('verifies exact bytes and safely ignores signed replays', async () => {
    const module = await Test.createTestingModule({
      imports: [TestModule],
    }).compile();
    const app = module.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    try {
      const body = '{"event":"message","session":"untrusted"}';
      const signature = createHmac('sha512', 'test-key')
        .update(body)
        .digest('hex');
      const send = (payload: string, sig: string) =>
        request(app.getHttpServer())
          .post('/api/whatsapp/webhook')
          .set('Content-Type', 'application/json')
          .set('X-Webhook-Hmac', sig)
          .set('X-Webhook-Hmac-Algorithm', 'sha512')
          .send(payload);
      expect((await send(body + ' ', signature)).status).toBe(401);
      expect((await send(body, 'f'.repeat(128))).status).toBe(401);
      expect((await send(body, signature)).status).toBe(204);
      expect((await send(body, signature)).status).toBe(204);
      const alias = () =>
        request(app.getHttpServer())
          .post('/api/WhatsApp/webhook')
          .set('Content-Type', 'application/json')
          .set('X-Webhook-Hmac', signature)
          .set('X-Webhook-Hmac-Algorithm', 'sha512');
      expect((await alias().send(body)).status).toBe(403);
      expect(
        (await alias().set('Authorization', 'Bearer ignored').send(body))
          .status,
      ).toBe(401);
      expect(
        (
          await request(app.getHttpServer())
            .post('/api/whatsapp/webhook/other')
            .send({})
        ).status,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });
});
