import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, createHmac } from 'crypto';
import request from 'supertest';
import { PrismaService } from '../prisma/prisma.service';
import type { DailyReportService } from '../reports/daily-report.service';
import { WahaAdapter } from './waha-adapter';
import { deriveWebhookKey } from './waha-signature';
import { WhatsAppAdminService } from './whatsapp-admin.service';
import {
  INTELLIGENCE_SESSION,
  WhatsAppConnectionsService,
} from './whatsapp-connections.service';
import type { WhatsAppDeliveryService } from './whatsapp-delivery.service';
import { WhatsAppEventsService } from './whatsapp-events.service';
import { WhatsAppIdentityService } from './whatsapp-identity.service';
import { WhatsAppIngestionService } from './whatsapp-ingestion.service';
import { UnconfiguredWhatsAppModelProvider } from './whatsapp-intelligence-model';
import {
  WHATSAPP_LID_RESOLVER,
  WHATSAPP_TEXT_SENDER,
} from './whatsapp-provider';
import type { WhatsAppSupervisionService } from './whatsapp-supervision.service';
import {
  WAHA_WEBHOOK_KEY,
  WhatsAppWebhookController,
} from './whatsapp-webhook.controller';

const MASTER = 'test-master';
const PHONE = '12025550123'; // Reserved fictional number, not a real contact.
const LID = '987654321012345@lid';
const report = {
  date: '2026-01-01',
  cutoff: new Date('2026-01-02T00:00:00Z'),
  salesTotal: '1.00',
  expenseTotal: '0.00',
  sales: [],
  lowStock: [],
  purchaseOrders: [],
  loans: [],
};

function body(id: string, text = 'resumen') {
  return JSON.stringify({
    session: INTELLIGENCE_SESSION,
    event: 'message.any',
    payload: { id, from: LID, fromMe: false, body: text },
  });
}
function signature(data: string) {
  return createHmac('sha512', deriveWebhookKey(MASTER, INTELLIGENCE_SESSION)!)
    .update(data)
    .digest('hex');
}

async function fixture(
  run: (f: {
    app: INestApplication;
    prisma: ReturnType<typeof makePrisma>;
    reports: { generate: jest.Mock };
    sender: { sendText: jest.Mock };
    fetchMock: jest.Mock;
  }) => Promise<void>,
) {
  const prisma = makePrisma();
  const reports = { generate: jest.fn().mockResolvedValue(report) };
  const sender = {
    sendText: jest.fn().mockResolvedValue({ providerMessageId: null }),
  };
  const identity = new WhatsAppIdentityService(
    prisma as unknown as PrismaService,
  );
  const admin = new WhatsAppAdminService(
    prisma as unknown as PrismaService,
    identity,
    reports as unknown as DailyReportService,
    { onDemand: jest.fn() } as unknown as WhatsAppDeliveryService,
    { summary: jest.fn() } as unknown as WhatsAppSupervisionService,
    new UnconfiguredWhatsAppModelProvider(),
  );
  const adapter = new WahaAdapter({
    baseUrl: 'http://waha.test',
    apiKey: 'test-key',
    webhookUrl: 'http://backend.test/webhook',
  });
  const fetchMock = jest
    .fn()
    .mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ lid: LID, pn: `${PHONE}@c.us` })),
      ),
    );
  const originalFetch = global.fetch;
  global.fetch = fetchMock;
  const module = await Test.createTestingModule({
    controllers: [WhatsAppWebhookController],
    providers: [
      WhatsAppEventsService,
      { provide: WAHA_WEBHOOK_KEY, useValue: MASTER },
      { provide: PrismaService, useValue: prisma },
      {
        provide: WhatsAppConnectionsService,
        useValue: {
          findBySessionName: jest.fn().mockResolvedValue({
            id: 'central',
            channel: 'INTELLIGENCE',
            organizationId: null,
          }),
        },
      },
      { provide: WhatsAppIngestionService, useValue: { ingest: jest.fn() } },
      { provide: WhatsAppIdentityService, useValue: identity },
      { provide: WhatsAppAdminService, useValue: admin },
      { provide: WHATSAPP_TEXT_SENDER, useValue: sender },
      { provide: WHATSAPP_LID_RESOLVER, useValue: adapter },
    ],
  }).compile();
  const app = module.createNestApplication({ rawBody: true });
  app.setGlobalPrefix('api');
  await app.init();
  try {
    await run({ app, prisma, reports, sender, fetchMock });
  } finally {
    global.fetch = originalFetch;
    await app.close();
  }
}

