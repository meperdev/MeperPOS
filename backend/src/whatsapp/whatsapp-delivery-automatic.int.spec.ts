/**
 * The automatic daily report against real PostgreSQL (S12).
 *
 * Three things here can only be proven by the database, not by a double:
 *
 *  - the claim is a partial unique index on
 *    `(connectionId, kind, reportDate) WHERE kind = 'SCHEDULED'`, so two runs that
 *    both resolved a recipient still produce exactly one send and one
 *    `already_attempted`;
 *  - a day without a recipient writes no row at all, which is the whole point of
 *    resolving the target before the claim;
 *  - the failure streak is read from stored `status` + `createdAt` values, so the
 *    pause has to survive the round trip through a `date` column and a
 *    `timestamp` one before a manual send clears it.
 *
 * Every row this suite creates is uniquely named and belongs to this file; the
 * fixtures are deleted at the end, and nothing that existed before is touched.
 */
import { PrismaClient } from '@prisma/client';
import type { WhatsAppConnectionsService } from './whatsapp-connections.service';
import {
  MAX_CONSECUTIVE_SCHEDULED_FAILURES,
  WhatsAppDeliveryService,
} from './whatsapp-delivery.service';
import type { WhatsAppIdentityService } from './whatsapp-identity.service';
import type { WhatsAppFileSender } from './whatsapp-provider';

/** A report the real PDF renderer accepts; the figures are not asserted. */
const report = {
  cutoff: new Date('2026-03-04T01:00:00.000Z'),
  date: '2026-03-03',
  timezone: 'America/Bogota' as const,
  salesTotal: '0.00',
  expenseTotal: '0.00',
  sales: [],
  expenses: [],
  lowStock: [],
  purchaseOrders: [],
  loans: [],
};

const DAY = new Date('2026-03-03T00:00:00.000Z');

const dayAfter = (day: Date, offset: number): Date =>
  new Date(day.getTime() + offset * 24 * 60 * 60 * 1000);

