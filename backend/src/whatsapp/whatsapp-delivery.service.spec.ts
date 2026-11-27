import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { DailyReportService } from '../reports/daily-report.service';
import {
  INTELLIGENCE_SESSION,
  type WhatsAppConnectionsService,
} from './whatsapp-connections.service';
import {
  MAX_CONSECUTIVE_SCHEDULED_FAILURES,
  bogotaReportDay,
  chatIdFor,
  nextScheduledRunAt,
  reportDayOf,
  scheduledFailureStreak,
  WhatsAppDeliveryService,
  type RecentScheduledDelivery,
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

/** The report day `offset` whole days after `day`. */
const dayAfter = (day: Date, offset: number): Date =>
  new Date(day.getTime() + offset * 24 * 60 * 60 * 1000);

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
  createdAt: Date;
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

  /** A monotonic claim clock, so "newest first" is a property of the double. */
  const claimedAt = () => new Date(Date.UTC(2026, 0, 1) + sequence * 60_000);

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
          sequence += 1;
          const row: DeliveryRow = {
            id: `delivery-${sequence}`,
            status: 'PENDING',
            failureReason: null,
            providerMessageId: null,
            attempts: 0,
            sentAt: null,
            createdAt: claimedAt(),
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
            kind?: string;
            reportDate?: Date;
            status?: string;
          };
        }) =>
          Promise.resolve(
            where.status
              ? (rows
                  .filter(
                    (row) =>
                      row.connectionId === where.connectionId &&
                      row.status === where.status,
                  )
                  .sort(
                    (left, right) =>
                      right.createdAt.getTime() - left.createdAt.getTime(),
                  )[0] ?? null)
              : (rows.find(
                  (row) =>
                    row.connectionId === where.connectionId &&
                    row.kind === where.kind &&
                    row.reportDate.getTime() === where.reportDate?.getTime(),
                ) ?? null),
          ),
      ),
      findMany: jest.fn(
        ({
          where,
          take,
        }: {
          where: { connectionId: string; kind: string };
          take: number;
        }) =>
          Promise.resolve(
            rows
              .filter(
                (row) =>
                  row.connectionId === where.connectionId &&
                  row.kind === where.kind,
              )
              .sort(
                (left, right) =>
                  right.reportDate.getTime() - left.reportDate.getTime() ||
                  right.createdAt.getTime() - left.createdAt.getTime(),
              )
              .slice(0, take)
              .map((row) => ({
                status: row.status,
                createdAt: row.createdAt,
              })),
          ),
      ),
    },
    whatsAppConnection: {
      findUnique: jest.fn(() =>
        Promise.resolve({ organizationId: connectionOrganizationId }),
      ),
      findFirst: jest.fn(({ where }: { where?: { channel?: string } } = {}) =>
        Promise.resolve(
          where?.channel === 'INTELLIGENCE'
            ? {
                id: CENTRAL_CONNECTION_ID,
                organizationId: connectionOrganizationId,
              }
            : null,
        ),
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
      expect(chatIdFor('573001112233@lid')).toBeNull();
      expect(chatIdFor('')).toBeNull();
    });
  });

  describe('the automatic send schedule', () => {
    it('is due at 20:00 in America/Bogota, before and after the hour', () => {
      // 10:00 Bogota on 2026-03-03: today at 20:00 is 01:00 UTC the next day.
      expect(nextScheduledRunAt(new Date('2026-03-03T15:00:00.000Z'))).toEqual(
        new Date('2026-03-04T01:00:00.000Z'),
      );
      // 19:59 Bogota the same day: still today.
      expect(nextScheduledRunAt(new Date('2026-03-04T00:59:00.000Z'))).toEqual(
        new Date('2026-03-04T01:00:00.000Z'),
      );
      // Exactly at the hour the cron has fired: the next one is tomorrow.
      expect(nextScheduledRunAt(new Date('2026-03-04T01:00:00.000Z'))).toEqual(
        new Date('2026-03-05T01:00:00.000Z'),
      );
      // 23:59 Bogota: tomorrow's 20:00, and it stays in the same Bogota day.
      expect(nextScheduledRunAt(new Date('2026-03-04T04:59:00.000Z'))).toEqual(
        new Date('2026-03-05T01:00:00.000Z'),
      );
    });
  });

  describe('scheduled failure streak', () => {
    const failure = (createdAt: string): RecentScheduledDelivery => ({
      status: 'FAILED',
      createdAt: new Date(createdAt),
    });
    const sent = (createdAt: string): RecentScheduledDelivery => ({
      status: 'SENT',
      createdAt: new Date(createdAt),
    });

    it('pauses on three consecutive failed days and dates the pause at the third', () => {
      const streak = scheduledFailureStreak(
        [
          failure('2026-03-03T01:05:00.000Z'),
          failure('2026-03-02T01:05:00.000Z'),
          failure('2026-03-01T01:05:00.000Z'),
        ],
        null,
      );

      expect(streak).toEqual({
        consecutiveFailures: MAX_CONSECUTIVE_SCHEDULED_FAILURES,
        paused: true,
        pausedSince: new Date('2026-03-03T01:05:00.000Z'),
      });
    });

    it('counts a shorter run without pausing', () => {
      expect(
        scheduledFailureStreak(
          [
            failure('2026-03-02T01:05:00.000Z'),
            failure('2026-03-01T01:05:00.000Z'),
          ],
          null,
        ),
      ).toEqual({ consecutiveFailures: 2, paused: false, pausedSince: null });
    });

    it('stops at a successful scheduled day, whatever came before it', () => {
      expect(
        scheduledFailureStreak(
          [
            sent('2026-03-03T01:05:00.000Z'),
            failure('2026-03-02T01:05:00.000Z'),
            failure('2026-03-01T01:05:00.000Z'),
          ],
          null,
        ),
      ).toEqual({ consecutiveFailures: 0, paused: false, pausedSince: null });
    });

    it('resumes after a successful delivery of any kind newer than the streak', () => {
      expect(
        scheduledFailureStreak(
          [
            failure('2026-03-03T01:05:00.000Z'),
            failure('2026-03-02T01:05:00.000Z'),
            failure('2026-03-01T01:05:00.000Z'),
          ],
          // The manual send the administrator made after the third failure.
          new Date('2026-03-03T15:00:00.000Z'),
        ),
      ).toEqual({ consecutiveFailures: 0, paused: false, pausedSince: null });
    });

    it('stays paused when the only success is older than the oldest failure', () => {
      expect(
        scheduledFailureStreak(
          [
            failure('2026-03-03T01:05:00.000Z'),
            failure('2026-03-02T01:05:00.000Z'),
            failure('2026-03-01T01:05:00.000Z'),
          ],
          new Date('2026-02-28T15:00:00.000Z'),
        ),
      ).toMatchObject({ paused: true });
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

    it('skips the day and records nothing when nobody is a verified administrator', async () => {
      const spies = spyOnLogger();
      try {
        const { service, sender, rows } = setup({ identities: [] });

        await expect(
          service.scheduled(COMMERCIAL_CONNECTION_ID, REPORT_DAY),
        ).resolves.toEqual({ status: 'no_identity' });
        expect(sender.sendFile).not.toHaveBeenCalled();
        // Nothing was attempted, so nothing is recorded: the screen reports the
        // missing recipient from the automatic state instead of a failed day.
        expect(rows).toHaveLength(0);
        expect(stringified(spies)).toContain('skipped_no_recipient');
      } finally {
        spies.forEach((spy) => spy.mockRestore());
      }
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
          membership({ organizationId: OTHER_ORGANIZATION_ID, role: 'ADMIN' }),
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
      const spies = spyOnLogger();
      try {
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
        // An unresolved recipient is skipped before the claim, so the day leaves
        // no row behind and the history stops filling with days nobody sent.
        expect(rows).toHaveLength(0);
        expect(stringified(spies)).toContain('skipped_organization_ambiguous');
      } finally {
        spies.forEach((spy) => spy.mockRestore());
      }
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

    it('answers the day that already has a row before resolving a recipient', async () => {
      const identities = [identity({ phone: PHONE })];
      const { service } = setup({ identities });

      await expect(
        service.scheduled(COMMERCIAL_CONNECTION_ID, REPORT_DAY),
      ).resolves.toMatchObject({ status: 'sent' });

      // The only administrator is revoked later that day; the day is still the
      // same attempt, so a retry says so instead of reporting a missing recipient.
      identities.length = 0;

      await expect(
        service.scheduled(COMMERCIAL_CONNECTION_ID, REPORT_DAY),
      ).resolves.toEqual({ status: 'already_attempted' });
    });

    it('pauses after three consecutive failed days and writes no row for the skipped day', async () => {
      const spies = spyOnLogger();
      try {
        const sendFile = jest
          .fn()
          .mockRejectedValue(new Error('provider down'));
        const { service, prisma, rows } = setup({ sendFile });

        for (
          let offset = 0;
          offset < MAX_CONSECUTIVE_SCHEDULED_FAILURES;
          offset += 1
        ) {
          await expect(
            service.scheduled(
              COMMERCIAL_CONNECTION_ID,
              dayAfter(REPORT_DAY, offset),
            ),
          ).resolves.toEqual({ status: 'failed', reason: 'send_failed' });
        }
        const failedDays = rows.length;
        expect(failedDays).toBe(MAX_CONSECUTIVE_SCHEDULED_FAILURES);

        await expect(
          service.scheduled(
            COMMERCIAL_CONNECTION_ID,
            dayAfter(REPORT_DAY, MAX_CONSECUTIVE_SCHEDULED_FAILURES),
          ),
        ).resolves.toEqual({ status: 'paused' });

        // The pause is a skip, not an attempt: no row, no provider call.
        expect(rows).toHaveLength(failedDays);
        expect(sendFile).toHaveBeenCalledTimes(
          MAX_CONSECUTIVE_SCHEDULED_FAILURES,
        );
        expect(stringified(spies)).toContain('skipped_paused');

        // The verdict comes from the last scheduled days of this connection only.
        expect(prisma.whatsAppDelivery.findMany).toHaveBeenCalledWith({
          where: { connectionId: COMMERCIAL_CONNECTION_ID, kind: 'SCHEDULED' },
          orderBy: [
            { reportDate: 'desc' },
            { createdAt: 'desc' },
            { id: 'desc' },
          ],
          take: MAX_CONSECUTIVE_SCHEDULED_FAILURES,
          select: { status: true, createdAt: true },
        });
      } finally {
        spies.forEach((spy) => spy.mockRestore());
      }
    });

    it('keeps sending on a streak shorter than the limit', async () => {
      const sendFile = jest
        .fn()
        .mockRejectedValueOnce(new Error('provider down'))
        .mockRejectedValueOnce(new Error('provider down'))
        .mockResolvedValue({ providerMessageId: 'wamid-1' });
      const { service } = setup({ sendFile });

      await service.scheduled(COMMERCIAL_CONNECTION_ID, REPORT_DAY);
      await service.scheduled(
        COMMERCIAL_CONNECTION_ID,
        dayAfter(REPORT_DAY, 1),
      );

      await expect(
        service.scheduled(COMMERCIAL_CONNECTION_ID, dayAfter(REPORT_DAY, 2)),
      ).resolves.toEqual({ status: 'sent', providerMessageId: 'wamid-1' });
    });

    it('is not paused by failed manual sends', async () => {
      const sendFile = jest
        .fn()
        .mockRejectedValueOnce(new Error('provider down'))
        .mockRejectedValueOnce(new Error('provider down'))
        .mockRejectedValueOnce(new Error('provider down'))
        .mockResolvedValue({ providerMessageId: 'wamid-1' });
      const { service } = setup({ sendFile });

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await expect(
          service.onDemand({ organizationId: ORGANIZATION_ID, phone: PHONE }),
        ).resolves.toEqual({ status: 'failed', reason: 'send_failed' });
      }

      await expect(
        service.scheduled(COMMERCIAL_CONNECTION_ID, REPORT_DAY),
      ).resolves.toEqual({ status: 'sent', providerMessageId: 'wamid-1' });
    });

    it('a manual send after the streak resumes the automatic one', async () => {
      // Three failed scheduled days, then the on-demand document the
      // administrator asks for, then the next scheduled day.
      const sendFile = jest
        .fn()
        .mockRejectedValueOnce(new Error('provider down'))
        .mockRejectedValueOnce(new Error('provider down'))
        .mockRejectedValueOnce(new Error('provider down'))
        .mockResolvedValue({ providerMessageId: 'wamid-1' });
      const { service, rows } = setup({
        sendFile,
        connectionOrganizationId: null,
        identities: [identity({ phone: PHONE })],
      });

      for (
        let offset = 0;
        offset < MAX_CONSECUTIVE_SCHEDULED_FAILURES;
        offset += 1
      ) {
        await service.scheduled(
          CENTRAL_CONNECTION_ID,
          dayAfter(REPORT_DAY, offset),
        );
      }
      await expect(
        service.scheduled(
          CENTRAL_CONNECTION_ID,
          dayAfter(REPORT_DAY, MAX_CONSECUTIVE_SCHEDULED_FAILURES),
        ),
      ).resolves.toEqual({ status: 'paused' });

      await expect(
        service.onDemand({ organizationId: ORGANIZATION_ID, phone: PHONE }),
      ).resolves.toEqual({ status: 'sent', providerMessageId: 'wamid-1' });

      await expect(
        service.scheduled(
          CENTRAL_CONNECTION_ID,
          dayAfter(REPORT_DAY, MAX_CONSECUTIVE_SCHEDULED_FAILURES),
        ),
      ).resolves.toEqual({ status: 'sent', providerMessageId: 'wamid-1' });

      expect(rows.map((row) => row.kind)).toEqual([
        'SCHEDULED',
        'SCHEDULED',
        'SCHEDULED',
        'ON_DEMAND',
        'SCHEDULED',
      ]);
    });
  });

  describe('automatic send state', () => {
    // 10:00 in Bogota on 2026-03-03: the next run is today at 20:00.
    const NOW = new Date('2026-03-03T15:00:00.000Z');
    const NEXT_RUN = '2026-03-04T01:00:00.000Z';

    it('is active with the next run when a recipient exists', async () => {
      const { service } = setup({
        connectionOrganizationId: null,
        identities: [identity({ phone: PHONE })],
      });

      await expect(
        service.automaticState(ORGANIZATION_ID, NOW),
      ).resolves.toEqual({
        state: 'active',
        consecutiveFailures: 0,
        pausedSince: null,
        nextRunAt: NEXT_RUN,
      });
    });

    it('is paused without a recipient when nobody is a verified administrator', async () => {
      const { service } = setup({
        connectionOrganizationId: null,
        identities: [],
      });

      await expect(
        service.automaticState(ORGANIZATION_ID, NOW),
      ).resolves.toEqual({
        state: 'paused_no_recipient',
        consecutiveFailures: 0,
        pausedSince: null,
        nextRunAt: NEXT_RUN,
      });
    });

    it('is paused for an organization the automatic send does not serve', async () => {
      const { service } = setup({
        connectionOrganizationId: null,
        identities: [
          identity({
            phone: OTHER_PHONE,
            userId: OTHER_USER_ID,
            organizationId: OTHER_ORGANIZATION_ID,
          }),
        ],
        memberships: [
          membership({
            userId: OTHER_USER_ID,
            organizationId: OTHER_ORGANIZATION_ID,
          }),
        ],
      });

      await expect(
        service.automaticState(ORGANIZATION_ID, NOW),
      ).resolves.toMatchObject({
        state: 'paused_no_recipient',
        consecutiveFailures: 0,
      });
    });

    it('reports the failure pause with its count and instant, and clears after a manual send', async () => {
      const sendFile = jest
        .fn()
        .mockRejectedValueOnce(new Error('provider down'))
        .mockRejectedValueOnce(new Error('provider down'))
        .mockRejectedValueOnce(new Error('provider down'))
        .mockResolvedValue({ providerMessageId: 'wamid-1' });
      const { service, rows } = setup({
        sendFile,
        connectionOrganizationId: null,
        identities: [identity({ phone: PHONE })],
      });

      for (
        let offset = 0;
        offset < MAX_CONSECUTIVE_SCHEDULED_FAILURES;
        offset += 1
      ) {
        await service.scheduled(
          CENTRAL_CONNECTION_ID,
          dayAfter(REPORT_DAY, offset),
        );
      }

      const paused = await service.automaticState(ORGANIZATION_ID, NOW);
      expect(paused.state).toBe('paused_failures');
      expect(paused.consecutiveFailures).toBe(
        MAX_CONSECUTIVE_SCHEDULED_FAILURES,
      );
      // The streak reached the limit with the newest failure.
      expect(paused.pausedSince).toBe(
        rows[MAX_CONSECUTIVE_SCHEDULED_FAILURES - 1].createdAt.toISOString(),
      );

      await service.onDemand({ organizationId: ORGANIZATION_ID, phone: PHONE });

      await expect(
        service.automaticState(ORGANIZATION_ID, NOW),
      ).resolves.toMatchObject({
        state: 'active',
        consecutiveFailures: 0,
        pausedSince: null,
      });
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

      for (const phone of [
        '',
        '120363000000000000@g.us',
        // An opaque LID carries digits that belong to no phone: reducing them
        // would address the document to whoever happens to own that number.
        '573001112233@lid',
        undefined as never,
      ]) {
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
