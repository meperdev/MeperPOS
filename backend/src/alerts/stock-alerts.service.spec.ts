import { ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { WhatsAppConnectionsService } from '../whatsapp/whatsapp-connections.service';
import type { WhatsAppTextSender } from '../whatsapp/whatsapp-provider';
import { StockAlertsService } from './stock-alerts.service';

const MIN_STOCK_FIELD = { name: 'minStock' };

type AlertRow = {
  id: string;
  organizationId: string;
  productId: string;
  state: 'OPEN' | 'RESOLVED';
  episode: number;
  stockAtOpen: number;
  minStockAtOpen: number;
  openedAt: Date;
  resolvedAt: Date | null;
  notificationStatus: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
  notificationFailure: string | null;
  notificationAttempts: number;
  notifiedAt: Date | null;
};

interface ProductRow {
  id: string;
  organizationId: string;
  name: string;
  sku: string;
  stock: number;
  minStock: number;
}

function build(
  options: { products?: ProductRow[]; failHistoryFor?: string } = {},
) {
  const products: ProductRow[] = options.products ?? [];
  const alerts: AlertRow[] = [];
  const events: Array<Record<string, unknown>> = [];
  let sequence = 0;

  const match = (row: AlertRow, where: Record<string, unknown>): boolean => {
    if (where.id !== undefined) {
      if (typeof where.id === 'object' && where.id !== null) {
        const ids = (where.id as { in?: string[] }).in ?? [];
        if (!ids.includes(row.id)) return false;
      } else if (where.id !== row.id) return false;
    }
    if (where.organizationId && where.organizationId !== row.organizationId)
      return false;
    if (where.state && where.state !== row.state) return false;
    if (
      where.notificationStatus &&
      where.notificationStatus !== row.notificationStatus
    )
      return false;
    return true;
  };

  const apply = (row: AlertRow, data: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(data)) {
      if (key === 'episode') {
        row.episode = (value as { increment: number }).increment
          ? row.episode + (value as { increment: number }).increment
          : row.episode;
      } else if (key === 'notificationAttempts') {
        row.notificationAttempts += (value as { increment: number }).increment;
      } else {
        (row as unknown as Record<string, unknown>)[key] = value;
      }
    }
  };

  const prisma = {
    product: {
      fields: { minStock: MIN_STOCK_FIELD },
      findMany: jest.fn(
        async (args?: {
          where?: { organizationId?: string; id?: { in: string[] } };
        }) => {
          if (args?.where?.id?.in) {
            return products
              .filter((p) => args.where!.id!.in.includes(p.id))
              .map(({ id, name, sku, stock, minStock }) => ({
                id,
                name,
                sku,
                stock,
                minStock,
              }));
          }
          if (args?.where?.organizationId) {
            return products
              .filter((p) => p.organizationId === args.where!.organizationId)
              .map(({ id, name, sku, stock, minStock }) => ({
                id,
                name,
                sku,
                stock,
                minStock,
              }));
          }
          return products.map(({ organizationId }) => ({ organizationId }));
        },
      ),
    },
    productStockAlert: {
      findMany: jest.fn(async (args: { where: Record<string, unknown> }) =>
        alerts
          .filter((row) => match(row, args.where))
          .map((row) => ({ ...row })),
      ),
      create: jest.fn(async (args: { data: Partial<AlertRow> }) => {
        if (alerts.some((row) => row.productId === args.data.productId)) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        const row: AlertRow = {
          id: `a${++sequence}`,
          organizationId: args.data.organizationId!,
          productId: args.data.productId!,
          state: args.data.state ?? 'OPEN',
          episode: args.data.episode ?? 1,
          stockAtOpen: args.data.stockAtOpen ?? 0,
          minStockAtOpen: args.data.minStockAtOpen ?? 0,
          openedAt: args.data.openedAt ?? new Date(),
          resolvedAt: null,
          notificationStatus: 'PENDING',
          notificationFailure: null,
          notificationAttempts: 0,
          notifiedAt: null,
        };
        alerts.push(row);
        return { ...row };
      }),
      updateMany: jest.fn(
        async (args: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          const rows = alerts.filter((row) => match(row, args.where));
          rows.forEach((row) => apply(row, args.data));
          return { count: rows.length };
        },
      ),
    },
    whatsAppIdentity: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    organizationUser: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    productStockAlertEvent: {
      createMany: jest.fn(
        async (args: { data: Array<Record<string, unknown>> }) => {
          if (options.failHistoryFor && args.data[0]?.kind === options.failHistoryFor) {
            throw new Error('history unavailable');
          }
          events.push(...args.data);
          return { count: args.data.length };
        },
      ),
    },
  };

  const connections = {
    getOrCreateIntelligence: jest
      .fn()
      .mockResolvedValue({ sessionName: 'intelligence' }),
  };
  const sender = {
    sendText: jest.fn().mockResolvedValue({ providerMessageId: 'w1' }),
  };

  const service = new StockAlertsService(
    prisma as unknown as PrismaService,
    connections as unknown as WhatsAppConnectionsService,
    sender as unknown as WhatsAppTextSender,
  );

  return { service, prisma, connections, sender, alerts, events, products };
}

