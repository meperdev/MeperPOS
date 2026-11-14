import { ForbiddenException } from '@nestjs/common';
import {
  commercialSessionName,
  INTELLIGENCE_SESSION,
  WhatsAppConnectionsService,
} from './whatsapp-connections.service';
import type { WhatsAppProvider } from './whatsapp-provider';
import type { PrismaService } from '../prisma/prisma.service';
import { WhatsAppSessionService } from './whatsapp-session.service';
import { deriveWebhookKey } from './waha-signature';

const MASTER = 'master-webhook-key';

function fakeProvider(): WhatsAppProvider {
  return {
    ensureStarted: jest.fn().mockResolvedValue(undefined),
    start: jest.fn(),
    stop: jest.fn().mockResolvedValue(undefined),
    restart: jest.fn().mockResolvedValue(undefined),
    logout: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn(),
    status: jest.fn().mockResolvedValue({ status: 'WORKING' }),
    qr: jest.fn().mockResolvedValue({ data: 'png' }),
    me: jest.fn().mockResolvedValue({ accountId: '57300@c.us' }),
  };
}

function fakeConnections() {
  return {
    getOrCreateCommercial: jest
      .fn()
      .mockImplementation((organizationId: string) =>
        Promise.resolve({ id: `row-${organizationId}` }),
      ),
    getOrCreateIntelligence: jest.fn().mockResolvedValue({ id: 'central-row' }),
    recordStatus: jest.fn().mockResolvedValue({ id: 'row' }),
  };
}

/** Models the one column that must survive a transient status. */
function statefulConnections(accountId: string | null) {
  const state = { accountId };
  return {
    state,
    getOrCreateCommercial: jest
      .fn()
      .mockImplementation((organizationId: string) =>
        Promise.resolve({ id: `row-${organizationId}` }),
      ),
    getOrCreateIntelligence: jest.fn().mockResolvedValue({ id: 'central-row' }),
    recordStatus: jest
      .fn()
      .mockImplementation(
        (
          _id: string,
          _status: string,
          nextAccountId: string | null | undefined,
        ) => {
          // `undefined` is Prisma's "leave the column alone".
          if (nextAccountId !== undefined) state.accountId = nextAccountId;
          return Promise.resolve({ id: 'row' });
        },
      ),
  };
}

function build(
  masterKey: string | undefined,
  provider = fakeProvider(),
  connections = fakeConnections(),
) {
  const service = new WhatsAppSessionService(
    provider,
    connections as unknown as WhatsAppConnectionsService,
    masterKey,
  );
  return { service, provider, connections };
}

const commercial = (organizationId: string | undefined) =>
  ({ channel: 'COMMERCIAL', organizationId }) as const;