function makePrisma() {
  const seen = new Set<string>();
  const tx = {
    whatsAppLinkChallenge: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn(),
    },
    whatsAppIdentity: { upsert: jest.fn() },
  };
  return {
    tx,
    whatsAppProcessedEvent: {
      create: jest.fn(({ data }: { data: { providerEventId: string } }) => {
        if (seen.has(data.providerEventId))
          return Promise.reject(
            Object.assign(new Error('duplicate'), { code: 'P2002' }),
          );
        seen.add(data.providerEventId);
        return Promise.resolve({ id: 'receipt' });
      }),
    },
    whatsAppIdentity: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'identity',
        phone: PHONE,
        userId: 'user',
        organizationId: 'tenant-a',
        status: 'VERIFIED',
      }),
    },
    organizationUser: {
      findFirst: jest.fn().mockResolvedValue({ role: 'ADMIN' }),
    },
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'user' }) },
    organization: {
      findFirst: jest.fn().mockResolvedValue({ status: 'ACTIVE' }),
    },
    $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
}

function send(app: INestApplication, data: string, hmac = signature(data)) {
  return request(app.getHttpServer())
    .post('/api/whatsapp/webhook')
    .set('Content-Type', 'application/json')
    .set('X-Webhook-Hmac-Algorithm', 'sha512')
    .set('X-Webhook-Hmac', hmac)
    .send(data);
}