const product = (over: Partial<ProductRow> = {}): ProductRow => ({
  id: 'p1',
  organizationId: 'org-1',
  name: 'Café molido 500 g',
  sku: 'BEB-003',
  stock: 3,
  minStock: 5,
  ...over,
});

const recipient = (prisma: ReturnType<typeof build>['prisma']) => {
  prisma.whatsAppIdentity.findMany.mockResolvedValue([
    { phone: '+57 300 123 4567', userId: 'u1' },
  ]);
  prisma.organizationUser.findMany.mockResolvedValue([{ userId: 'u1' }]);
};

describe('StockAlertsService', () => {
  it('opens one episode, sends one message and marks it sent', async () => {
    const { service, prisma, alerts, sender } = build({
      products: [product()],
    });
    recipient(prisma);

    const summary = await service.scanOrganization('org-1');

    expect(summary).toEqual({ opened: 1, resolved: 0, notified: 1, failed: 0 });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      productId: 'p1',
      state: 'OPEN',
      episode: 1,
      notificationStatus: 'SENT',
      notificationAttempts: 1,
    });
    expect(sender.sendText).toHaveBeenCalledTimes(1);
    const [session, message] = sender.sendText.mock.calls[0];
    expect(session).toBe('intelligence');
    expect(message.chatId).toBe('573001234567@c.us');
    expect(message.text).toContain('Café molido 500 g');
  });

  it('appends the episode history without overwriting it', async () => {
    const { service, prisma, events } = build({ products: [product()] });
    recipient(prisma);

    await service.scanOrganization('org-1');
    prisma.product.findMany.mockResolvedValue([]);
    await service.scanOrganization('org-1');
    prisma.product.findMany.mockResolvedValue([product({ stock: 0 })]);
    await service.scanOrganization('org-1');

    expect(events).toEqual([
      expect.objectContaining({ kind: 'OPENED', episode: 1, productId: 'p1' }),
      expect.objectContaining({ kind: 'NOTIFIED', episode: 1, productId: 'p1' }),
      expect.objectContaining({ kind: 'RESOLVED', episode: 1, productId: 'p1' }),
      expect.objectContaining({ kind: 'OPENED', episode: 2, productId: 'p1' }),
      expect.objectContaining({ kind: 'NOTIFIED', episode: 2, productId: 'p1' }),
    ]);
  });

  it('keeps a delivered episode SENT when the history write fails', async () => {
    const { service, prisma, alerts, sender } = build({
      products: [product()],
      failHistoryFor: 'NOTIFIED',
    });
    recipient(prisma);

    await expect(service.scanOrganization('org-1')).rejects.toThrow(
      'history unavailable',
    );
    expect(sender.sendText).toHaveBeenCalledTimes(1);
    expect(alerts[0]).toMatchObject({ notificationStatus: 'SENT' });
  });

  it('reports every skipped episode of a batch', async () => {
    const second = product({ id: 'p2', sku: 'BEB-004' });
    const { service } = build({ products: [product(), second] });

    const summary = await service.scanOrganization('org-1');

    expect(summary).toEqual({ opened: 2, resolved: 0, notified: 0, failed: 2 });
  });

  it('does not open or send again on a second scan', async () => {
    const { service, prisma, sender } = build({ products: [product()] });
    recipient(prisma);

    await service.scanOrganization('org-1');
    const summary = await service.scanOrganization('org-1');

    expect(summary).toEqual({ opened: 0, resolved: 0, notified: 0, failed: 0 });
    expect(sender.sendText).toHaveBeenCalledTimes(1);
  });

  it('resolves the episode when the product recovers', async () => {
    const { service, prisma, alerts } = build({ products: [product()] });
    recipient(prisma);
    await service.scanOrganization('org-1');

    prisma.product.findMany.mockResolvedValue([]);
    const summary = await service.scanOrganization('org-1');

    expect(summary.resolved).toBe(1);
    expect(alerts[0]).toMatchObject({ state: 'RESOLVED', episode: 1 });
    expect(alerts[0].resolvedAt).toBeInstanceOf(Date);
  });

  it('reopens with the next episode and notifies again after a recovery', async () => {
    const { service, prisma, alerts, sender } = build({
      products: [product()],
    });
    recipient(prisma);
    await service.scanOrganization('org-1');

    prisma.product.findMany.mockResolvedValue([]);
    await service.scanOrganization('org-1');

    prisma.product.findMany.mockResolvedValue([
      product({ id: 'p1', stock: 0 }),
    ]);
    const summary = await service.scanOrganization('org-1');

    expect(summary.opened).toBe(1);
    expect(summary.notified).toBe(1);
    expect(alerts[0]).toMatchObject({
      state: 'OPEN',
      episode: 2,
      notificationStatus: 'SENT',
    });
    expect(sender.sendText).toHaveBeenCalledTimes(2);
  });

  it('records no_recipient instead of throwing when nobody may receive it', async () => {
    const { service, alerts, sender } = build({
      products: [product()],
    });

    const summary = await service.scanOrganization('org-1');

    expect(summary).toEqual({ opened: 1, resolved: 0, notified: 0, failed: 1 });
    expect(alerts[0]).toMatchObject({
      notificationStatus: 'SKIPPED',
      notificationFailure: 'no_recipient',
    });
    expect(sender.sendText).not.toHaveBeenCalled();
  });

  it('records provider_rejected and never retries automatically', async () => {
    const { service, prisma, alerts, sender } = build({
      products: [product()],
    });
    recipient(prisma);
    sender.sendText.mockRejectedValue(new ServiceUnavailableException());

    const summary = await service.scanOrganization('org-1');

    expect(summary.failed).toBe(1);
    expect(alerts[0]).toMatchObject({
      notificationStatus: 'FAILED',
      notificationFailure: 'provider_rejected',
      notificationAttempts: 1,
    });

    const second = await service.scanOrganization('org-1');
    expect(second.failed).toBe(0);
    expect(sender.sendText).toHaveBeenCalledTimes(1);
  });

  it('never sends when another scan already claimed the row', async () => {
    const { service, prisma, sender, alerts } = build({
      products: [product()],
    });
    recipient(prisma);
    await service.scanOrganization('org-1');

    // Reset the row to pending and let the claim lose the race.
    alerts[0].notificationStatus = 'PENDING';
    prisma.productStockAlert.updateMany.mockResolvedValue({ count: 0 });

    await service.scanOrganization('org-1');

    expect(sender.sendText).toHaveBeenCalledTimes(1);
  });

  it('scans every organization that has an open episode or a low product', async () => {
    const other = product({ id: 'p2', organizationId: 'org-2' });
    const { service, prisma, alerts } = build({ products: [product(), other] });
    recipient(prisma);

    const summary = await service.scanAll();

    expect(summary.opened).toBe(2);
    expect(new Set(alerts.map((row) => row.organizationId))).toEqual(
      new Set(['org-1', 'org-2']),
    );
  });

  it('returns an empty summary when the scan cannot even list organizations', async () => {
    const { service, prisma } = build();
    prisma.product.findMany.mockRejectedValue(new Error('db down'));

    await expect(service.scanAll()).resolves.toEqual({
      opened: 0,
      resolved: 0,
      notified: 0,
      failed: 0,
    });
  });
});
