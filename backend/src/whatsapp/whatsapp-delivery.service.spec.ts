import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { DailyReportService } from '../reports/daily-report.service';
import {
  INTELLIGENCE_SESSION,
  type WhatsAppConnectionsService,
} from './whatsapp-connections.service';
import {
  bogotaReportDay,
  chatIdFor,
  reportDayOf,
  WhatsAppDeliveryService,
} from './whatsapp-delivery.service';
import type { WhatsAppIdentityService } from './whatsapp-identity.service';
import type { WhatsAppFileSender } from './whatsapp-provider';

const ORGANIZATION_ID = 'org-1';
const OTHER_ORGANIZATION_ID = 'org-2';
const USER_ID = 'user-1';
const OTHER_USER_ID = 'user-2';
const PHONE = '573001112233';
const OTHER_PHONE = '573009998877';
const CENTRAL_CONNECTION_ID = 'central-connection';
const COMMERCIAL_CONNECTION_ID = 'commercial-connection';
const REPORT_DAY = new Date('2026-03-03T00:00:00.000Z');

/** A report fixture the real PDF renderer accepts, personal data included. */
const report = {
  cutoff: new Date('2026-03-04T01:00:00.000Z'),
  date: '2026-03-03',
  timezone: 'America/Bogota' as const,
  salesTotal: '1234.56',
  expenseTotal: '200.00',
  sales: [
    {
      id: 'sale-1',
      saleNumber: 'V-0001',
      createdAt: new Date('2026-03-03T15:00:00.000Z'),
      total: '1234.56',
      customer: { name: 'Ana Cliente', documentNumber: '1020304050' },
      items: [
        {
          quantity: 2,
          unitPrice: '617.28',
          total: '1234.56',
          product: { name: 'Labial rojo', sku: 'LAB-1' },
        },
      ],
    },
  ],
  expenses: [
    {
      id: 'expense-1',
      date: new Date('2026-03-03T00:00:00.000Z'),
      description: 'Arriendo local',
      total: '200.00',
      status: 'PAID',
      label: { name: 'Arriendo' },
    },
  ],
  lowStock: [
    {
      id: 'product-1',
      name: 'Labial rojo',
      sku: 'LAB-1',
      stock: 1,
      minStock: 5,
    },
  ],
  purchaseOrders: [
    {
      id: 'order-1',
      orderNumber: 'OC-0001',
      status: 'PENDING',
      total: '900.00',
      supplier: { name: 'Proveedor Central' },
    },
  ],
  loans: [
    {
      id: 'loan-1',
      type: 'RECEIVABLE',
      amount: '500.00',
      balance: '500.00',
      dueAt: new Date('2026-03-05T00:00:00.000Z'),
      reason: 'Fiado de Ana',
      customer: 'Ana Cliente',
      supplier: null,
    },
  ],
};

type IdentityStatus = 'PENDING' | 'VERIFIED' | 'REVOKED';

interface IdentityRow {
  id: string;
  phone: string;
  userId: string;
  organizationId: string | null;
  status: IdentityStatus;
  verifiedAt: Date | null;
}

interface MembershipRow {
  userId: string;
  organizationId: string;
  role: string;
}

interface DeliveryRow {
  id: string;
  connectionId: string;
  kind: 'SCHEDULED' | 'ON_DEMAND';
  reportDate: Date;
  status: 'PENDING' | 'SENT' | 'FAILED';
  failureReason: string | null;
  providerMessageId: string | null;
  attempts: number;
  sentAt: Date | null;
}