describe('WhatsApp automatic report (real PostgreSQL)', () => {
  const prisma = new PrismaClient();
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const phone = `5730${String(Date.now()).slice(-8)}`;

  let organizationId: string;
  let userId: string;
  let connectionId: string;
  let identityId: string;
  let service: WhatsAppDeliveryService;
  const sendFile = jest.fn();

  const identitiesFor = (verified: boolean) =>
    prisma.whatsAppIdentity.update({
      where: { id: identityId },
      data: verified
        ? { status: 'VERIFIED', verifiedAt: new Date() }
        : { status: 'REVOKED', verifiedAt: null },
    });

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: `Automatic report ${suffix}`, slug: `automatic-${suffix}` },
    });
    organizationId = organization.id;

    const user = await prisma.user.create({
      data: {
        email: `automatic-${suffix}@example.test`,
        password: 'not-used-by-this-suite',
        name: 'Automatic report',
      },
    });
    userId = user.id;

    await prisma.organizationUser.create({
      data: { userId, organizationId, role: 'ADMIN' },
    });

    // A connection owned by this organization: the central channel is unique per
    // deployment, so a suite that wants its own isolated history uses a
    // commercial one. The service only ever reads the organization from it.
    const connection = await prisma.whatsAppConnection.create({
      data: {
        sessionName: `meper-automatic-${suffix}`,
        channel: 'COMMERCIAL',
        organizationId,
      },
    });
    connectionId = connection.id;

    const identity = await prisma.whatsAppIdentity.create({
      data: {
        phone,
        userId,
        organizationId,
        status: 'VERIFIED',
        verifiedAt: new Date(),
      },
    });
    identityId = identity.id;

    // The connection exists and is returned as-is; the scheduler's own
    // get-or-create is not what this suite is proving.
    const connections = {
      getOrCreateIntelligence: () => Promise.resolve(connection),
    };
    const identityService = {
      verify: (candidate: string) =>
        prisma.whatsAppIdentity.findFirst({
          where: {
            phone: candidate,
            status: 'VERIFIED',
            organizationId: { not: null },
          },
        }),
    };
    const reports = { generate: () => Promise.resolve(report) };

    sendFile.mockResolvedValue({ providerMessageId: `wamid-${suffix}` });

    service = new WhatsAppDeliveryService(
      prisma as never,
      connections as unknown as WhatsAppConnectionsService,
      identityService as unknown as WhatsAppIdentityService,
      reports as never,
      { sendFile } as unknown as WhatsAppFileSender,
    );
  });

  beforeEach(async () => {
    sendFile.mockClear();
    // Every test starts from the same fixture state: a verified administrator and
    // no delivery rows of its own.
    await prisma.whatsAppDelivery.deleteMany({ where: { connectionId } });
    await identitiesFor(true);
  });

  afterAll(async () => {
    // Only this suite's fixtures: the delivery rows follow the connection.
    await prisma.whatsAppConnection.deleteMany({ where: { id: connectionId } });
    await prisma.whatsAppIdentity.deleteMany({ where: { id: identityId } });
    await prisma.organizationUser.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  it('sends once when two runs claim the same day at the same time', async () => {
    const outcomes = await Promise.all([
      service.scheduled(connectionId, DAY),
      service.scheduled(connectionId, DAY),
    ]);

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([
      'already_attempted',
      'sent',
    ]);
    expect(sendFile).toHaveBeenCalledTimes(1);

    const rows = await prisma.whatsAppDelivery.findMany({
      where: { connectionId },
      select: { status: true, attempts: true, reportDate: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'SENT', attempts: 1 });
  });

  it('writes no row for a day without a recipient and sends once one exists', async () => {
    await identitiesFor(false);

    await expect(service.scheduled(connectionId, DAY)).resolves.toEqual({
      status: 'no_identity',
    });
    expect(sendFile).not.toHaveBeenCalled();
    await expect(
      prisma.whatsAppDelivery.count({ where: { connectionId } }),
    ).resolves.toBe(0);

    // A number linked later that day is what the skipped day leaves room for.
    await identitiesFor(true);

    await expect(service.scheduled(connectionId, DAY)).resolves.toMatchObject({
      status: 'sent',
    });
  });

  it('pauses after three failed days, writes nothing for the fourth, and resumes on a manual send', async () => {
    sendFile.mockRejectedValue(new Error('provider down'));

    for (
      let offset = 0;
      offset < MAX_CONSECUTIVE_SCHEDULED_FAILURES;
      offset += 1
    ) {
      await expect(
        service.scheduled(connectionId, dayAfter(DAY, offset)),
      ).resolves.toEqual({ status: 'failed', reason: 'send_failed' });
    }
    const failedRows = await prisma.whatsAppDelivery.count({
      where: { connectionId },
    });
    expect(failedRows).toBe(MAX_CONSECUTIVE_SCHEDULED_FAILURES);
    expect(sendFile).toHaveBeenCalledTimes(MAX_CONSECUTIVE_SCHEDULED_FAILURES);

    const pausedDay = dayAfter(DAY, MAX_CONSECUTIVE_SCHEDULED_FAILURES);
    await expect(service.scheduled(connectionId, pausedDay)).resolves.toEqual({
      status: 'paused',
    });
    await expect(
      prisma.whatsAppDelivery.count({ where: { connectionId } }),
    ).resolves.toBe(failedRows);
    expect(sendFile).toHaveBeenCalledTimes(MAX_CONSECUTIVE_SCHEDULED_FAILURES);

    // The manual report is the resume action, and it is an ON_DEMAND row.
    sendFile.mockResolvedValue({ providerMessageId: `wamid-manual-${suffix}` });
    await expect(
      service.onDemand({ organizationId, phone }),
    ).resolves.toMatchObject({ status: 'sent' });

    await expect(
      service.scheduled(connectionId, pausedDay),
    ).resolves.toMatchObject({ status: 'sent' });

    // In the order the attempts happened, which is the story the streak tells.
    const kinds = await prisma.whatsAppDelivery.findMany({
      where: { connectionId },
      orderBy: { createdAt: 'asc' },
      select: { kind: true, status: true },
    });
    expect(kinds.map((row) => row.kind)).toEqual([
      'SCHEDULED',
      'SCHEDULED',
      'SCHEDULED',
      'ON_DEMAND',
      'SCHEDULED',
    ]);
    expect(kinds.filter((row) => row.status === 'SENT')).toHaveLength(2);
  });
  it('sends exactly once when a day first skipped later gets a number and runs race', async () => {
    await identitiesFor(false);
    await expect(service.scheduled(connectionId, DAY)).resolves.toEqual({
      status: 'no_identity',
    });
    expect(
      await prisma.whatsAppDelivery.count({ where: { connectionId } }),
    ).toBe(0);
    expect(sendFile).not.toHaveBeenCalled();

    await identitiesFor(true);
    const outcomes = await Promise.all([
      service.scheduled(connectionId, DAY),
      service.scheduled(connectionId, DAY),
      service.scheduled(connectionId, DAY),
    ]);
    expect(outcomes.filter((o) => o.status === 'sent')).toHaveLength(1);
    expect(
      outcomes.filter((o) => o.status === 'already_attempted'),
    ).toHaveLength(2);
    expect(sendFile).toHaveBeenCalledTimes(1);
    expect(
      await prisma.whatsAppDelivery.count({ where: { connectionId } }),
    ).toBe(1);
  });

  it('leaves every stored row unchanged while paused', async () => {
    sendFile.mockRejectedValue(new Error('provider down'));
    for (let i = 0; i < MAX_CONSECUTIVE_SCHEDULED_FAILURES; i += 1) {
      await service.scheduled(connectionId, dayAfter(DAY, i));
    }
    const snapshot = async () =>
      JSON.stringify(
        await prisma.whatsAppDelivery.findMany({
          where: { connectionId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
      );
    const before = await snapshot();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(
        service.scheduled(
          connectionId,
          dayAfter(DAY, MAX_CONSECUTIVE_SCHEDULED_FAILURES),
        ),
      ).resolves.toEqual({ status: 'paused' });
    }
    expect(await snapshot()).toBe(before);
    expect(sendFile).toHaveBeenCalledTimes(MAX_CONSECUTIVE_SCHEDULED_FAILURES);
  });

  it('does not resume on a failed manual send nor on a success older than the failures', async () => {
    sendFile.mockRejectedValue(new Error('provider down'));
    for (let i = 0; i < MAX_CONSECUTIVE_SCHEDULED_FAILURES; i += 1) {
      await service.scheduled(connectionId, dayAfter(DAY, i));
    }
    await expect(
      service.onDemand({ organizationId, phone }),
    ).resolves.toMatchObject({ status: 'failed' });
    await expect(
      service.scheduled(
        connectionId,
        dayAfter(DAY, MAX_CONSECUTIVE_SCHEDULED_FAILURES),
      ),
    ).resolves.toEqual({ status: 'paused' });

    await prisma.whatsAppDelivery.deleteMany({ where: { connectionId } });
    const old = new Date('2026-01-01T00:00:00.000Z');
    const sent = await prisma.whatsAppDelivery.create({
      data: {
        connectionId,
        kind: 'ON_DEMAND',
        reportDate: DAY,
        status: 'SENT',
        sentAt: old,
      },
    });
    await prisma.whatsAppDelivery.update({
      where: { id: sent.id },
      data: { createdAt: old },
    });
    for (let i = 0; i < MAX_CONSECUTIVE_SCHEDULED_FAILURES; i += 1) {
      await service.scheduled(connectionId, dayAfter(DAY, i));
    }
    await expect(
      service.scheduled(
        connectionId,
        dayAfter(DAY, MAX_CONSECUTIVE_SCHEDULED_FAILURES),
      ),
    ).resolves.toEqual({ status: 'paused' });
  });
});
