import {
  commercialSessionName,
  INTELLIGENCE_SESSION,
  WhatsAppConnectionsService,
} from './whatsapp-connections.service';
import type { PrismaService } from '../prisma/prisma.service';

function fakePrisma() {
  return {
    whatsAppConnection: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
  };
}

describe('WhatsAppConnectionsService', () => {
  it('derives one stable commercial session name per organization', () => {
    const name = commercialSessionName('org-a');
    expect(name).toBe(commercialSessionName('org-a'));
    expect(name).toMatch(/^meper-commercial-[0-9a-f]{32}$/);
    expect(name).not.toBe(commercialSessionName('org-b'));
    expect(name).not.toContain('org-a');
    expect(INTELLIGENCE_SESSION).toBe('meper-intelligence');
  });

  it('creates the commercial connection for its organization and nothing else', async () => {
    const prisma = fakePrisma();
    prisma.whatsAppConnection.upsert.mockResolvedValue({ id: 'c1' });
    const service = new WhatsAppConnectionsService(
      prisma as unknown as PrismaService,
    );

    await service.getOrCreateCommercial('org-a');

    expect(prisma.whatsAppConnection.upsert).toHaveBeenCalledWith({
      where: { sessionName: commercialSessionName('org-a') },
      create: {
        sessionName: commercialSessionName('org-a'),
        channel: 'COMMERCIAL',
        organizationId: 'org-a',
      },
      update: {},
    });
  });

  it('keeps exactly one central intelligence connection and survives a race', async () => {
    const prisma = fakePrisma();
    prisma.whatsAppConnection.findFirst.mockResolvedValueOnce(null);
    prisma.whatsAppConnection.create.mockRejectedValueOnce({ code: 'P2002' });
    prisma.whatsAppConnection.findFirst.mockResolvedValueOnce({
      id: 'central',
    });
    const service = new WhatsAppConnectionsService(
      prisma as unknown as PrismaService,
    );

    await expect(service.getOrCreateIntelligence()).resolves.toEqual({
      id: 'central',
    });
    expect(prisma.whatsAppConnection.create).toHaveBeenCalledWith({
      data: {
        sessionName: INTELLIGENCE_SESSION,
        channel: 'INTELLIGENCE',
      },
    });
  });

  it('mirrors provider status only on the connection that reported it', async () => {
    const prisma = fakePrisma();
    prisma.whatsAppConnection.update.mockResolvedValue({ id: 'c1' });
    const service = new WhatsAppConnectionsService(
      prisma as unknown as PrismaService,
    );

    await service.recordStatus('c1', 'WORKING', '111@c.us');

    expect(prisma.whatsAppConnection.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: {
        status: 'WORKING',
        statusUpdatedAt: expect.any(Date) as Date,
        accountId: '111@c.us',
      },
    });
  });
});