const identity = (
  overrides: Partial<IdentityRow> & { phone: string },
): IdentityRow => ({
  id: `identity-${overrides.phone}`,
  userId: USER_ID,
  organizationId: ORGANIZATION_ID,
  status: 'VERIFIED',
  verifiedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const membership = (overrides: Partial<MembershipRow> = {}): MembershipRow => ({
  userId: USER_ID,
  organizationId: ORGANIZATION_ID,
  role: 'ADMIN',
  ...overrides,
});

/**
 * A prisma double that answers the queries this service actually issues, and
 * models the partial unique index on `(connectionId, kind, reportDate) WHERE kind
 * = 'SCHEDULED'` faithfully: a second SCHEDULED insert for the same day raises
 * P2002, while a second ON_DEMAND insert is accepted.
 */
function setup(
  options: {
    connectionOrganizationId?: string | null;
    identities?: IdentityRow[];
    memberships?: MembershipRow[];
    generate?: jest.Mock;
    sendFile?: jest.Mock;
  } = {},
) {
  const connectionOrganizationId =
    options.connectionOrganizationId === undefined
      ? ORGANIZATION_ID
      : options.connectionOrganizationId;
  const identities = options.identities ?? [identity({ phone: PHONE })];
  const memberships = options.memberships ?? [membership()];

  const rows: DeliveryRow[] = [];
  let sequence = 0;

  const prisma = {
    whatsAppDelivery: {
      create: jest.fn(
        ({
          data,
        }: {
          data: Pick<DeliveryRow, 'connectionId' | 'kind' | 'reportDate'>;
        }) => {
          const duplicate =
            data.kind === 'SCHEDULED' &&
            rows.some(
              (row) =>
                row.kind === 'SCHEDULED' &&
                row.connectionId === data.connectionId &&
                row.reportDate.getTime() === data.reportDate.getTime(),
            );
          if (duplicate) {
            return Promise.reject(
              Object.assign(new Error('unique constraint violated'), {
                code: 'P2002',
              }),
            );
          }
          const row: DeliveryRow = {
            id: `delivery-${++sequence}`,
            status: 'PENDING',
            failureReason: null,
            providerMessageId: null,
            attempts: 0,
            sentAt: null,
            ...data,
          };
          rows.push(row);
          return Promise.resolve({ id: row.id });
        },
      ),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<DeliveryRow> & { attempts?: { increment: number } };
        }) => {
          const row = rows.find((candidate) => candidate.id === where.id);
          if (!row) return Promise.reject(new Error('row not found'));
          const { attempts, ...rest } = data;
          Object.assign(row, rest);
          if (attempts) row.attempts += attempts.increment;
          return Promise.resolve(row);
        },
      ),
      findFirst: jest.fn(
        ({
          where,
        }: {
          where: {
            connectionId: string;
            kind: string;
            reportDate: Date;
          };
        }) =>
          Promise.resolve(
            rows.find(
              (row) =>
                row.connectionId === where.connectionId &&
                row.kind === where.kind &&
                row.reportDate.getTime() === where.reportDate.getTime(),
            ) ?? null,
          ),
      ),
    },
    whatsAppConnection: {
      findUnique: jest.fn(() =>
        Promise.resolve({ organizationId: connectionOrganizationId }),
      ),
    },
    whatsAppIdentity: {
      findMany: jest.fn(
        ({ where }: { where: { status: string; organizationId?: unknown } }) =>
          Promise.resolve(
            identities
              .filter((row) => row.status === where.status)
              .filter((row) =>
                where.organizationId
                  ? row.organizationId !== null
                  : row.organizationId === null,
              )
              .sort(
                (left, right) =>
                  (left.verifiedAt?.getTime() ?? 0) -
                  (right.verifiedAt?.getTime() ?? 0),
              )
              .map((row) => ({
                phone: row.phone,
                userId: row.userId,
                organizationId: row.organizationId,
              })),
          ),
      ),
    },
    organizationUser: {
      findMany: jest.fn(
        ({
          where,
        }: {
          where: { userId: { in: string[] }; role: { in: string[] } };
        }) =>
          Promise.resolve(
            memberships.filter(
              (row) =>
                where.userId.in.includes(row.userId) &&
                where.role.in.includes(row.role),
            ),
          ),
      ),
    },
    $transaction: jest.fn(() => {
      throw new Error('unexpected transaction');
    }),
  };

  const connections = {
    getOrCreateIntelligence: jest
      .fn()
      .mockResolvedValue({ id: CENTRAL_CONNECTION_ID }),
  };
  const reports = {
    generate: options.generate ?? jest.fn().mockResolvedValue(report),
  };
  const sender = {
    sendFile:
      options.sendFile ??
      jest.fn().mockResolvedValue({ providerMessageId: 'wamid-1' }),
  };
  const verify = jest.fn((phone: string) => {
    const row = identities.find(
      (candidate) =>
        candidate.phone === phone &&
        candidate.status === 'VERIFIED' &&
        candidate.organizationId !== null,
    );
    return Promise.resolve(row ?? null);
  });

  const service = new WhatsAppDeliveryService(
    prisma as unknown as PrismaService,
    connections as unknown as WhatsAppConnectionsService,
    { verify } as unknown as WhatsAppIdentityService,
    reports as unknown as DailyReportService,
    sender as unknown as WhatsAppFileSender,
  );

  return { service, prisma, connections, reports, sender, verify, rows };
}

