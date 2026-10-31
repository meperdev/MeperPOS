import type { INestApplication } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { createHmac } from 'crypto';
import { CookieCsrfGuard } from '../common/guards/cookie-csrf.guard';
import {
  WAHA_WEBHOOK_KEY,
  WhatsAppWebhookController,
} from './whatsapp-webhook.controller';
import { WhatsAppEventsService } from './whatsapp-events.service';
import { deriveWebhookKey } from './waha-signature';

const MASTER = 'master-webhook-key';
const SESSION = 'meper-commercial-abc';
const handle = jest.fn();

@Module({
  controllers: [WhatsAppWebhookController],
  providers: [
    { provide: WAHA_WEBHOOK_KEY, useValue: MASTER },
    { provide: WhatsAppEventsService, useValue: { handle } },
    { provide: APP_GUARD, useClass: CookieCsrfGuard },
  ],
})
class TestModule {}

const envelope = (session = SESSION, id: unknown = 'true_111@c.us_AAAA') =>
  JSON.stringify({
    event: 'message.any',
    session,
    engine: 'WEBJS',
    payload: {
      id,
      from: '111@c.us',
      fromMe: false,
      source: 'app',
      body: 'hola',
      timestamp: 1_700_000_000,
      _data: { notifyName: 'never-forwarded' },
    },
  });

const sign = (body: string, master = MASTER, session = SESSION): string =>
  createHmac('sha512', deriveWebhookKey(master, session) ?? '')
    .update(body)
    .digest('hex');

async function withApp(
  run: (app: INestApplication) => Promise<void>,
): Promise<void> {
  const module = await Test.createTestingModule({
    imports: [TestModule],
  }).compile();
  const app = module.createNestApplication({ rawBody: true });
  app.setGlobalPrefix('api');
  await app.init();
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

const post = (app: INestApplication, path = '/api/whatsapp/webhook') =>
  request(app.getHttpServer())
    .post(path)
    .set('Content-Type', 'application/json')
    .set('X-Webhook-Hmac-Algorithm', 'sha512');

describe('WAHA webhook HTTP boundary', () => {
  beforeEach(() => handle.mockClear());

  it('dispatches one authenticated envelope to the event service', async () => {
    await withApp(async (app) => {
      const body = envelope();
      const response = await post(app)
        .set('X-Webhook-Hmac', sign(body))
        .send(body);
      expect(response.status).toBe(204);
      expect(handle).toHaveBeenCalledWith(
        SESSION,
        'true_111@c.us_AAAA',
        'message.any',
        {
          from: '111@c.us',
          fromMe: false,
          source: 'app',
          body: 'hola',
          timestamp: 1_700_000_000,
        },
      );
    });
  });

  it('forwards only the five message fields, never the provider payload', async () => {
    await withApp(async (app) => {
      const body = envelope();
      await post(app).set('X-Webhook-Hmac', sign(body)).send(body);

      const forwarded = handle.mock.calls[0][3] as Record<string, unknown>;
      expect(Object.keys(forwarded).sort()).toEqual([
        'body',
        'from',
        'fromMe',
        'source',
        'timestamp',
      ]);
      expect(JSON.stringify(forwarded)).not.toContain('never-forwarded');
    });
  });

  it('forwards undefined message fields when the payload carries none', async () => {
    await withApp(async (app) => {
      const body = JSON.stringify({
        event: 'message.any',
        session: SESSION,
        payload: { id: 'true_111@c.us_AAAA' },
      });
      await post(app).set('X-Webhook-Hmac', sign(body)).send(body);

      expect(handle.mock.calls[0][3]).toEqual({
        from: undefined,
        fromMe: undefined,
        source: undefined,
        body: undefined,
        timestamp: undefined,
      });
    });
  });

  it('rejects bytes not signed by this session key', async () => {
    await withApp(async (app) => {
      const body = envelope();
      const send = (payload: string, signature: string) =>
        post(app).set('X-Webhook-Hmac', signature).send(payload);

      expect(
        (await send(body, sign(body, MASTER, 'meper-intelligence'))).status,
      ).toBe(401);
      expect((await send(body + ' ', sign(body))).status).toBe(401);
      expect((await send(body, 'f'.repeat(128))).status).toBe(401);
      expect(handle).not.toHaveBeenCalled();
    });
  });

  it('rejects a body that cannot select a session key', async () => {
    await withApp(async (app) => {
      const send = (payload: string) =>
        post(app).set('X-Webhook-Hmac', 'a'.repeat(128)).send(payload);

      // Malformed JSON is rejected by the body parser before this controller.
      expect((await send('not-json')).status).toBe(400);
      expect((await send('{}')).status).toBe(401);
      expect((await send(envelope('bad/../session'))).status).toBe(401);
      expect(handle).not.toHaveBeenCalled();
    });
  });

  it('drops an authenticated envelope without a message id', async () => {
    await withApp(async (app) => {
      const body = envelope(SESSION, null);
      const response = await post(app)
        .set('X-Webhook-Hmac', sign(body))
        .send(body);
      expect(response.status).toBe(204);
      expect(handle).not.toHaveBeenCalled();
    });
  });

  it('keeps the canonical path hard-coded and CSRF-exempt only there', async () => {
    await withApp(async (app) => {
      const body = envelope();
      expect(
        (
          await post(app, '/api/WhatsApp/webhook')
            .set('X-Webhook-Hmac', sign(body))
            .send(body)
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app.getHttpServer())
            .post('/api/whatsapp/webhook/other')
            .send({})
        ).status,
      ).toBe(404);
    });
  });
});