describe('signed mapped LID integration', () => {
  it('redeems a valid challenge once for the mapped phone and challenge owner', async () => {
    await fixture(async ({ app, prisma, fetchMock, reports, sender }) => {
      const code = 'ABCDEFGHJK';
      const codeHash = createHash('sha256').update(code).digest('hex');
      let consumed = false;
      prisma.tx.whatsAppLinkChallenge.updateMany.mockImplementation(
        ({
          where,
        }: {
          where: {
            codeHash: string;
            consumedAt: null;
            expiresAt: { gt: Date };
          };
        }) => {
          const valid =
            where.codeHash === codeHash &&
            where.consumedAt === null &&
            where.expiresAt.gt instanceof Date &&
            !consumed;
          if (valid) consumed = true;
          return Promise.resolve({ count: valid ? 1 : 0 });
        },
      );
      prisma.tx.whatsAppLinkChallenge.findUnique.mockResolvedValue({
        userId: 'challenge-user',
        organizationId: 'challenge-tenant',
      });
      prisma.tx.whatsAppIdentity.upsert.mockResolvedValue({ id: 'linked' });
      const data = body('event-link', `  ${code.toLowerCase()}  `);
      expect((await send(app, data)).status).toBe(204);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(prisma.tx.whatsAppLinkChallenge.updateMany).toHaveBeenCalledWith({
        where: {
          codeHash,
          consumedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        data: { consumedAt: expect.any(Date) },
      });
      expect(prisma.tx.whatsAppLinkChallenge.findUnique).toHaveBeenCalledWith({
        where: { codeHash },
        select: { userId: true, organizationId: true },
      });
      expect(prisma.tx.whatsAppIdentity.upsert).toHaveBeenCalledWith({
        where: { phone: PHONE },
        create: {
          phone: PHONE,
          userId: 'challenge-user',
          organizationId: 'challenge-tenant',
          status: 'VERIFIED',
          verifiedAt: expect.any(Date),
        },
        update: {
          userId: 'challenge-user',
          organizationId: 'challenge-tenant',
          status: 'VERIFIED',
          verifiedAt: expect.any(Date),
          revokedAt: null,
        },
      });
      expect(prisma.whatsAppIdentity.findFirst).not.toHaveBeenCalled();
      expect(prisma.organizationUser.findFirst).not.toHaveBeenCalled();
      expect(reports.generate).not.toHaveBeenCalled();
      expect(sender.sendText).not.toHaveBeenCalled();
      expect((await send(app, data)).status).toBe(204);
      expect(prisma.tx.whatsAppLinkChallenge.updateMany).toHaveBeenCalledTimes(
        1,
      );
      prisma.whatsAppIdentity.findFirst.mockResolvedValue(null);
      expect((await send(app, body('event-link-replay', code))).status).toBe(
        204,
      );
      expect(prisma.tx.whatsAppLinkChallenge.updateMany).toHaveBeenCalledTimes(
        2,
      );
      expect(prisma.tx.whatsAppIdentity.upsert).toHaveBeenCalledTimes(1);
    });
  });

  it('does not create or change an identity for an invalid challenge', async () => {
    await fixture(async ({ app, prisma, sender, reports }) => {
      prisma.whatsAppIdentity.findFirst.mockResolvedValue(null);
      const invalid = 'INVALID234';
      expect((await send(app, body('event-invalid', invalid))).status).toBe(
        204,
      );
      expect(prisma.tx.whatsAppLinkChallenge.updateMany).toHaveBeenCalledWith({
        where: {
          codeHash: createHash('sha256').update(invalid).digest('hex'),
          consumedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        data: { consumedAt: expect.any(Date) },
      });
      expect(prisma.tx.whatsAppLinkChallenge.findUnique).not.toHaveBeenCalled();
      expect(prisma.tx.whatsAppIdentity.upsert).not.toHaveBeenCalled();
      expect(prisma.organizationUser.findFirst).not.toHaveBeenCalled();
      expect(reports.generate).not.toHaveBeenCalled();
      expect(sender.sendText).not.toHaveBeenCalled();
    });
  });
  it('authenticates before lookup, scopes query and reply, and deduplicates', async () => {
    await fixture(async ({ app, prisma, reports, sender, fetchMock }) => {
      const data = body('event-one');
      expect((await send(app, data, 'a'.repeat(128))).status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
      expect((await send(app, data)).status).toBe(204);
      expect(prisma.whatsAppIdentity.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ phone: PHONE }),
        }),
      );
      expect(prisma.organizationUser.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user', organizationId: 'tenant-a' },
        }),
      );
      expect(reports.generate).toHaveBeenCalledWith('tenant-a');
      expect(sender.sendText).toHaveBeenCalledWith(
        INTELLIGENCE_SESSION,
        expect.objectContaining({ chatId: `${PHONE}@c.us` }),
      );
      expect((await send(app, data)).status).toBe(204);
      expect(reports.generate).toHaveBeenCalledTimes(1);
      expect(sender.sendText).toHaveBeenCalledTimes(1);
    });
  });

  it.each(['member', 'other-tenant'])(
    'refuses %s without a query or reply',
    async (scenario) => {
      await fixture(async ({ app, prisma, reports, sender }) => {
        prisma.organizationUser.findFirst.mockImplementation(
          ({ where }: { where: { organizationId: string } }) =>
            Promise.resolve(
              scenario === 'member'
                ? { role: 'MEMBER' }
                : where.organizationId === 'tenant-b'
                  ? { role: 'ADMIN' }
                  : null,
            ),
        );
        expect((await send(app, body('event-refused'))).status).toBe(204);
        expect(prisma.organizationUser.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { userId: 'user', organizationId: 'tenant-a' },
          }),
        );
        expect(reports.generate).not.toHaveBeenCalled();
        expect(sender.sendText).not.toHaveBeenCalled();
      });
    },
  );

  it.each([undefined, null, 'false', true])(
    'refuses signed LID with non-inbound direction %s before lookup',
    async (fromMe) => {
      await fixture(async ({ app, prisma, fetchMock, sender }) => {
        const data = JSON.stringify({
          session: INTELLIGENCE_SESSION,
          event: 'message.any',
          payload: { id: 'direction', from: LID, fromMe, body: 'resumen' },
        });
        expect((await send(app, data)).status).toBe(204);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(prisma.whatsAppIdentity.findFirst).not.toHaveBeenCalled();
        expect(sender.sendText).not.toHaveBeenCalled();
      });
    },
  );

  it('drops lookup failures without a receipt and can process a later delivery after recovery', async () => {
    await fixture(async ({ app, prisma, reports, sender, fetchMock }) => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const error = new Error('private-transport-error');
      error.name = 'private-transport-error';
      fetchMock.mockRejectedValueOnce(error);
      const data = body('event-recovery');
      expect((await send(app, data)).status).toBe(204);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(
        'private-transport-error',
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain(PHONE);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(LID);
      warn.mockRestore();
      expect(prisma.whatsAppProcessedEvent.create).not.toHaveBeenCalled();
      expect(reports.generate).not.toHaveBeenCalled();
      expect(sender.sendText).not.toHaveBeenCalled();
      expect((await send(app, data)).status).toBe(204);
      expect(reports.generate).toHaveBeenCalledTimes(1);
      expect(sender.sendText).toHaveBeenCalledTimes(1);
    });
  });
});
