import type { PrismaService } from '../prisma/prisma.service';
import type { WhatsAppConnectionsService } from './whatsapp-connections.service';
import { WhatsAppEventsService } from './whatsapp-events.service';
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
  const connections = { findBySessionName: jest.fn().mockResolvedValue(row) };
  const service = new WhatsAppEventsService(
    prisma as unknown as PrismaService,
    connections as unknown as WhatsAppConnectionsService,
    ingestion as unknown as WhatsAppIngestionService,
  );
  return { prisma, tx, ingestion, connections, committed, service };
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
    ).resolves.toEqual({ status: 'recorded', route: 'intelligence' });
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
});
