import type { Prisma } from '@prisma/client';
import {
  applySiteStockDelta,
  resolveDefaultSiteWithin,
  SiteStockError,
} from './site-stock';

/**
 * Contract of the per-site ledger helper: tenant scoping, the conditional
 * compare-and-swap, the race-safe creation of a missing site row and the
 * fail-closed reads. The behaviour against real PostgreSQL is in
 * `site-stock.postgres.spec.ts`.
 */

interface FakeTransaction {
  $executeRaw: jest.Mock<Promise<number>, [Prisma.Sql]>;
  productStock: { findFirst: jest.Mock };
  location: { findFirst: jest.Mock };
}

function fakeTransaction(): FakeTransaction {
  return {
    $executeRaw: jest.fn<Promise<number>, [Prisma.Sql]>(),
    productStock: { findFirst: jest.fn() },
    location: { findFirst: jest.fn() },
  };
}

const asTransaction = (tx: FakeTransaction) =>
  tx as unknown as Prisma.TransactionClient;

const ref = {
  organizationId: 'org-1',
  productId: 'product-1',
  locationId: 'site-1',
};

const statements = (tx: FakeTransaction) =>
  tx.$executeRaw.mock.calls.map(([statement]) => statement);

describe('resolveDefaultSiteWithin', () => {
  it('reads the organization default site inside the caller transaction', async () => {
    const tx = fakeTransaction();
    tx.location.findFirst.mockResolvedValue({ id: 'site-1' });

    await expect(
      resolveDefaultSiteWithin(asTransaction(tx), 'org-1'),
    ).resolves.toBe('site-1');
    expect(tx.location.findFirst).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', isDefault: true },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
  });

  it('fails closed when the organization has no default site', async () => {
    const tx = fakeTransaction();
    tx.location.findFirst.mockResolvedValue(null);

    await expect(
      resolveDefaultSiteWithin(asTransaction(tx), 'org-1'),
    ).rejects.toThrow(SiteStockError);
  });

  it('fails closed without an organization scope', async () => {
    const tx = fakeTransaction();

    await expect(
      resolveDefaultSiteWithin(asTransaction(tx), ''),
    ).rejects.toThrow(SiteStockError);
    expect(tx.location.findFirst).not.toHaveBeenCalled();
  });
});

describe('applySiteStockDelta', () => {
  it('applies the delta in one statement scoped by tenant', async () => {
    const tx = fakeTransaction();
    tx.$executeRaw.mockResolvedValue(1);

    await expect(
      applySiteStockDelta(asTransaction(tx), {
        ...ref,
        stockDelta: -2,
        reservedDelta: 0,
      }),
    ).resolves.toEqual({ applied: true, created: false });

    const [statement] = statements(tx);
    expect(statement.sql).toContain('"organizationId" = ');
    expect(statement.values).toEqual(
      expect.arrayContaining(['org-1', 'product-1', 'site-1']),
    );
    expect(tx.productStock.findFirst).not.toHaveBeenCalled();
  });

  it('refuses an over-draw without creating a row', async () => {
    const tx = fakeTransaction();
    tx.$executeRaw.mockResolvedValue(0);
    tx.productStock.findFirst.mockResolvedValue({ organizationId: 'org-1' });

    await expect(
      applySiteStockDelta(asTransaction(tx), {
        ...ref,
        stockDelta: -6,
        reservedDelta: 0,
      }),
    ).resolves.toEqual({ applied: false, reason: 'insufficient-stock' });
    expect(statements(tx)).toHaveLength(1);
    expect(tx.productStock.findFirst).toHaveBeenCalledWith({
      where: { ...ref },
      select: { organizationId: true },
    });
  });

  it('opens a missing site row for a positive delta', async () => {
    const tx = fakeTransaction();
    tx.$executeRaw.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    tx.productStock.findFirst.mockResolvedValue(null);

    await expect(
      applySiteStockDelta(asTransaction(tx), {
        ...ref,
        stockDelta: 4,
        reservedDelta: 1,
      }),
    ).resolves.toEqual({ applied: true, created: true });

    const [update, insert] = statements(tx);
    expect(update.sql).toContain('UPDATE "ProductStock"');
    expect(insert.sql).toContain('ON CONFLICT ("productId", "locationId")');
  });

  it('re-applies the delta when another writer opened the row first', async () => {
    const tx = fakeTransaction();
    tx.$executeRaw
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    tx.productStock.findFirst.mockResolvedValue(null);

    await expect(
      applySiteStockDelta(asTransaction(tx), {
        ...ref,
        stockDelta: 4,
        reservedDelta: 0,
      }),
    ).resolves.toEqual({ applied: true, created: false });
    expect(statements(tx)).toHaveLength(3);
  });

  it('refuses to open a row from a decrement', async () => {
    const tx = fakeTransaction();
    tx.$executeRaw.mockResolvedValue(0);
    tx.productStock.findFirst.mockResolvedValue(null);

    await expect(
      applySiteStockDelta(asTransaction(tx), {
        ...ref,
        stockDelta: -1,
        reservedDelta: 0,
      }),
    ).resolves.toEqual({ applied: false, reason: 'insufficient-stock' });
    expect(statements(tx)).toHaveLength(1);
  });

  it('refuses to open a row whose reservation exceeds its stock', async () => {
    const tx = fakeTransaction();
    tx.$executeRaw.mockResolvedValue(0);
    tx.productStock.findFirst.mockResolvedValue(null);

    await expect(
      applySiteStockDelta(asTransaction(tx), {
        ...ref,
        stockDelta: 0,
        reservedDelta: 2,
      }),
    ).resolves.toEqual({ applied: false, reason: 'insufficient-stock' });
    expect(statements(tx)).toHaveLength(1);
  });

  it('does not touch the database for a no-op delta', async () => {
    const tx = fakeTransaction();

    await expect(
      applySiteStockDelta(asTransaction(tx), {
        ...ref,
        stockDelta: 0,
        reservedDelta: 0,
      }),
    ).resolves.toEqual({ applied: true, created: false });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('guards only the changes that reduce availability', async () => {
    const tx = fakeTransaction();
    tx.$executeRaw.mockResolvedValue(1);

    await applySiteStockDelta(asTransaction(tx), {
      ...ref,
      stockDelta: -3,
      reservedDelta: 0,
      requireAvailable: 2,
    });
    await applySiteStockDelta(asTransaction(tx), {
      ...ref,
      stockDelta: 3,
      reservedDelta: 0,
    });

    const [withdraw, receipt] = statements(tx);
    expect(withdraw.sql).toContain('- ("reservedStock"');
    expect(receipt.sql).not.toContain('- ("reservedStock"');
  });

  it('rejects a non-integer quantity', async () => {
    const tx = fakeTransaction();

    await expect(
      applySiteStockDelta(asTransaction(tx), {
        ...ref,
        stockDelta: 1.5,
        reservedDelta: 0,
      }),
    ).rejects.toThrow(SiteStockError);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('requires an organization, a product and a location', async () => {
    const tx = fakeTransaction();

    await expect(
      applySiteStockDelta(asTransaction(tx), {
        ...ref,
        locationId: '',
        stockDelta: 1,
        reservedDelta: 0,
      }),
    ).rejects.toThrow(SiteStockError);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});
