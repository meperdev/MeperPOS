import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductType } from '@prisma/client';
import { ProductsService } from './products.service';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// DB-free conditional-write model. PostgreSQL constraints/races still require L7.
describe('ProductsService reservation foundation', () => {
  const row = () => ({
    id: 'product-1',
    organizationId: 'org-1',
    version: 3,
    type: ProductType.PRODUCT,
    tracksStock: true,
    active: true,
    stock: 10,
    reservedStock: 4,
    minStock: 2,
    name: 'Equipment',
    sku: 'EQ-1',
    barcode: null,
    salePrice: 100,
    taxRate: 0,
    taxable: false,
    category: null,
  });
  type ProductRow = ReturnType<typeof row>;
  type LookupArgs = {
    where: Partial<ProductRow>;
    include?: { category: boolean };
  };
  type WriteArgs = LookupArgs & {
    data: Omit<Partial<ProductRow>, 'version'> & {
      version?: { increment: number };
    };
  };
  let snapshot: ProductRow;
  let current: ProductRow;
  let race: (() => void) | undefined;
  const containing = (shape: Record<string, unknown>): unknown =>
    expect.objectContaining(shape);
  const prisma = {
    category: { findFirst: jest.fn() },
    product: {
      findFirst: jest.fn<Promise<ProductRow | null>, [LookupArgs]>(),
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn<Promise<{ count: number }>, [WriteArgs]>(),
      update: jest.fn<Promise<ProductRow>, [WriteArgs]>(),
      delete: jest.fn<Promise<ProductRow>, [LookupArgs]>(),
    },
    inventoryMovement: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    inventoryLoanItem: {
      fields: { returnedQuantity: { name: 'returnedQuantity' } },
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  let service: ProductsService;

  function matches(where: Record<string, unknown>) {
    race?.();
    return Object.entries(where).every(
      ([key, value]) => current[key as keyof typeof current] === value,
    );
  }

  beforeEach(() => {
    jest.resetAllMocks();
    snapshot = row();
    current = { ...snapshot };
    race = undefined;
    prisma.inventoryLoanItem.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    prisma.product.findFirst
      .mockImplementationOnce(() => Promise.resolve({ ...snapshot }))
      .mockImplementation(() => Promise.resolve({ ...current }));
    prisma.product.updateMany.mockImplementation(({ where, data }) => {
      if (!matches(where)) return Promise.resolve({ count: 0 });
      current = { ...current, ...data, version: current.version + 1 };
      return Promise.resolve({ count: 1 });
    });
    prisma.product.update.mockImplementation(({ where, data }) => {
      if (!matches(where))
        throw new Prisma.PrismaClientKnownRequestError('Missing row', {
          code: 'P2025',
          clientVersion: 'test',
        });
      current = { ...current, ...data, version: current.version + 1 };
      return Promise.resolve({ ...current });
    });
    prisma.product.delete.mockImplementation(({ where }) => {
      if (!matches(where))
        throw new Prisma.PrismaClientKnownRequestError('Missing row', {
          code: 'P2025',
          clientVersion: 'test',
        });
      return Promise.resolve({ ...current });
    });
    service = new ProductsService(
      prisma as never,
      {} as never,
      { invalidateCache: jest.fn() } as never,
    );
  });

  const update = (dto: UpdateProductDto) =>
    service.update('product-1', dto, 'actor-1', 'org-1');
  const noEffects = () => {
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  };

  it.each<UpdateProductDto>([
    { stock: 3 },
    { type: ProductType.SERVICE },
    { tracksStock: false },
    { active: false },
    { stock: 100, tracksStock: false },
  ])('rejects incompatible edits %j before writing', async (dto) => {
    await expect(update(dto)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.inventoryLoanItem.findFirst).not.toHaveBeenCalled();
    expect(current).toEqual(snapshot);
    noEffects();
  });

  it.each([4, 10, 12])(
    'allows on-hand stock %i without altering reservations',
    async (stock) => {
      const result = await update({ stock });
      expect(result.stock).toBe(stock);
      expect(result.reservedStock).toBe(4);
      expect(prisma.product.updateMany).toHaveBeenCalledWith(
        containing({
          where: {
            id: 'product-1',
            organizationId: 'org-1',
            active: true,
            version: 3,
            reservedStock: 4,
          },
          data: containing({ stock, version: { increment: 1 } }),
        }),
      );
      expect(
        prisma.product.updateMany.mock.calls[0][0].data,
      ).not.toHaveProperty('reservedStock');
      if (stock === 10) noEffects();
      else
        expect(prisma.inventoryMovement.create).toHaveBeenCalledWith(
          containing({
            data: containing({
              previousStock: 10,
              newStock: stock,
              quantity: stock - 10,
            }),
          }),
        );
    },
  );

  it('allows unrelated edits while reserved', async () => {
    await update({ name: 'Renamed' });
    expect(current.name).toBe('Renamed');
    expect(current.reservedStock).toBe(4);
    noEffects();
  });

  it.each(['deactivate', 'remove'] as const)(
    'rejects %s while reserved',
    async (operation) => {
      await expect(
        service[operation]('product-1', 'org-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.product.update).not.toHaveBeenCalled();
      expect(prisma.product.delete).not.toHaveBeenCalled();
      noEffects();
    },
  );

  it.each<UpdateProductDto>([
    { stock: 0 },
    { type: ProductType.SERVICE },
    { tracksStock: false },
    { active: false },
  ])('preserves zero-reservation edit semantics %j', async (dto) => {
    snapshot.reservedStock = current.reservedStock = 0;
    const result = await update(dto);
    expect(result.reservedStock).toBe(0);
    if (dto.type === ProductType.SERVICE || dto.tracksStock === false) {
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.inventoryLoanItem.findFirst).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          productId: 'product-1',
          deliveredQuantity: {
            gt: prisma.inventoryLoanItem.fields.returnedQuantity,
          },
        },
      });
    } else {
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.inventoryLoanItem.findFirst).not.toHaveBeenCalled();
    }
    if (dto.active === false) {
      expect(result.active).toBe(false);
      expect(prisma.product.findFirst).toHaveBeenLastCalledWith({
        where: { id: 'product-1', organizationId: 'org-1', active: false },
        include: { category: true },
      });
    }
  });

  it.each(['deactivate', 'remove'] as const)(
    'allows %s with zero reservations and guards the snapshot',
    async (operation) => {
      snapshot.reservedStock = current.reservedStock = 0;
      await service[operation]('product-1', 'org-1');
      const writer =
        operation === 'deactivate'
          ? prisma.product.update
          : prisma.product.delete;
      expect(writer).toHaveBeenCalledWith(
        containing({
          where: containing({
            id: 'product-1',
            organizationId: 'org-1',
            version: 3,
            reservedStock: 0,
          }),
        }),
      );
      noEffects();
    },
  );

  it.each(['version', 'reservedStock'] as const)(
    'rejects a changed %s on manual edit without movement/audit',
    async (field) => {
      race = () => {
        current[field]++;
      };
      await expect(update({ stock: 12 })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(current.stock).toBe(10);
      noEffects();
    },
  );

  it.each([
    ['deactivate', 'reservedStock'],
    ['deactivate', 'version'],
    ['remove', 'reservedStock'],
    ['remove', 'version'],
  ] as const)(
    'rejects %s with a concurrent change to %s',
    async (operation, field) => {
      snapshot.reservedStock = current.reservedStock = 0;
      race = () => {
        current[field]++;
      };
      await expect(
        service[operation]('product-1', 'org-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(current.active).toBe(true);
      noEffects();
    },
  );

  it.each([undefined, -1, 11, 1.5])(
    'fails closed on invalid stored reservation %s',
    async (reservedStock) => {
      Object.assign(snapshot, { reservedStock });
      await expect(update({ name: 'Renamed' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.product.updateMany).not.toHaveBeenCalled();
      noEffects();
    },
  );

  it.each([
    { type: ProductType.SERVICE },
    { tracksStock: false },
    { active: false },
  ])(
    'rejects an ineligible reserved snapshot %j without repairing it',
    async (invalid) => {
      Object.assign(snapshot, invalid);
      await expect(update({ name: 'Renamed' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.product.updateMany).not.toHaveBeenCalled();
      noEffects();
    },
  );

  it('retains the existing foreign-key deletion conflict', async () => {
    snapshot.reservedStock = current.reservedStock = 0;
    prisma.product.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Related movements', {
        code: 'P2003',
        clientVersion: 'test',
      }),
    );
    await expect(service.remove('product-1', 'org-1')).rejects.toThrow(
      'No se puede eliminar definitivamente un producto con ventas o movimientos de inventario asociados',
    );
    noEffects();
  });

  it.each(['update', 'deactivate', 'remove'] as const)(
    'preserves tenant lookup and missing-row behavior for %s',
    async (operation) => {
      prisma.product.findFirst.mockReset().mockResolvedValue(null);
      const call =
        operation === 'update'
          ? update({ stock: 12 })
          : service[operation]('product-1', 'org-1');
      await expect(call).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.product.findFirst).toHaveBeenCalledWith(
        containing({
          where: containing({
            id: 'product-1',
            organizationId: 'org-1',
          }),
        }),
      );
      noEffects();
    },
  );

  it('rejects reservedStock input on update even when bypassing DTO validation', async () => {
    await expect(
      update({ reservedStock: 0 } as UpdateProductDto),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
    noEffects();
  });

  it('rejects reservedStock input on creation even when bypassing DTO validation', async () => {
    await expect(
      service.create(
        { reservedStock: 1 } as unknown as CreateProductDto,
        'actor-1',
        'org-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.product.create).not.toHaveBeenCalled();
    noEffects();
  });
});

describe('reservation migration structure (not PostgreSQL enforcement)', () => {
  const sql = readFileSync(
    resolve(
      __dirname,
      '../../prisma/migrations/20261009030000_product_reservation_foundation/migration.sql',
    ),
    'utf8',
  );
  const schema = readFileSync(
    resolve(__dirname, '../../prisma/schema.prisma'),
    'utf8',
  );

  it('adds a default-zero integer matching Prisma without rewriting existing data', () => {
    expect(schema).toMatch(/reservedStock\s+Int\s+@default\(0\)/);
    expect(sql).toContain(
      'ADD COLUMN "reservedStock" INTEGER NOT NULL DEFAULT 0',
    );
    expect(sql).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE|DROP)\b/i);
  });

  it('requires nonnegative reservations bounded by physical on-hand stock', () => {
    expect(sql).toContain(
      'CHECK ("reservedStock" >= 0 AND "reservedStock" <= "stock")',
    );
  });

  it('permits positive reservations only on active tracked PRODUCT rows', () => {
    expect(sql).toContain('CHECK ("reservedStock" = 0 OR');
    expect(sql).toContain(
      '("active" = true AND "type" = \'PRODUCT\' AND "tracksStock" = true)',
    );
  });
});