function spyOnLogger() {
  return (['log', 'warn', 'error'] as const).map((channel) =>
    jest.spyOn(Logger.prototype, channel).mockImplementation(() => undefined),
  );
}

/** One string carrying everything a delivery must never log. */
function stringified(spies: jest.SpyInstance[]): string {
  return spies.map((spy) => JSON.stringify(spy.mock.calls)).join(' ');
}

describe('WhatsAppDeliveryService', () => {
  describe('day helpers', () => {
    it('truncates a day idempotently so the claim cannot be bypassed by an instant', () => {
      const instant = new Date('2026-03-04T02:30:00.000Z');

      expect(reportDayOf(instant)).toEqual(
        new Date('2026-03-04T00:00:00.000Z'),
      );
      expect(reportDayOf(reportDayOf(instant))).toEqual(reportDayOf(instant));
    });

    it('resolves the Bogota calendar day, not the UTC one', () => {
      // 02:30 UTC on the 4th is 21:30 on the 3rd in Bogota.
      expect(bogotaReportDay(new Date('2026-03-04T02:30:00.000Z'))).toEqual(
        REPORT_DAY,
      );
    });

    it('addresses a person as a provider chat id and never as free text', () => {
      expect(chatIdFor(PHONE)).toBe('573001112233@c.us');
      expect(chatIdFor('573001112233@c.us')).toBe('573001112233@c.us');
      expect(chatIdFor('120363000000000000@g.us')).toBeNull();
      expect(chatIdFor('')).toBeNull();
    });
  });

  describe('scheduled delivery', () => {
    it('claims the day, sends the PDF through the intelligence session and records it', async () => {
      const { service, sender, reports, rows } = setup();

      const outcome = await service.scheduled(
        COMMERCIAL_CONNECTION_ID,
        REPORT_DAY,
      );

      expect(outcome).toEqual({ status: 'sent', providerMessageId: 'wamid-1' });
      expect(reports.generate).toHaveBeenCalledWith(ORGANIZATION_ID);
      expect(sender.sendFile).toHaveBeenCalledTimes(1);

      const [session, file] = sender.sendFile.mock.calls[0] as [
        string,
        { chatId: string; filename: string; mimetype: string; base64: string },
      ];
      expect(session).toBe(INTELLIGENCE_SESSION);
      expect(file.chatId).toBe('573001112233@c.us');
      expect(file.mimetype).toBe('application/pdf');
      expect(file.filename).toBe('reporte-diario-2026-03-03.pdf');
      // It is a real PDF document, not a link and not a text dump.
      expect(Buffer.from(file.base64, 'base64').subarray(0, 4).toString()).toBe(
        '%PDF',
      );
      expect(file.base64.startsWith('data:')).toBe(false);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        connectionId: COMMERCIAL_CONNECTION_ID,
        kind: 'SCHEDULED',
        reportDate: REPORT_DAY,
        status: 'SENT',
        providerMessageId: 'wamid-1',
        attempts: 1,
        failureReason: null,
      });
      expect(rows[0].sentAt).toBeInstanceOf(Date);
    });

    it('never resends when the day was already claimed', async () => {
      const { service, sender, rows } = setup();

      await expect(
        service.scheduled(COMMERCIAL_CONNECTION_ID, REPORT_DAY),
      ).resolves.toEqual({ status: 'sent', providerMessageId: 'wamid-1' });

      await expect(
        service.scheduled(COMMERCIAL_CONNECTION_ID, REPORT_DAY),
      ).resolves.toEqual({ status: 'already_attempted' });

      // Same instant, different value: the claim is per calendar day.
      await expect(
        service.scheduled(
          COMMERCIAL_CONNECTION_ID,
          new Date('2026-03-03T18:00:00.000Z'),
        ),
      ).resolves.toEqual({ status: 'already_attempted' });

      expect(sender.sendFile).toHaveBeenCalledTimes(1);
      expect(rows).toHaveLength(1);
    });

    it('claims a new day independently', async () => {
      const { service, sender } = setup();

      await service.scheduled(COMMERCIAL_CONNECTION_ID, REPORT_DAY);
      await service.scheduled(
        COMMERCIAL_CONNECTION_ID,
        new Date('2026-03-04T00:00:00.000Z'),
      );

      expect(sender.sendFile).toHaveBeenCalledTimes(2);
    });

    it('records a provider rejection with a fixed reason and does not throw', async () => {
      const spies = spyOnLogger();
      try {
        const { service, sender, rows } = setup({
          sendFile: jest
            .fn()
            .mockRejectedValue(
              new ServiceUnavailableException('private-provider-body ' + PHONE),
            ),
        });

        const outcome = await service.scheduled(
          COMMERCIAL_CONNECTION_ID,
          REPORT_DAY,
        );

        expect(outcome).toEqual({
          status: 'failed',
          reason: 'provider_rejected',
        });
        expect(JSON.stringify(outcome)).not.toContain('private-provider-body');

        expect(rows[0]).toMatchObject({
          status: 'FAILED',
          failureReason: 'provider_rejected',
          providerMessageId: null,
          attempts: 1,
          sentAt: null,
        });

        // Retrying the same day is refused: one attempt, by design.
        await expect(
          service.scheduled(COMMERCIAL_CONNECTION_ID, REPORT_DAY),
        ).resolves.toEqual({ status: 'already_attempted' });
        expect(sender.sendFile).toHaveBeenCalledTimes(1);

        const logged = stringified(spies);
        expect(logged).toContain('whatsapp_delivery');
        expect(logged).toContain('provider_rejected');
        expect(logged).not.toContain('private-provider-body');
        expect(logged).not.toContain(PHONE);
        expect(logged).not.toContain('1234.56');
        expect(logged).not.toContain('%PDF');
      } finally {
        spies.forEach((spy) => spy.mockRestore());
      }
    });

    it('records an unexpected transport error as send_failed', async () => {
      const { service, rows } = setup({
        sendFile: jest.fn().mockRejectedValue(new TypeError('fetch failed')),
      });

      await expect(
        service.scheduled(COMMERCIAL_CONNECTION_ID, REPORT_DAY),
      ).resolves.toEqual({ status: 'failed', reason: 'send_failed' });
      expect(rows[0]).toMatchObject({
        status: 'FAILED',
        failureReason: 'send_failed',
        attempts: 1,
      });
    });

    it('records a report failure without calling the provider', async () => {
      const { service, sender, rows } = setup({
        generate: jest.fn().mockRejectedValue(new Error('database is down')),
      });

      await expect(
        service.scheduled(COMMERCIAL_CONNECTION_ID, REPORT_DAY),
      ).resolves.toEqual({ status: 'failed', reason: 'report_failed' });
      expect(sender.sendFile).not.toHaveBeenCalled();
      expect(rows[0]).toMatchObject({
        status: 'FAILED',
        failureReason: 'report_failed',
      });
    });

    it('records a render failure as its own fixed reason', async () => {
      const { service, sender, rows } = setup({
        // A report the real renderer cannot walk: no sales array.
        generate: jest.fn().mockResolvedValue({ date: '2026-03-03' }),
      });

      await expect(
        service.scheduled(COMMERCIAL_CONNECTION_ID, REPORT_DAY),
      ).resolves.toEqual({ status: 'failed', reason: 'render_failed' });
      expect(sender.sendFile).not.toHaveBeenCalled();
      expect(rows[0]).toMatchObject({
        status: 'FAILED',
        failureReason: 'render_failed',
      });
    });

    it('answers a distinct outcome when nobody is a verified administrator', async () => {
      const { service, sender, rows } = setup({ identities: [] });

      await expect(
        service.scheduled(COMMERCIAL_CONNECTION_ID, REPORT_DAY),
      ).resolves.toEqual({ status: 'no_identity' });
      expect(sender.sendFile).not.toHaveBeenCalled();
      expect(rows[0]).toMatchObject({
        status: 'FAILED',
        failureReason: 'no_recipient',
        attempts: 1,
      });
    });

    it('never sends figures to a verified non-administrator identity', async () => {
      const { service, sender } = setup({
        identities: [identity({ phone: PHONE })],
        memberships: [membership({ role: 'CASHIER' })],
      });

      await expect(
        service.scheduled(COMMERCIAL_CONNECTION_ID, REPORT_DAY),
      ).resolves.toEqual({ status: 'no_identity' });
      expect(sender.sendFile).not.toHaveBeenCalled();
    });

    it('ignores an identity whose user is only an administrator in another organization', async () => {
      const { service, sender } = setup({
        identities: [identity({ phone: PHONE })],
        memberships: [
          membership({ organizationId: OTHER_ORGANIZATION_ID, role: 'OWNER' }),
        ],
      });

      await expect(
        service.scheduled(COMMERCIAL_CONNECTION_ID, REPORT_DAY),
      ).resolves.toEqual({ status: 'no_identity' });
      expect(sender.sendFile).not.toHaveBeenCalled();
    });

    it('resolves the single administrative organization behind the central connection', async () => {
      const { service, sender, reports } = setup({
        connectionOrganizationId: null,
        identities: [identity({ phone: PHONE })],
      });

      await expect(
        service.scheduled(CENTRAL_CONNECTION_ID, REPORT_DAY),
      ).resolves.toEqual({ status: 'sent', providerMessageId: 'wamid-1' });
      expect(reports.generate).toHaveBeenCalledWith(ORGANIZATION_ID);
      expect(sender.sendFile.mock.calls[0][1]).toMatchObject({
        chatId: '573001112233@c.us',
      });
    });

    it('refuses to guess which organization the central connection speaks for', async () => {
      const { service, sender, reports, rows } = setup({
        connectionOrganizationId: null,
        identities: [
          identity({ phone: PHONE }),
          identity({
            phone: OTHER_PHONE,
            userId: OTHER_USER_ID,
            organizationId: OTHER_ORGANIZATION_ID,
          }),
        ],
        memberships: [
          membership(),
          membership({
            userId: OTHER_USER_ID,
            organizationId: OTHER_ORGANIZATION_ID,
          }),
        ],
      });

      await expect(
        service.scheduled(CENTRAL_CONNECTION_ID, REPORT_DAY),
      ).resolves.toEqual({
        status: 'failed',
        reason: 'organization_ambiguous',
      });
      expect(reports.generate).not.toHaveBeenCalled();
      expect(sender.sendFile).not.toHaveBeenCalled();
      expect(rows[0]).toMatchObject({
        status: 'FAILED',
        failureReason: 'organization_ambiguous',
      });
    });

    it('exposes the claimed day to a read-only caller', async () => {
      const { service } = setup();

      await expect(
        service.findScheduled(COMMERCIAL_CONNECTION_ID, REPORT_DAY),
      ).resolves.toBeNull();
      await service.scheduled(COMMERCIAL_CONNECTION_ID, REPORT_DAY);
      await expect(
        service.findScheduled(COMMERCIAL_CONNECTION_ID, REPORT_DAY),
      ).resolves.toMatchObject({ status: 'SENT' });
    });
  });

  describe('on-demand delivery', () => {
    const context = { organizationId: ORGANIZATION_ID, phone: PHONE };

    it('sends to the caller own phone, as an ON_DEMAND row', async () => {
      const { service, sender, rows, connections } = setup();

      await expect(service.onDemand(context)).resolves.toEqual({
        status: 'sent',
        providerMessageId: 'wamid-1',
      });

      expect(connections.getOrCreateIntelligence).toHaveBeenCalled();
      expect(sender.sendFile.mock.calls[0][1]).toMatchObject({
        chatId: '573001112233@c.us',
      });
      expect(rows[0]).toMatchObject({
        connectionId: CENTRAL_CONNECTION_ID,
        kind: 'ON_DEMAND',
        status: 'SENT',
      });
    });

    it('allows a second on-demand report on the same day', async () => {
      const { service, sender, rows } = setup();

      await service.onDemand(context);
      await expect(service.onDemand(context)).resolves.toMatchObject({
        status: 'sent',
      });

      expect(sender.sendFile).toHaveBeenCalledTimes(2);
      expect(rows).toHaveLength(2);
      // The partial unique index covers SCHEDULED only; the stored day is still
      // today's Bogota day for both rows.
      expect(rows[0].reportDate).toEqual(rows[1].reportDate);
      expect(rows[0].reportDate).toEqual(bogotaReportDay(new Date()));
    });

    it('is a distinct outcome for an unverified phone and sends nothing', async () => {
      const { service, sender, rows } = setup({ identities: [] });

      await expect(service.onDemand(context)).resolves.toEqual({
        status: 'no_identity',
      });
      expect(sender.sendFile).not.toHaveBeenCalled();
      expect(rows).toHaveLength(0);
    });

    it('is a distinct outcome when the phone is verified in another organization', async () => {
      const { service, sender } = setup({
        identities: [
          identity({ phone: PHONE, organizationId: OTHER_ORGANIZATION_ID }),
        ],
        memberships: [],
      });

      await expect(service.onDemand(context)).resolves.toEqual({
        status: 'no_identity',
      });
      expect(sender.sendFile).not.toHaveBeenCalled();
    });

    it('is a distinct outcome when the context carries no usable phone', async () => {
      const { service, sender } = setup();

      for (const phone of ['', '120363000000000000@g.us', undefined as never]) {
        await expect(
          service.onDemand({ organizationId: ORGANIZATION_ID, phone }),
        ).resolves.toEqual({ status: 'no_identity' });
      }
      expect(sender.sendFile).not.toHaveBeenCalled();
    });

    it('records a failed on-demand send with a fixed reason', async () => {
      const { service, rows } = setup({
        sendFile: jest
          .fn()
          .mockRejectedValue(
            new ServiceUnavailableException('provider said no'),
          ),
      });

      await expect(service.onDemand(context)).resolves.toEqual({
        status: 'failed',
        reason: 'provider_rejected',
      });
      expect(rows[0]).toMatchObject({
        kind: 'ON_DEMAND',
        status: 'FAILED',
        failureReason: 'provider_rejected',
        attempts: 1,
      });
    });
  });
});
