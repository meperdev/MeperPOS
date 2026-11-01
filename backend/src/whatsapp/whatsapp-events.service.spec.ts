import { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { DailyReportService } from '../reports/daily-report.service';
import { WhatsAppAdminService } from './whatsapp-admin.service';
import type { WhatsAppConnectionsService } from './whatsapp-connections.service';
import { INTELLIGENCE_SESSION } from './whatsapp-connections.service';
import type { WhatsAppDeliveryService } from './whatsapp-delivery.service';
import { WhatsAppEventsService } from './whatsapp-events.service';
import {
  WhatsAppIdentityService,
  hashLinkCode,
} from './whatsapp-identity.service';
import {
  DuplicateWhatsAppMessageError,
  type WhatsAppEventPayload,
  type WhatsAppIngestionService,
} from './whatsapp-ingestion.service';
import type { WhatsAppSupervisionService } from './whatsapp-supervision.service';

const commercialRow = {
  id: 'c1',
  channel: 'COMMERCIAL',
  organizationId: 'org-1',
};
const intelligenceRow = {
  id: 'c2',
  channel: 'INTELLIGENCE',
  organizationId: null,
};

const payload: WhatsAppEventPayload = {
  from: '573001112233@c.us',
  fromMe: false,
  source: 'app',
  body: 'hola',
  timestamp: 1_700_000_000,
};

function setup(row: unknown) {
  // The transaction client is a different object from the root client on
  // purpose: a write that escapes the transaction is then visible in the spec.
  const tx = { whatsAppProcessedEvent: { create: jest.fn() } };
  const committed: string[] = [];
  const prisma = {
    whatsAppProcessedEvent: { create: jest.fn() },
    $transaction: jest.fn(
      async (run: (client: typeof tx) => Promise<void>): Promise<void> => {
        await run(tx);
        committed.push('commit');
      },
    ),
  };
  const ingestion = { ingest: jest.fn().mockResolvedValue(undefined) };
  const identity = { consume: jest.fn().mockResolvedValue(null) };
  const admin = {
    authorize: jest.fn().mockResolvedValue({ status: 'unlinked' }),
    answer: jest
      .fn()
      .mockResolvedValue({ status: 'refused', reason: 'unlinked' }),
  };
  const connections = { findBySessionName: jest.fn().mockResolvedValue(row) };
  const textSender = {
    sendText: jest.fn().mockResolvedValue({ providerMessageId: 'wamid-1' }),
  };
  const service = new WhatsAppEventsService(
    prisma as unknown as PrismaService,
    connections as unknown as WhatsAppConnectionsService,
    ingestion as unknown as WhatsAppIngestionService,
    identity as unknown as WhatsAppIdentityService,
    admin as unknown as WhatsAppAdminService,
    textSender,
  );
  return {
    prisma,
    tx,
    ingestion,
    identity,
    admin,
    connections,
    textSender,
    committed,
    service,
  };
}

const receipt = {
  data: {
    connectionId: 'c1',
    providerEventId: 'evt-1',
    eventType: 'message.any',
  },
};

describe('WhatsAppEventsService', () => {
  it('ignores a session that is not registered, without writing anything', async () => {
    const { prisma, committed, service } = setup(null);
    await expect(
      service.handle('meper-unknown', 'evt-1', 'message.any', payload),
    ).resolves.toEqual({ status: 'unknown_session' });
    expect(prisma.whatsAppProcessedEvent.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(committed).toEqual([]);
  });

  it('resolves the route from the persisted connection, not the session name', async () => {
    const { tx, committed, ingestion, service } = setup(commercialRow);
    tx.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });

    await expect(
      service.handle('meper-commercial-abc', 'evt-1', 'message.any', payload),
    ).resolves.toEqual({ status: 'recorded', route: 'commercial' });
    expect(tx.whatsAppProcessedEvent.create).toHaveBeenCalledWith(receipt);
    expect(committed).toEqual(['commit']);
    expect(ingestion.ingest).toHaveBeenCalledTimes(1);
  });

  it('records the receipt and the ingestion in the same transaction', async () => {
    const { prisma, tx, ingestion, service } = setup(commercialRow);
    tx.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });

    await service.handle(
      'meper-commercial-abc',
      'evt-1',
      'message.any',
      payload,
    );

    // One transaction, one client: the receipt and the record share it and the
    // root client is never written to.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.whatsAppProcessedEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.whatsAppProcessedEvent.create).not.toHaveBeenCalled();
    expect(ingestion.ingest).toHaveBeenCalledWith(tx, commercialRow, {
      providerMessageId: 'evt-1',
      payload,
    });
  });

  it('commits nothing when the ingestion fails, so no receipt survives', async () => {
    const { tx, ingestion, committed, service } = setup(commercialRow);
    tx.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });
    ingestion.ingest.mockRejectedValue(new Error('connection lost'));

    await expect(
      service.handle('meper-commercial-abc', 'evt-1', 'message.any', payload),
    ).rejects.toThrow('connection lost');
    expect(committed).toEqual([]);
  });

  it('reports a duplicate delivery instead of acting twice', async () => {
    const { tx, ingestion, committed, service } = setup(commercialRow);
    tx.whatsAppProcessedEvent.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.handle('meper-commercial-abc', 'evt-1', 'message.any', payload),
    ).resolves.toEqual({ status: 'duplicate', route: 'commercial' });
    // A duplicate event never reaches ingestion.
    expect(ingestion.ingest).not.toHaveBeenCalled();
    expect(committed).toEqual([]);
  });

  it('reports an already stored message as a duplicate delivery', async () => {
    const { tx, ingestion, committed, service } = setup(commercialRow);
    tx.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });
    ingestion.ingest.mockRejectedValue(new DuplicateWhatsAppMessageError());

    await expect(
      service.handle('meper-commercial-abc', 'evt-1', 'message.any', payload),
    ).resolves.toEqual({ status: 'duplicate', route: 'commercial' });
    expect(committed).toEqual([]);
  });

  it('surfaces an unexpected storage failure instead of reporting success', async () => {
    const { tx, service } = setup(commercialRow);
    tx.whatsAppProcessedEvent.create.mockRejectedValue(
      new Error('connection lost'),
    );
    await expect(
      service.handle('meper-commercial-abc', 'evt-4', 'message.any', payload),
    ).rejects.toThrow('connection lost');
  });

  it('routes the central channel to the intelligence handler', async () => {
    const { prisma, ingestion, service } = setup(intelligenceRow);
    prisma.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });

    await expect(
      service.handle('meper-intelligence', 'evt-2', 'message.any', payload),
    ).resolves.toEqual({
      status: 'recorded',
      route: 'intelligence',
      // The sender is unknown here, so the administrative gate ran and refused.
      admin: 'refused',
    });
    expect(prisma.whatsAppProcessedEvent.create).toHaveBeenCalledWith({
      data: {
        connectionId: 'c2',
        providerEventId: 'evt-2',
        eventType: 'message.any',
      },
    });
    // Nothing is ingested on this channel in this stage.
    expect(ingestion.ingest).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('reports a duplicate delivery on the central channel', async () => {
    const { prisma, ingestion, service } = setup(intelligenceRow);
    prisma.whatsAppProcessedEvent.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.handle('meper-intelligence', 'evt-2', 'message.any', payload),
    ).resolves.toEqual({ status: 'duplicate', route: 'intelligence' });
    expect(ingestion.ingest).not.toHaveBeenCalled();
  });

  it('does not store events this stage does not handle', async () => {
    const { prisma, committed, ingestion, service } = setup(commercialRow);
    await expect(
      service.handle(
        'meper-commercial-abc',
        'evt-3',
        'session.status',
        payload,
      ),
    ).resolves.toEqual({ status: 'unsupported_event' });
    expect(prisma.whatsAppProcessedEvent.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(ingestion.ingest).not.toHaveBeenCalled();
    expect(committed).toEqual([]);
  });

  describe('non-conversational chats', () => {
    it.each<[unknown, string]>([
      ['120363000000000000@g.us', 'group'],
      ['status@broadcast', 'unknown'],
      ['@c.us', 'no digits'],
      [undefined, 'missing sender'],
    ])(
      'ignores a %s sender (%s) before any receipt or transaction',
      async (from) => {
        const { prisma, tx, ingestion, committed, service } =
          setup(commercialRow);
        const warn = jest
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation(() => undefined);

        try {
          await expect(
            service.handle('meper-commercial-abc', 'evt-1', 'message.any', {
              ...payload,
              from,
            }),
          ).resolves.toEqual({ status: 'ignored_non_conversational' });

          // The check sits before the receipt, so group traffic stops filling
          // the deduplication table and never reaches ingestion.
          expect(prisma.whatsAppProcessedEvent.create).not.toHaveBeenCalled();
          expect(prisma.$transaction).not.toHaveBeenCalled();
          expect(tx.whatsAppProcessedEvent.create).not.toHaveBeenCalled();
          expect(ingestion.ingest).not.toHaveBeenCalled();
          expect(committed).toEqual([]);

          const logged = warn.mock.calls
            .map((args) => JSON.stringify(args))
            .join(' ');
          expect(logged).toContain('ignored_non_conversational');
          if (typeof from === 'string') expect(logged).not.toContain(from);
        } finally {
          warn.mockRestore();
        }
      },
    );

    it('ignores a group on the central channel as well', async () => {
      const { prisma, ingestion, service } = setup(intelligenceRow);

      await expect(
        service.handle('meper-intelligence', 'evt-2', 'message.any', {
          ...payload,
          from: '120363000000000000@g.us',
        }),
      ).resolves.toEqual({ status: 'ignored_non_conversational' });

      expect(prisma.whatsAppProcessedEvent.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(ingestion.ingest).not.toHaveBeenCalled();
    });

    it('keeps unsupported_event for an event type this stage does not handle', async () => {
      const { prisma, ingestion, service } = setup(commercialRow);

      await expect(
        service.handle('meper-commercial-abc', 'evt-3', 'session.status', {
          ...payload,
          from: '120363000000000000@g.us',
        }),
      ).resolves.toEqual({ status: 'unsupported_event' });
      expect(prisma.whatsAppProcessedEvent.create).not.toHaveBeenCalled();
      expect(ingestion.ingest).not.toHaveBeenCalled();
    });
  });

  describe('administrative identity linking on the central channel', () => {
    it('marks a recorded event as linked when a challenge was consumed', async () => {
      const { prisma, identity, service } = setup(intelligenceRow);
      prisma.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });
      identity.consume.mockResolvedValue({ id: 'identity-1' });

      await expect(
        service.handle('meper-intelligence', 'evt-2', 'message.any', payload),
      ).resolves.toEqual({
        status: 'recorded',
        route: 'intelligence',
        identity: 'linked',
      });
      // The provider JID is reduced to the digits the identity table stores, and
      // the body is what the user typed.
      expect(identity.consume).toHaveBeenCalledWith('573001112233', 'hola');
    });

    it('passes the message body through so the service can hash it', async () => {
      const { prisma, identity, service } = setup(intelligenceRow);
      prisma.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });
      identity.consume.mockResolvedValue({ id: 'identity-1' });

      await service.handle('meper-intelligence', 'evt-2', 'message.any', {
        ...payload,
        body: '  abcdefghjk  ',
      });

      expect(identity.consume).toHaveBeenCalledWith(
        '573001112233',
        'abcdefghjk',
      );
    });

    it('never attempts a link for an outbound message', async () => {
      const { prisma, identity, service } = setup(intelligenceRow);
      prisma.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });

      const result = await service.handle(
        'meper-intelligence',
        'evt-2',
        'message.any',
        { ...payload, fromMe: true },
      );

      expect(result).toEqual({ status: 'recorded', route: 'intelligence' });
      expect(identity.consume).not.toHaveBeenCalled();
    });

    it('never attempts a link for a body that is not text', async () => {
      const { prisma, identity, service } = setup(intelligenceRow);
      prisma.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });

      for (const body of [undefined, 42, null, '   ']) {
        const result = await service.handle(
          'meper-intelligence',
          'evt-2',
          'message.any',
          { ...payload, body },
        );
        expect(result).toEqual({ status: 'recorded', route: 'intelligence' });
      }

      expect(identity.consume).not.toHaveBeenCalled();
    });

    it('never attempts a link for an unparseable sender', async () => {
      const { prisma, identity, service } = setup(intelligenceRow);

      const result = await service.handle(
        'meper-intelligence',
        'evt-2',
        'message.any',
        { ...payload, from: '120363000000000000@g.us' },
      );

      expect(result).toEqual({ status: 'ignored_non_conversational' });
      // Non-conversational chats are rejected before the central receipt too.
      expect(prisma.whatsAppProcessedEvent.create).not.toHaveBeenCalled();
      expect(identity.consume).not.toHaveBeenCalled();
    });

    it('reports no linked marker when the code matches no live challenge', async () => {
      const { prisma, identity, service } = setup(intelligenceRow);
      prisma.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });
      identity.consume.mockResolvedValue(null);

      const result = await service.handle(
        'meper-intelligence',
        'evt-2',
        'message.any',
        payload,
      );

      // No link happened; the text then goes to the administrative gate, which
      // refuses it for this unlinked sender.
      expect(result).toEqual({
        status: 'recorded',
        route: 'intelligence',
        admin: 'refused',
      });
      expect(identity.consume).toHaveBeenCalledTimes(1);
    });

    it('keeps the event recorded when the linker itself fails', async () => {
      const { prisma, identity, service } = setup(intelligenceRow);
      prisma.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });
      identity.consume.mockRejectedValue(new Error('connection lost'));

      // A linking failure must not become a webhook error the provider would
      // redeliver forever, and the receipt is already spent.
      await expect(
        service.handle('meper-intelligence', 'evt-2', 'message.any', payload),
      ).resolves.toEqual({
        status: 'recorded',
        route: 'intelligence',
        admin: 'refused',
      });
      expect(prisma.whatsAppProcessedEvent.create).toHaveBeenCalledTimes(1);
    });

    it('never attempts a link on a duplicate or an unsupported event', async () => {
      const duplicate = setup(intelligenceRow);
      duplicate.prisma.whatsAppProcessedEvent.create.mockRejectedValue({
        code: 'P2002',
      });
      await duplicate.service.handle(
        'meper-intelligence',
        'evt-2',
        'message.any',
        payload,
      );
      expect(duplicate.identity.consume).not.toHaveBeenCalled();

      const unsupported = setup(intelligenceRow);
      await unsupported.service.handle(
        'meper-intelligence',
        'evt-2',
        'session.status',
        payload,
      );
      expect(unsupported.identity.consume).not.toHaveBeenCalled();
    });

    it('never attempts a link on the commercial channel', async () => {
      const { tx, identity, admin, service } = setup(commercialRow);
      tx.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });

      await expect(
        service.handle('meper-commercial-abc', 'evt-1', 'message.any', payload),
      ).resolves.toEqual({ status: 'recorded', route: 'commercial' });
      expect(identity.consume).not.toHaveBeenCalled();
      expect(admin.authorize).not.toHaveBeenCalled();
      expect(admin.answer).not.toHaveBeenCalled();
    });
  });

  describe('the administrative gate on the central channel', () => {
    const authorized = {
      status: 'authorized',
      userId: 'user-1',
      organizationId: 'org-1',
      role: 'ADMIN',
    };

    it('marks the dispatch as answered for an authorized administrator', async () => {
      const { prisma, identity, admin, service } = setup(intelligenceRow);
      prisma.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });
      identity.consume.mockResolvedValue(null);
      admin.authorize.mockResolvedValue(authorized);
      admin.answer.mockResolvedValue({
        status: 'answered',
        tool: 'daily_summary',
        organizationId: 'org-1',
        summary: { salesTotal: '1234.56' },
      });

      await expect(
        service.handle('meper-intelligence', 'evt-2', 'message.any', payload),
      ).resolves.toEqual({
        status: 'recorded',
        route: 'intelligence',
        admin: 'answered',
      });
      // The sender is the reduced JID, and the gate receives the raw text plus
      // what it concluded about the sender: it never sees the payload.
      expect(admin.authorize).toHaveBeenCalledWith('573001112233');
      expect(admin.answer).toHaveBeenCalledWith(authorized, 'hola');
    });

    it('marks the dispatch as refused for an unlinked phone', async () => {
      const { prisma, identity, admin, service } = setup(intelligenceRow);
      prisma.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });
      identity.consume.mockResolvedValue(null);
      admin.authorize.mockResolvedValue({ status: 'unlinked' });
      admin.answer.mockResolvedValue({ status: 'refused', reason: 'unlinked' });

      await expect(
        service.handle('meper-intelligence', 'evt-2', 'message.any', payload),
      ).resolves.toEqual({
        status: 'recorded',
        route: 'intelligence',
        admin: 'refused',
      });
      expect(admin.authorize).toHaveBeenCalledTimes(1);
    });

    it('marks the dispatch as refused when the text is not in the allowlist', async () => {
      const { prisma, identity, admin, service } = setup(intelligenceRow);
      prisma.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });
      identity.consume.mockResolvedValue(null);
      admin.authorize.mockResolvedValue(authorized);
      admin.answer.mockResolvedValue({ status: 'unsupported' });

      await expect(
        service.handle('meper-intelligence', 'evt-2', 'message.any', payload),
      ).resolves.toEqual({
        status: 'recorded',
        route: 'intelligence',
        admin: 'refused',
      });
    });

    it('runs the gate only after a linking attempt failed', async () => {
      const { prisma, identity, admin, service } = setup(intelligenceRow);
      prisma.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });
      identity.consume.mockResolvedValue({
        id: 'identity-1',
        userId: 'user-1',
        organizationId: 'org-1',
      });

      await expect(
        service.handle('meper-intelligence', 'evt-2', 'message.any', payload),
      ).resolves.toEqual({
        status: 'recorded',
        route: 'intelligence',
        identity: 'linked',
      });
      expect(admin.authorize).not.toHaveBeenCalled();
      expect(admin.answer).not.toHaveBeenCalled();
    });

    it('keeps the marker absent for an outbound message', async () => {
      const { prisma, admin, service } = setup(intelligenceRow);
      prisma.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });

      await expect(
        service.handle('meper-intelligence', 'evt-2', 'message.any', {
          ...payload,
          fromMe: true,
        }),
      ).resolves.toEqual({ status: 'recorded', route: 'intelligence' });
      expect(admin.authorize).not.toHaveBeenCalled();
      expect(admin.answer).not.toHaveBeenCalled();
    });

    it('keeps the marker absent for a body that is not text', async () => {
      const { prisma, admin, service } = setup(intelligenceRow);
      prisma.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });

      for (const body of [undefined, 42, null, '   ']) {
        await expect(
          service.handle('meper-intelligence', 'evt-2', 'message.any', {
            ...payload,
            body,
          }),
        ).resolves.toEqual({ status: 'recorded', route: 'intelligence' });
      }
      expect(admin.authorize).not.toHaveBeenCalled();
    });

    it('keeps the marker absent for an unparseable sender', async () => {
      const { prisma, admin, service } = setup(intelligenceRow);

      await expect(
        service.handle('meper-intelligence', 'evt-2', 'message.any', {
          ...payload,
          from: '120363000000000000@g.us',
        }),
      ).resolves.toEqual({ status: 'ignored_non_conversational' });
      expect(prisma.whatsAppProcessedEvent.create).not.toHaveBeenCalled();
      expect(admin.authorize).not.toHaveBeenCalled();
    });

    it('keeps the marker absent for a duplicate or an unsupported event', async () => {
      const duplicate = setup(intelligenceRow);
      duplicate.prisma.whatsAppProcessedEvent.create.mockRejectedValue({
        code: 'P2002',
      });
      await expect(
        duplicate.service.handle(
          'meper-intelligence',
          'evt-2',
          'message.any',
          payload,
        ),
      ).resolves.toEqual({ status: 'duplicate', route: 'intelligence' });
      expect(duplicate.admin.authorize).not.toHaveBeenCalled();

      const unsupported = setup(intelligenceRow);
      await expect(
        unsupported.service.handle(
          'meper-intelligence',
          'evt-2',
          'session.status',
          payload,
        ),
      ).resolves.toEqual({ status: 'unsupported_event' });
      expect(unsupported.admin.authorize).not.toHaveBeenCalled();
    });

    it('answers a gate failure with a refusal so the webhook still succeeds', async () => {
      const { prisma, admin, service } = setup(intelligenceRow);
      prisma.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });
      admin.authorize.mockRejectedValue(new Error('database is down'));
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      try {
        // The receipt is already committed: nothing may turn this into a
        // provider error and nothing may be retried.
        await expect(
          service.handle('meper-intelligence', 'evt-2', 'message.any', payload),
        ).resolves.toEqual({
          status: 'recorded',
          route: 'intelligence',
          admin: 'refused',
        });

        const logged = warn.mock.calls
          .map((args) => JSON.stringify(args))
          .join(' ');
        expect(logged).toContain('gate_error');
        // A refusal that leaks the sender or the text would be an oracle even
        // after the gate itself failed.
        expect(logged).not.toContain('573001112233');
        expect(logged).not.toContain('hola');
        expect(logged).not.toContain('database is down');
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe('deterministic text replies on the central channel', () => {
    const authorized = {
      status: 'authorized',
      userId: 'user-1',
      organizationId: 'org-1',
      role: 'ADMIN',
      phone: '573001112233',
    };
    const summary = {
      reportDate: '2026-03-03',
      cutoff: '2026-03-04T01:00:00.000Z',
      salesTotal: '1234.56',
      expenseTotal: '200.00',
      salesCount: 1,
      lowStockCount: 1,
      pendingPurchaseOrderCount: 1,
      loansDueCount: 1,
    };
    const summaryReply = [
      'Resumen del día 2026-03-03',
      'Ventas: $1.234,56 (1 venta)',
      'Gastos: $200,00',
      'Stock bajo: 1 producto',
      'Compras pendientes: 1 orden',
      'Préstamos por vencer: 1',
    ].join('\n');

    it('sends the rendered answer to the verified sender once', async () => {
      const { prisma, admin, textSender, service } = setup(intelligenceRow);
      prisma.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });
      admin.authorize.mockResolvedValue(authorized);
      admin.answer.mockResolvedValue({
        status: 'answered',
        tool: 'daily_summary',
        organizationId: 'org-1',
        summary,
      });

      await expect(
        service.handle('meper-intelligence', 'evt-2', 'message.any', payload),
      ).resolves.toEqual({
        status: 'recorded',
        route: 'intelligence',
        admin: 'answered',
      });

      expect(textSender.sendText).toHaveBeenCalledTimes(1);
      expect(textSender.sendText).toHaveBeenCalledWith(INTELLIGENCE_SESSION, {
        chatId: '573001112233@c.us',
        text: summaryReply,
      });
    });

    it('derives the destination from the verified sender, never from the body', async () => {
      const { prisma, admin, textSender, service } = setup(intelligenceRow);
      prisma.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });
      admin.authorize.mockResolvedValue(authorized);
      admin.answer.mockResolvedValue({ status: 'unsupported' });

      await service.handle('meper-intelligence', 'evt-2', 'message.any', {
        ...payload,
        body: 'resumen 573009998877',
      });

      expect(textSender.sendText).toHaveBeenCalledTimes(1);
      expect(textSender.sendText.mock.calls[0][1]).toEqual({
        chatId: '573001112233@c.us',
        text: 'No entiendo ese comando. Escribe «resumen» para las cifras del día, «atencion» para las conversaciones o «pdf» para el reporte.',
      });
    });

    it('tells an authorized sender when the figure is unavailable', async () => {
      const { prisma, admin, textSender, service } = setup(intelligenceRow);
      prisma.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });
      admin.authorize.mockResolvedValue(authorized);
      admin.answer.mockResolvedValue({
        status: 'refused',
        reason: 'unavailable',
      });

      await expect(
        service.handle('meper-intelligence', 'evt-2', 'message.any', payload),
      ).resolves.toEqual({
        status: 'recorded',
        route: 'intelligence',
        admin: 'refused',
      });
      expect(textSender.sendText).toHaveBeenCalledWith(INTELLIGENCE_SESSION, {
        chatId: '573001112233@c.us',
        text: 'No pude obtener la información en este momento. Intenta de nuevo en unos minutos.',
      });
    });

    it('never messages an unlinked or forbidden number', async () => {
      for (const refused of [
        {
          context: { status: 'unlinked' },
          answer: { status: 'refused', reason: 'unlinked' },
        },
        {
          context: { status: 'forbidden' },
          answer: { status: 'refused', reason: 'forbidden' },
        },
      ]) {
        const { prisma, admin, textSender, service } = setup(intelligenceRow);
        prisma.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });
        admin.authorize.mockResolvedValue(refused.context);
        admin.answer.mockResolvedValue(refused.answer);

        await expect(
          service.handle('meper-intelligence', 'evt-2', 'message.any', payload),
        ).resolves.toEqual({
          status: 'recorded',
          route: 'intelligence',
          admin: 'refused',
        });
        expect(textSender.sendText).not.toHaveBeenCalled();
      }
    });

    it('never answers its own outbound message, so no loop can start', async () => {
      const { prisma, admin, textSender, service } = setup(intelligenceRow);
      prisma.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });

      await expect(
        service.handle('meper-intelligence', 'evt-2', 'message.any', {
          ...payload,
          fromMe: true,
          body: 'resumen',
        }),
      ).resolves.toEqual({ status: 'recorded', route: 'intelligence' });
      expect(admin.authorize).not.toHaveBeenCalled();
      expect(textSender.sendText).not.toHaveBeenCalled();
    });

    it('never answers a non-text body', async () => {
      const { prisma, textSender, service } = setup(intelligenceRow);
      prisma.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });

      for (const body of [undefined, 42, null, '   ']) {
        await service.handle('meper-intelligence', 'evt-2', 'message.any', {
          ...payload,
          body,
        });
      }
      expect(textSender.sendText).not.toHaveBeenCalled();
    });

    it('sends once on the first delivery and nothing on a redelivery', async () => {
      const { prisma, admin, textSender, service } = setup(intelligenceRow);
      prisma.whatsAppProcessedEvent.create
        .mockResolvedValueOnce({ id: 'p1' })
        .mockRejectedValueOnce({ code: 'P2002' });
      admin.authorize.mockResolvedValue(authorized);
      admin.answer.mockResolvedValue({ status: 'unsupported' });

      await service.handle(
        'meper-intelligence',
        'evt-2',
        'message.any',
        payload,
      );
      await expect(
        service.handle('meper-intelligence', 'evt-2', 'message.any', payload),
      ).resolves.toEqual({ status: 'duplicate', route: 'intelligence' });

      expect(textSender.sendText).toHaveBeenCalledTimes(1);
    });

    it('keeps the PDF as its own flow and sends no text for it', async () => {
      const { prisma, admin, textSender, service } = setup(intelligenceRow);
      prisma.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });
      admin.authorize.mockResolvedValue(authorized);
      admin.answer.mockResolvedValue({
        status: 'delivered',
        tool: 'daily_report_pdf',
        organizationId: 'org-1',
        delivery: 'sent',
      });

      await service.handle('meper-intelligence', 'evt-2', 'message.any', {
        ...payload,
        body: 'pdf',
      });
      expect(textSender.sendText).not.toHaveBeenCalled();
    });

    it('never sends a reply when a linking code was just consumed', async () => {
      const { prisma, identity, textSender, service } = setup(intelligenceRow);
      prisma.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });
      identity.consume.mockResolvedValue({ id: 'identity-1' });

      await expect(
        service.handle('meper-intelligence', 'evt-2', 'message.any', payload),
      ).resolves.toEqual({
        status: 'recorded',
        route: 'intelligence',
        identity: 'linked',
      });
      expect(textSender.sendText).not.toHaveBeenCalled();
    });

    it('keeps commercial traffic unchanged and never sends text on it', async () => {
      const { tx, ingestion, admin, textSender, service } =
        setup(commercialRow);
      tx.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });

      await expect(
        service.handle('meper-commercial-abc', 'evt-1', 'message.any', payload),
      ).resolves.toEqual({ status: 'recorded', route: 'commercial' });
      expect(ingestion.ingest).toHaveBeenCalledTimes(1);
      expect(admin.authorize).not.toHaveBeenCalled();
      expect(textSender.sendText).not.toHaveBeenCalled();
    });

    it('survives a failed send without retrying or exposing the exchange', async () => {
      const { prisma, admin, textSender, service } = setup(intelligenceRow);
      prisma.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });
      admin.authorize.mockResolvedValue(authorized);
      admin.answer.mockResolvedValue({ status: 'unsupported' });
      textSender.sendText.mockRejectedValue(
        new Error('provider secret 573001112233 hola 1234.56'),
      );
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      try {
        // The receipt is already committed, so a transport failure is reported
        // and never retried: one attempt, at most once, never a webhook error.
        await expect(
          service.handle('meper-intelligence', 'evt-2', 'message.any', payload),
        ).resolves.toEqual({
          status: 'recorded',
          route: 'intelligence',
          admin: 'refused',
        });
        expect(textSender.sendText).toHaveBeenCalledTimes(1);

        const logged = warn.mock.calls
          .map((args) => JSON.stringify(args))
          .join(' ');
        expect(logged).toContain('reply_failed');
        expect(logged).not.toContain('573001112233');
        expect(logged).not.toContain('hola');
        expect(logged).not.toContain('1234.56');
        expect(logged).not.toContain('provider secret');
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe('the central path from an inbound message to a text reply', () => {
    const report = {
      date: '2026-03-03',
      cutoff: new Date('2026-03-04T01:00:00.000Z'),
      salesTotal: '1234.56',
      expenseTotal: '200.00',
      sales: [{ id: 'sale-1' }],
      expenses: [],
      lowStock: [],
      purchaseOrders: [],
      loans: [],
    };

    // The one code the fake challenge table accepts. Anything else, including a
    // command body, finds no live challenge and takes the ordinary gate path.
    const CHALLENGE_CODE = 'ABCDEFGHJK';

    function pipeline(options: {
      identity?: Record<string, unknown> | null;
      membership?: Record<string, unknown> | null;
      linkable?: boolean;
    }) {
      // The link claim finds no live challenge unless `linkable` is set, so every
      // message below takes the ordinary gate path instead of redeeming a code.
      const tx = {
        whatsAppLinkChallenge: {
          updateMany: jest.fn(async (args: { where: { codeHash: string } }) =>
            options.linkable === true &&
            args.where.codeHash === hashLinkCode(CHALLENGE_CODE)
              ? { count: 1 }
              : { count: 0 },
          ),
          findUnique: jest.fn().mockResolvedValue({
            userId: 'user-1',
            organizationId: 'org-1',
          }),
        },
        whatsAppIdentity: {
          upsert: jest.fn().mockResolvedValue({ id: 'identity-1' }),
        },
      };
      const prisma = {
        whatsAppProcessedEvent: {
          create: jest.fn().mockResolvedValue({ id: 'p1' }),
        },
        whatsAppIdentity: {
          findFirst: jest.fn(() => {
            const identity = options.identity ?? null;
            return identity && identity.status === 'VERIFIED' ? identity : null;
          }),
        },
        organizationUser: {
          findFirst: jest.fn().mockResolvedValue(options.membership ?? null),
        },
        $transaction: jest.fn(
          async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
        ),
      };
      const connections = {
        findBySessionName: jest.fn().mockResolvedValue(intelligenceRow),
      };
      const ingestion = { ingest: jest.fn() };
      const identity = new WhatsAppIdentityService(
        prisma as unknown as PrismaService,
      );
      const reports = { generate: jest.fn().mockResolvedValue(report) };
      const delivery = { onDemand: jest.fn() };
      const supervision = { summary: jest.fn() };
      const admin = new WhatsAppAdminService(
        prisma as unknown as PrismaService,
        identity,
        reports as unknown as DailyReportService,
        delivery as unknown as WhatsAppDeliveryService,
        supervision as unknown as WhatsAppSupervisionService,
      );
      const textSender = {
        sendText: jest.fn().mockResolvedValue({ providerMessageId: 'wamid-1' }),
      };
      const service = new WhatsAppEventsService(
        prisma as unknown as PrismaService,
        connections as unknown as WhatsAppConnectionsService,
        ingestion as unknown as WhatsAppIngestionService,
        identity,
        admin,
        textSender,
      );
      return {
        prisma,
        tx,
        reports,
        delivery,
        supervision,
        textSender,
        service,
      };
    }

    const identity = {
      id: 'identity-1',
      phone: '573001112233',
      userId: 'user-1',
      organizationId: 'org-1',
      status: 'VERIFIED',
    };
    const adminMembership = {
      userId: 'user-1',
      organizationId: 'org-1',
      role: 'ADMIN',
    };

    it('answers an authorized administrator after identity and role checks', async () => {
      const { prisma, reports, delivery, textSender, service } = pipeline({
        identity,
        membership: adminMembership,
      });

      await expect(
        service.handle('meper-intelligence', 'evt-e2e', 'message.any', {
          from: '573001112233@c.us',
          fromMe: false,
          source: 'app',
          body: 'Resumen',
          timestamp: 1_700_000_000,
        }),
      ).resolves.toEqual({
        status: 'recorded',
        route: 'intelligence',
        admin: 'answered',
      });

      expect(reports.generate).toHaveBeenCalledWith('org-1');
      expect(delivery.onDemand).not.toHaveBeenCalled();
      expect(textSender.sendText).toHaveBeenCalledTimes(1);
      expect(textSender.sendText).toHaveBeenCalledWith(INTELLIGENCE_SESSION, {
        chatId: '573001112233@c.us',
        text: [
          'Resumen del día 2026-03-03',
          'Ventas: $1.234,56 (1 venta)',
          'Gastos: $200,00',
          'Stock bajo: 0 productos',
          'Compras pendientes: 0 órdenes',
          'Préstamos por vencer: 0',
        ].join('\n'),
      });
      // The receipt was committed before the reply, which is what makes the
      // provider redelivery a duplicate rather than a second message.
      expect(prisma.whatsAppProcessedEvent.create).toHaveBeenCalledTimes(1);
    });

    it('gives a verified non-administrator no figures and no message', async () => {
      const { reports, textSender, service } = pipeline({
        identity,
        membership: { ...adminMembership, role: 'CASHIER' },
      });

      await expect(
        service.handle('meper-intelligence', 'evt-e2e', 'message.any', {
          ...payload,
          body: 'resumen',
        }),
      ).resolves.toEqual({
        status: 'recorded',
        route: 'intelligence',
        admin: 'refused',
      });
      expect(reports.generate).not.toHaveBeenCalled();
      expect(textSender.sendText).not.toHaveBeenCalled();
    });

    it('gives an unlinked number no message that could confirm it exists', async () => {
      const { reports, textSender, service } = pipeline({});

      await expect(
        service.handle('meper-intelligence', 'evt-e2e', 'message.any', {
          ...payload,
          body: 'resumen',
        }),
      ).resolves.toEqual({
        status: 'recorded',
        route: 'intelligence',
        admin: 'refused',
      });
      expect(reports.generate).not.toHaveBeenCalled();
      expect(textSender.sendText).not.toHaveBeenCalled();
    });

    it.each([
      ['573001112233@c.us', '573001112233@c.us'],
      ['573001112233@s.whatsapp.net', '573001112233@c.us'],
      ['573001112233', '573001112233@c.us'],
    ])(
      'still answers a verified administrator who writes from %s',
      async (from, chatId) => {
        const { reports, delivery, textSender, service } = pipeline({
          identity,
          membership: adminMembership,
        });

        await expect(
          service.handle('meper-intelligence', 'evt-e2e', 'message.any', {
            ...payload,
            from,
            body: 'Resumen',
          }),
        ).resolves.toEqual({
          status: 'recorded',
          route: 'intelligence',
          admin: 'answered',
        });

        expect(reports.generate).toHaveBeenCalledWith('org-1');
        expect(delivery.onDemand).not.toHaveBeenCalled();
        expect(textSender.sendText).toHaveBeenCalledTimes(1);
        expect(textSender.sendText).toHaveBeenCalledWith(INTELLIGENCE_SESSION, {
          chatId,
          text: [
            'Resumen del día 2026-03-03',
            'Ventas: $1.234,56 (1 venta)',
            'Gastos: $200,00',
            'Stock bajo: 0 productos',
            'Compras pendientes: 0 órdenes',
            'Préstamos por vencer: 0',
          ].join('\n'),
        });
      },
    );

    it('still links a phone sender that redeems a live challenge', async () => {
      const { tx, textSender, service } = pipeline({
        identity,
        membership: adminMembership,
        linkable: true,
      });

      await expect(
        service.handle('meper-intelligence', 'evt-e2e', 'message.any', {
          ...payload,
          from: '573001112233@c.us',
          body: CHALLENGE_CODE,
        }),
      ).resolves.toEqual({
        status: 'recorded',
        route: 'intelligence',
        identity: 'linked',
      });

      // A real number is still bound to the challenge's authenticated owner and
      // redeeming a code still sends nothing back.
      expect(tx.whatsAppIdentity.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { phone: '573001112233' },
          create: expect.objectContaining({
            phone: '573001112233',
            userId: 'user-1',
            organizationId: 'org-1',
            status: 'VERIFIED',
          }),
        }),
      );
      expect(textSender.sendText).not.toHaveBeenCalled();
    });

    // WAHA reports a privacy identifier (`@lid`) for some chats. Its digits are
    // opaque, and the ones below are exactly an authenticated administrator's
    // verified phone: the collision this boundary has to refuse.
    const opaqueFrom = '573001112233@lid';

    it.each([
      ['a link code', CHALLENGE_CODE],
      ['a summary query', 'resumen'],
      ['a PDF command', 'pdf'],
      ['an unsupported command', 'hola'],
    ])(
      'refuses %s from an opaque LID that collides with the administrator phone',
      async (_label, body) => {
        const {
          prisma,
          tx,
          reports,
          delivery,
          supervision,
          textSender,
          service,
        } = pipeline({ identity, membership: adminMembership, linkable: true });
        const warn = jest
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation(() => undefined);

        try {
          await expect(
            service.handle('meper-intelligence', 'evt-lid', 'message.any', {
              ...payload,
              from: opaqueFrom,
              body,
            }),
          ).resolves.toEqual({ status: 'ignored_unverified_sender' });

          // A sender this channel can never identify is refused before the
          // receipt, so it does not even fill the deduplication table.
          expect(prisma.whatsAppProcessedEvent.create).not.toHaveBeenCalled();
          expect(prisma.$transaction).not.toHaveBeenCalled();

          // No link: neither the challenge nor the identity row is touched.
          expect(tx.whatsAppLinkChallenge.updateMany).not.toHaveBeenCalled();
          expect(tx.whatsAppLinkChallenge.findUnique).not.toHaveBeenCalled();
          expect(tx.whatsAppIdentity.upsert).not.toHaveBeenCalled();

          // No query: identity, role, report, supervision and delivery are
          // never consulted, so no figure and no document can be produced.
          expect(prisma.whatsAppIdentity.findFirst).not.toHaveBeenCalled();
          expect(prisma.organizationUser.findFirst).not.toHaveBeenCalled();
          expect(reports.generate).not.toHaveBeenCalled();
          expect(supervision.summary).not.toHaveBeenCalled();
          expect(delivery.onDemand).not.toHaveBeenCalled();

          // No reply of any kind, text or document.
          expect(textSender.sendText).not.toHaveBeenCalled();

          const logged = warn.mock.calls
            .map((args) => JSON.stringify(args))
            .join(' ');
          expect(logged).toContain('unverified_sender');
          expect(logged).not.toContain('573001112233');
          expect(logged).not.toContain(opaqueFrom);
          expect(logged).not.toContain(body);
        } finally {
          warn.mockRestore();
        }
      },
    );

    it('refuses a LID for an identity that was never linked', async () => {
      const { prisma, tx, textSender, service } = pipeline({ linkable: true });

      await expect(
        service.handle('meper-intelligence', 'evt-lid', 'message.any', {
          ...payload,
          from: '145805600096353@lid',
          body: 'resumen',
        }),
      ).resolves.toEqual({ status: 'ignored_unverified_sender' });

      expect(prisma.whatsAppProcessedEvent.create).not.toHaveBeenCalled();
      expect(tx.whatsAppIdentity.upsert).not.toHaveBeenCalled();
      expect(prisma.whatsAppIdentity.findFirst).not.toHaveBeenCalled();
      expect(textSender.sendText).not.toHaveBeenCalled();
    });

    it('keeps commercial ingestion of an opaque LID unchanged', async () => {
      const { tx, ingestion, identity, admin, textSender, service } =
        setup(commercialRow);
      tx.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });
      const commercialLid = { ...payload, from: opaqueFrom, body: 'hola' };

      await expect(
        service.handle(
          'meper-commercial-abc',
          'evt-1',
          'message.any',
          commercialLid,
        ),
      ).resolves.toEqual({ status: 'recorded', route: 'commercial' });

      // The commercial channel still stores the opaque identifier as its own
      // conversation key, and it never links, queries or answers.
      expect(ingestion.ingest).toHaveBeenCalledWith(tx, commercialRow, {
        providerMessageId: 'evt-1',
        payload: commercialLid,
      });
      expect(identity.consume).not.toHaveBeenCalled();
      expect(admin.authorize).not.toHaveBeenCalled();
      expect(admin.answer).not.toHaveBeenCalled();
      expect(textSender.sendText).not.toHaveBeenCalled();
    });
  });
});
