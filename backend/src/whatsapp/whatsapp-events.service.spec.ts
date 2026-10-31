import type { PrismaService } from '../prisma/prisma.service';
import type { WhatsAppConnectionsService } from './whatsapp-connections.service';
import { WhatsAppEventsService } from './whatsapp-events.service';

const commercialRow = { id: 'c1', channel: 'COMMERCIAL' };
const intelligenceRow = { id: 'c2', channel: 'INTELLIGENCE' };

function setup(row: unknown) {
  const prisma = { whatsAppProcessedEvent: { create: jest.fn() } };
  const connections = { findBySessionName: jest.fn().mockResolvedValue(row) };
  const service = new WhatsAppEventsService(
    prisma as unknown as PrismaService,
    connections as unknown as WhatsAppConnectionsService,
  );
  return { prisma, connections, service };
}

describe('WhatsAppEventsService', () => {
  it('ignores a session that is not registered, without writing anything', async () => {
    const { prisma, service } = setup(null);
    await expect(
      service.handle('meper-unknown', 'evt-1', 'message.any'),
    ).resolves.toEqual({ status: 'unknown_session' });
    expect(prisma.whatsAppProcessedEvent.create).not.toHaveBeenCalled();
  });

  it('resolves the route from the persisted connection, not the session name', async () => {
    const { prisma, service } = setup(commercialRow);
    prisma.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });

    await expect(
      service.handle('meper-commercial-abc', 'evt-1', 'message.any'),
    ).resolves.toEqual({ status: 'recorded', route: 'commercial' });
    expect(prisma.whatsAppProcessedEvent.create).toHaveBeenCalledWith({
      data: {
        connectionId: 'c1',
        providerEventId: 'evt-1',
        eventType: 'message.any',
      },
    });
  });

  it('routes the central channel to the intelligence handler', async () => {
    const { prisma, service } = setup(intelligenceRow);
    prisma.whatsAppProcessedEvent.create.mockResolvedValue({ id: 'p1' });

    await expect(
      service.handle('meper-intelligence', 'evt-2', 'message.any'),
    ).resolves.toEqual({ status: 'recorded', route: 'intelligence' });
  });

  it('reports a duplicate delivery instead of acting twice', async () => {
    const { prisma, service } = setup(intelligenceRow);
    prisma.whatsAppProcessedEvent.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.handle('meper-intelligence', 'evt-2', 'message.any'),
    ).resolves.toEqual({ status: 'duplicate', route: 'intelligence' });
  });

  it('does not store events this stage does not handle', async () => {
    const { prisma, service } = setup(commercialRow);
    await expect(
      service.handle('meper-commercial-abc', 'evt-3', 'session.status'),
    ).resolves.toEqual({ status: 'unsupported_event' });
    expect(prisma.whatsAppProcessedEvent.create).not.toHaveBeenCalled();
  });

  it('surfaces an unexpected storage failure instead of reporting success', async () => {
    const { prisma, service } = setup(commercialRow);
    prisma.whatsAppProcessedEvent.create.mockRejectedValue(
      new Error('connection lost'),
    );
    await expect(
      service.handle('meper-commercial-abc', 'evt-4', 'message.any'),
    ).rejects.toThrow('connection lost');
  });
});