describe('WhatsAppSessionService', () => {
  it('drives the commercial session derived from the organization, never a supplied name', async () => {
    const { service, provider, connections } = build(MASTER);

    await service.connect(commercial('org-a'));

    const session = commercialSessionName('org-a');
    expect(session).toMatch(/^meper-commercial-[0-9a-f]{32}$/);
    expect(connections.getOrCreateCommercial).toHaveBeenCalledWith('org-a');
    expect(provider.ensureStarted).toHaveBeenCalledWith(
      session,
      deriveWebhookKey(MASTER, session),
    );
    expect(provider.ensureStarted).toHaveBeenCalledTimes(1);
    const [, webhookKey] = (provider.ensureStarted as jest.Mock).mock
      .calls[0] as [string, string];
    expect(webhookKey).not.toBe(MASTER);
    expect(webhookKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives each organization its own session and its own webhook key', async () => {
    const { service, provider } = build(MASTER);

    await service.qr(commercial('org-a'));
    await service.qr(commercial('org-b'));

    const [a, b] = (provider.qr as jest.Mock).mock.calls as [string][];
    expect(a[0]).toBe(commercialSessionName('org-a'));
    expect(b[0]).toBe(commercialSessionName('org-b'));
    expect(a[0]).not.toBe(b[0]);
    expect(deriveWebhookKey(MASTER, a[0])).not.toBe(
      deriveWebhookKey(MASTER, b[0]),
    );
  });

  it('drives the single central intelligence session without an organization', async () => {
    const { service, provider, connections } = build(MASTER);

    await service.connect({ channel: 'INTELLIGENCE' });

    expect(connections.getOrCreateIntelligence).toHaveBeenCalledTimes(1);
    expect(connections.getOrCreateCommercial).not.toHaveBeenCalled();
    expect(provider.ensureStarted).toHaveBeenCalledWith(
      INTELLIGENCE_SESSION,
      deriveWebhookKey(MASTER, INTELLIGENCE_SESSION),
    );
  });

  it('mirrors the provider status and linked account onto the resolved row', async () => {
    const { service, provider, connections } = build(MASTER);

    await expect(service.status(commercial('org-a'))).resolves.toEqual({
      status: 'WORKING',
    });

    expect(provider.status).toHaveBeenCalledWith(
      commercialSessionName('org-a'),
    );
    expect(connections.recordStatus).toHaveBeenCalledWith(
      'row-org-a',
      'WORKING',
      '57300@c.us',
    );
  });

  it('keeps the last known account when the session moves to a transient state', async () => {
    for (const status of [
      'STARTING',
      'SCAN_QR_CODE',
      'PASSKEY_REQUIRED',
      'PASSKEY_CONFIRMATION_REQUIRED',
      'STOPPED',
      'FAILED',
    ] as const) {
      const provider = fakeProvider();
      (provider.status as jest.Mock).mockResolvedValue({ status });
      const connections = statefulConnections('57300@c.us');
      const { service } = build(MASTER, provider, connections);

      await service.status(commercial('org-a'));

      // No identity read while the session is not healthy, and no clearing.
      expect(provider.me).not.toHaveBeenCalled();
      expect(connections.state.accountId).toBe('57300@c.us');
      expect(connections.recordStatus).toHaveBeenCalledWith(
        'row-org-a',
        status,
        undefined,
      );
    }
  });

  it('keeps accountId across WORKING -> STOPPED', async () => {
    const provider = fakeProvider();
    const connections = statefulConnections(null);
    const { service } = build(MASTER, provider, connections);

    await service.status(commercial('org-a'));
    expect(connections.state.accountId).toBe('57300@c.us');

    (provider.status as jest.Mock).mockResolvedValue({ status: 'STOPPED' });
    await service.status(commercial('org-a'));

    expect(connections.state.accountId).toBe('57300@c.us');
  });

  it('clears the linked account only when a healthy session reports no identity', async () => {
    const provider = fakeProvider();
    (provider.me as jest.Mock).mockResolvedValue({ accountId: null });
    const connections = statefulConnections('57300@c.us');
    const { service } = build(MASTER, provider, connections);

    await service.status(commercial('org-a'));

    expect(provider.me).toHaveBeenCalledWith(commercialSessionName('org-a'));
    expect(connections.state.accountId).toBeNull();
  });

  it('records the observed state after every lifecycle command', async () => {
    const { service, provider, connections } = build(MASTER);

    await service.connect(commercial('org-a'));
    await service.stop(commercial('org-a'));
    await service.restart(commercial('org-a'));

    expect(provider.stop).toHaveBeenCalledWith(commercialSessionName('org-a'));
    expect(provider.restart).toHaveBeenCalledWith(
      commercialSessionName('org-a'),
    );
    expect(connections.getOrCreateCommercial).toHaveBeenCalledTimes(3);
    expect(provider.status).toHaveBeenCalledTimes(3);
    expect(connections.recordStatus).toHaveBeenCalledTimes(3);
  });

  it('logs out only the central channel, which is the only one it may unlink', async () => {
    const { service, provider, connections } = build(MASTER);

    await service.logout();

    expect(provider.logout).toHaveBeenCalledWith(INTELLIGENCE_SESSION);
    expect(connections.getOrCreateIntelligence).toHaveBeenCalledTimes(1);
    expect(connections.getOrCreateCommercial).not.toHaveBeenCalled();
  });

  it('rejects a commercial call that carries no organization', async () => {
    const { service, provider, connections } = build(MASTER);

    await expect(service.qr(commercial(undefined))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.connect(commercial(''))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(provider.qr).not.toHaveBeenCalled();
    expect(provider.ensureStarted).not.toHaveBeenCalled();
    expect(connections.getOrCreateCommercial).not.toHaveBeenCalled();
  });

  it('fails closed without the master secret on every operation', async () => {
    const { service, provider, connections } = build(undefined);

    await expect(service.connect(commercial('org-a'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.status({ channel: 'INTELLIGENCE' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.qr(commercial('org-a'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.stop(commercial('org-a'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.restart({ channel: 'INTELLIGENCE' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.logout()).rejects.toBeInstanceOf(ForbiddenException);

    expect(connections.getOrCreateCommercial).not.toHaveBeenCalled();
    expect(connections.getOrCreateIntelligence).not.toHaveBeenCalled();
    expect(connections.recordStatus).not.toHaveBeenCalled();
    expect(provider.ensureStarted).not.toHaveBeenCalled();
    expect(provider.start).not.toHaveBeenCalled();
    expect(provider.stop).not.toHaveBeenCalled();
    expect(provider.restart).not.toHaveBeenCalled();
    expect(provider.logout).not.toHaveBeenCalled();
  });

  it('does not fail a mirror when the linked identity cannot be read', async () => {
    const provider = fakeProvider();
    (provider.me as jest.Mock).mockRejectedValue(new Error('unavailable'));
    const connections = statefulConnections('57300@c.us');
    const { service } = build(MASTER, provider, connections);

    await expect(service.status(commercial('org-a'))).resolves.toEqual({
      status: 'WORKING',
    });
    expect(connections.recordStatus).toHaveBeenCalledWith(
      'row-org-a',
      'WORKING',
      undefined,
    );
    // An unreadable identity preserves the last known value instead of clearing it.
    expect(connections.state.accountId).toBe('57300@c.us');
  });
});

describe('WhatsAppSessionService persistence boundary', () => {
  it('writes the connection registry through the connections service, not Prisma', async () => {
    const prisma = {
      whatsAppConnection: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
    };
    prisma.whatsAppConnection.upsert.mockResolvedValue({ id: 'row-org-a' });
    const connections = new WhatsAppConnectionsService(
      prisma as unknown as PrismaService,
    );
    const provider = fakeProvider();
    const service = new WhatsAppSessionService(provider, connections, MASTER);

    await service.status(commercial('org-a'));

    expect(prisma.whatsAppConnection.upsert).toHaveBeenCalledWith({
      where: { sessionName: commercialSessionName('org-a') },
      create: {
        sessionName: commercialSessionName('org-a'),
        channel: 'COMMERCIAL',
        organizationId: 'org-a',
      },
      update: {},
    });
    expect(prisma.whatsAppConnection.update).toHaveBeenCalledWith({
      where: { id: 'row-org-a' },
      data: {
        status: 'WORKING',
        statusUpdatedAt: expect.any(Date),
        accountId: '57300@c.us',
      },
    });
  });
});
