import { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { WhatsAppAdminService } from './whatsapp-admin.service';
import type { WhatsAppConnectionsService } from './whatsapp-connections.service';
import { WhatsAppEventsService } from './whatsapp-events.service';
import type { WhatsAppIdentityService } from './whatsapp-identity.service';
import {
  DuplicateWhatsAppMessageError,
  type WhatsAppEventPayload,
  type WhatsAppIngestionService,
} from './whatsapp-ingestion.service';

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
  const service = new WhatsAppEventsService(
    prisma as unknown as PrismaService,
    connections as unknown as WhatsAppConnectionsService,
    ingestion as unknown as WhatsAppIngestionService,
    identity as unknown as WhatsAppIdentityService,
    admin as unknown as WhatsAppAdminService,
  );
  return {
    prisma,
    tx,
    ingestion,
    identity,
    admin,
    connections,
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
});
