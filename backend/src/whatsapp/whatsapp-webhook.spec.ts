import type { INestApplication } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { createHmac } from 'crypto';
import { CookieCsrfGuard } from '../common/guards/cookie-csrf.guard';
import { PrismaService } from '../prisma/prisma.service';
import {
  WAHA_WEBHOOK_KEY,
  WhatsAppWebhookController,
} from './whatsapp-webhook.controller';
import { WhatsAppEventsService } from './whatsapp-events.service';
import { WhatsAppAdminService } from './whatsapp-admin.service';
import {
  INTELLIGENCE_SESSION,
  WhatsAppConnectionsService,
} from './whatsapp-connections.service';
import { WhatsAppIdentityService } from './whatsapp-identity.service';
import { WhatsAppIngestionService } from './whatsapp-ingestion.service';
import { WHATSAPP_TEXT_SENDER } from './whatsapp-provider';
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

/**
 * The same HTTP boundary with the real event service behind it, so the identity
 * decision is exercised end to end from signed bytes to the gate and the sender.
 * Every collaborator it reaches is still a double: this proves which boundary
 * refuses an unrecognisable sender before anything links, reads or sends.
 */
const connections = { findBySessionName: jest.fn() };
const prisma = { whatsAppProcessedEvent: { create: jest.fn() } };
const ingestion = { ingest: jest.fn() };
const identity = { consume: jest.fn() };
const admin = { authorize: jest.fn(), answer: jest.fn() };
const textSender = { sendText: jest.fn() };

@Module({
  controllers: [WhatsAppWebhookController],
  providers: [
    { provide: WAHA_WEBHOOK_KEY, useValue: MASTER },
    WhatsAppEventsService,
    { provide: PrismaService, useValue: prisma },
    { provide: WhatsAppConnectionsService, useValue: connections },
    { provide: WhatsAppIngestionService, useValue: ingestion },
    { provide: WhatsAppIdentityService, useValue: identity },
    { provide: WhatsAppAdminService, useValue: admin },
    { provide: WHATSAPP_TEXT_SENDER, useValue: textSender },
    { provide: APP_GUARD, useClass: CookieCsrfGuard },
  ],
})
class WiredModule {}

type Wired = (app: INestApplication) => Promise<void>;

async function withWiredApp(run: Wired): Promise<void> {
  const module = await Test.createTestingModule({
    imports: [WiredModule],
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

const intelligenceEnvelope = (from: string, body: string): string =>
  JSON.stringify({
    event: 'message.any',
    session: INTELLIGENCE_SESSION,
    engine: 'WEBJS',
    payload: {
      id: `true_${from}_EVT`,
      from,
      fromMe: false,
      source: 'app',
      body,
      timestamp: 1_700_000_000,
    },
  });

const signedPost = (app: INestApplication, body: string) =>
  post(app)
    .set('X-Webhook-Hmac', sign(body, MASTER, INTELLIGENCE_SESSION))
    .send(body);

describe('WAHA webhook to the central channel identity boundary', () => {
  const administratorPhone = '573001112233';
  // WAHA's privacy identifier. Its digits are opaque and, here, exactly the
  // administrator's verified number: accepting them as a phone would hand the
  // sender her identity over the public webhook.
  const opaqueFrom = `${administratorPhone}@lid`;

  beforeEach(() => {
    jest.clearAllMocks();
    connections.findBySessionName.mockResolvedValue({
      id: 'c2',
      channel: 'INTELLIGENCE',
      organizationId: null,
    });
    prisma.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });
    // No live challenge matches any body, exactly as the real service answers.
    identity.consume.mockResolvedValue(null);
  });

  it.each([
    ['a summary query', 'resumen'],
    ['a PDF command', 'pdf'],
    ['a link code', 'ABCDEFGHJK'],
  ])(
    'refuses %s sent from an opaque LID through the signed webhook',
    async (_label, text) => {
      await withWiredApp(async (app) => {
        const body = intelligenceEnvelope(opaqueFrom, text);
        const response = await signedPost(app, body);

        // The envelope itself is authentic, so the provider gets its 204 and
        // never redelivers; the refusal is inside the boundary, not a rejection
        // of the transport.
        expect(response.status).toBe(204);
        expect(connections.findBySessionName).toHaveBeenCalledWith(
          INTELLIGENCE_SESSION,
        );

        // Nothing linked, nothing read, nothing sent, nothing stored.
        expect(identity.consume).not.toHaveBeenCalled();
        expect(admin.authorize).not.toHaveBeenCalled();
        expect(admin.answer).not.toHaveBeenCalled();
        expect(textSender.sendText).not.toHaveBeenCalled();
        expect(ingestion.ingest).not.toHaveBeenCalled();
        expect(prisma.whatsAppProcessedEvent.create).not.toHaveBeenCalled();
      });
    },
  );

  it('still answers a verified administrator who writes from a real phone', async () => {
    admin.authorize.mockResolvedValue({
      status: 'authorized',
      userId: 'user-1',
      organizationId: 'org-1',
      role: 'ADMIN',
      phone: administratorPhone,
    });
    admin.answer.mockResolvedValue({ status: 'unsupported' });

    await withWiredApp(async (app) => {
      const response = await signedPost(
        app,
        intelligenceEnvelope(`${administratorPhone}@c.us`, 'hola'),
      );

      expect(response.status).toBe(204);
      expect(identity.consume).toHaveBeenCalledWith(administratorPhone, 'hola');
      expect(admin.authorize).toHaveBeenCalledWith(administratorPhone);
      expect(prisma.whatsAppProcessedEvent.create).toHaveBeenCalledTimes(1);
      expect(textSender.sendText).toHaveBeenCalledTimes(1);
      expect(textSender.sendText).toHaveBeenCalledWith(INTELLIGENCE_SESSION, {
        chatId: `${administratorPhone}@c.us`,
        text: 'No entiendo ese comando. Escribe «resumen» para las cifras del día, «atencion» para las conversaciones o «pdf» para el reporte.',
      });
    });
  });
});
