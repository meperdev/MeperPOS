import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from './products.service';

/**
 * T3e — product lifecycle at the default site (real PostgreSQL).
 *
 * Creation paths (including every import, which delegates to
 * `ProductsService.create`) keep writing only the organization-wide balance: the
 * database trigger opens the default-site row. Editing the stock is a different
 * story — the absolute write is gone, so an edit becomes a signed delta applied
 * to the tenant default site inside the same transaction, and the site ledger
 * refuses a change it cannot absorb instead of breaking the invariant.
 *
 * The suite is bound to an explicitly provided disposable database and creates
 * its own uniquely named rows; it never migrates, resets or deletes anything it
 * did not create. Run it with `T3E_TEST_DATABASE_URL` pointing at a disposable
 * database that already has the migration applied, e.g.
 *
 *   T3E_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/meperpos_stock_rehearsal_t3e_products?schema=public \
 *     npx jest --runInBand src/products/products.site-stock.postgres.spec.ts
 */
const databaseUrl = process.env.T3E_TEST_DATABASE_URL;

interface Fixture {
  organizationId: string;
  categoryId: string;
  defaultSiteId: string;
  warehouseId: string;
  userId: string;
}

(databaseUrl ? describe : describe.skip)(
  'Product lifecycle at the default site (real PostgreSQL)',
  () => {
    const label = `t3e-products-${randomUUID()}`;
    let prisma: PrismaClient;
    let products: ProductsService;

    beforeAll(() => {
      const url = new URL(databaseUrl!);
      if (
        url.protocol !== 'postgresql:' ||
        url.hostname !== '127.0.0.1' ||
        !url.port ||
        url.port === '5432' ||
        url.search !== '?schema=public' ||
        !/^\/meperpos_stock_rehearsal_t3e[a-z0-9_]*$/.test(url.pathname)
      ) {
        throw new Error(
          'Expected an explicit disposable T3e PostgreSQL database',
        );
      }
      prisma = new PrismaClient({ datasourceUrl: url.href });
      products = new ProductsService(
        prisma as unknown as PrismaService,
        { uploadImage: jest.fn() } as never,
        { invalidateCache: jest.fn() } as never,
      );
    });

    afterAll(async () => {
      if (!prisma) return;
      // Stock movements are immutable by trigger, so the rows this suite
      // created stay as evidence in the disposable database. Every run uses
      // freshly generated identifiers, so nothing is reused.
      await prisma.$disconnect();
    });

    async function fixture(): Promise<Fixture> {
      const unique = `${label}-${randomUUID()}`;
      const organization = await prisma.organization.create({
        data: { name: unique, slug: unique },
      });
      const site = await prisma.location.create({
        data: {
          organizationId: organization.id,
          name: 'Principal',
          isDefault: true,
        },
      });
      const warehouse = await prisma.location.create({
        data: { organizationId: organization.id, name: 'Bodega' },
      });
      const category = await prisma.category.create({
        data: { name: unique, organizationId: organization.id },
      });
      const user = await prisma.user.create({
        data: {
          email: `${unique}@example.com`,
          password: 'not-a-real-hash',
          name: 'T3e editor',
          tokenVersion: 0,
        },
      });

      return {
        organizationId: organization.id,
        categoryId: category.id,
        defaultSiteId: site.id,
        warehouseId: warehouse.id,
        userId: user.id,
      };
    }

    const create = (
      fixture: Fixture,
      data: { stock?: number; name?: string } = {},
    ) =>
      products.create(
        {
          name: data.name ?? `${label}-product`,
          sku: randomUUID(),
          costPrice: 100,
          salePrice: 200,
          stock: data.stock ?? 10,
          minStock: 1,
          categoryId: fixture.categoryId,
        },
        fixture.userId,
        fixture.organizationId,
      );

    const aggregate = (productId: string) =>
      prisma.product.findUniqueOrThrow({
        where: { id: productId },
        select: { stock: true, reservedStock: true, version: true },
      });

    const siteRows = (productId: string) =>
      prisma.productStock.findMany({
        where: { productId },
        orderBy: { locationId: 'asc' },
      });

    const siteRowAt = (productId: string, locationId: string) =>
      prisma.productStock.findUniqueOrThrow({
        where: { productId_locationId: { productId, locationId } },
      });

    async function expectAggregateMatchesSites(productId: string) {
      const rows = await siteRows(productId);
      const product = await aggregate(productId);
      expect(product).toMatchObject({
        stock: rows.reduce((total, row) => total + row.stock, 0),
        reservedStock: rows.reduce(
          (total, row) => total + row.reservedStock,
          0,
        ),
      });
    }

    it('opens the default-site row on create without counting the stock twice', async () => {
      const created = await fixture();
      const product = await create(created, { stock: 7 });

      await expect(siteRows(product.id)).resolves.toEqual([
        {
          productId: product.id,
          locationId: created.defaultSiteId,
          organizationId: created.organizationId,
          stock: 7,
          reservedStock: 0,
        },
      ]);
      await expect(aggregate(product.id)).resolves.toMatchObject({
        stock: 7,
        reservedStock: 0,
      });
      await expectAggregateMatchesSites(product.id);

      // The creation movement follows the site that now holds the balance.
      await expect(
        prisma.inventoryMovement.findMany({
          where: { productId: product.id },
          select: { locationId: true, type: true, quantity: true },
        }),
      ).resolves.toEqual([
        { locationId: created.defaultSiteId, type: 'PURCHASE', quantity: 7 },
      ]);
    });

    it('applies a stock edit as a delta at the default site and leaves other sites alone', async () => {
      const created = await fixture();
      const product = await create(created, { stock: 10 });
      await prisma.productStock.create({
        data: {
          organizationId: created.organizationId,
          productId: product.id,
          locationId: created.warehouseId,
          stock: 5,
          reservedStock: 1,
        },
      });
      const before = await aggregate(product.id);
      expect(before).toMatchObject({ stock: 15, reservedStock: 1 });

      const updated = await products.update(
        product.id,
        { stock: 12 },
        created.userId,
        created.organizationId,
      );

      expect(updated.stock).toBe(12);
      await expect(
        siteRowAt(product.id, created.defaultSiteId),
      ).resolves.toMatchObject({
        stock: 7,
        reservedStock: 0,
      });
      await expect(
        siteRowAt(product.id, created.warehouseId),
      ).resolves.toMatchObject({
        stock: 5,
        reservedStock: 1,
      });
      await expect(aggregate(product.id)).resolves.toMatchObject({
        stock: 12,
        reservedStock: 1,
        version: before.version + 1,
      });
      await expectAggregateMatchesSites(product.id);
      await expect(
        prisma.inventoryMovement.findMany({
          where: { productId: product.id },
          select: {
            locationId: true,
            type: true,
            quantity: true,
            previousStock: true,
            newStock: true,
          },
        }),
      ).resolves.toEqual([
        {
          locationId: created.defaultSiteId,
          type: 'PURCHASE',
          quantity: 10,
          previousStock: 0,
          newStock: 10,
        },
        {
          locationId: created.defaultSiteId,
          type: 'ADJUSTMENT_OUT',
          quantity: -3,
          previousStock: 15,
          newStock: 12,
        },
      ]);
    });

    it('refuses a reduction the default site cannot absorb and changes nothing', async () => {
      const created = await fixture();
      const product = await create(created, { stock: 2 });
      await prisma.productStock.create({
        data: {
          organizationId: created.organizationId,
          productId: product.id,
          locationId: created.warehouseId,
          stock: 8,
          reservedStock: 0,
        },
      });
      const before = {
        product: await aggregate(product.id),
        defaultSite: await siteRowAt(product.id, created.defaultSiteId),
        warehouse: await siteRowAt(product.id, created.warehouseId),
        movements: await prisma.inventoryMovement.count({
          where: { productId: product.id },
        }),
      };

      // The organization-wide balance could become 5, but the default site only
      // holds 2: the write is refused instead of draining stock it never had.
      await expect(
        products.update(
          product.id,
          { stock: 5 },
          created.userId,
          created.organizationId,
        ),
      ).rejects.toMatchObject({
        status: 409,
        message:
          'La sede principal no puede absorber el ajuste de stock: quedaría por debajo de lo reservado o sin existencias',
      });

      expect(await aggregate(product.id)).toEqual(before.product);
      expect(await siteRowAt(product.id, created.defaultSiteId)).toEqual(
        before.defaultSite,
      );
      expect(await siteRowAt(product.id, created.warehouseId)).toEqual(
        before.warehouse,
      );
      await expect(
        prisma.inventoryMovement.count({ where: { productId: product.id } }),
      ).resolves.toBe(before.movements);
      await expectAggregateMatchesSites(product.id);
    });

    it('rolls the site delta back when the concurrent-edit guard loses', async () => {
      const created = await fixture();
      const product = await create(created, { stock: 10 });
      const before = {
        product: await aggregate(product.id),
        defaultSite: await siteRowAt(product.id, created.defaultSiteId),
        movements: await prisma.inventoryMovement.count({
          where: { productId: product.id },
        }),
      };

      // Bumps the version after the service read the product and before it
      // writes: exactly the concurrent edit the optimistic-concurrency contract
      // has always refused, now after the site row was moved.
      const racingPrisma = new Proxy(prisma, {
        get(target, property, receiver) {
          if (property === '$transaction') {
            return async (
              run: (tx: unknown) => Promise<unknown>,
              ...rest: unknown[]
            ) => {
              await prisma.product.update({
                where: { id: product.id },
                data: { version: { increment: 1 } },
              });
              return (
                target.$transaction as unknown as (
                  ...args: unknown[]
                ) => Promise<unknown>
              )(run, ...rest);
            };
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const racing = new ProductsService(
        racingPrisma as unknown as PrismaService,
        { uploadImage: jest.fn() } as never,
        { invalidateCache: jest.fn() } as never,
      );

      await expect(
        racing.update(
          product.id,
          { stock: 12 },
          created.userId,
          created.organizationId,
        ),
      ).rejects.toMatchObject({
        status: 409,
        message: 'Product was modified by another user',
      });

      // The delta had already been applied when the guard lost: it rolled back
      // with the transaction, so only the competing version bump remains.
      expect(await siteRowAt(product.id, created.defaultSiteId)).toEqual(
        before.defaultSite,
      );
      expect(await aggregate(product.id)).toEqual({
        ...before.product,
        version: before.product.version + 1,
      });
      await expect(
        prisma.inventoryMovement.count({ where: { productId: product.id } }),
      ).resolves.toBe(before.movements);
      await expectAggregateMatchesSites(product.id);
    });

    it('deactivates, reactivates and removes without touching the quantities', async () => {
      const created = await fixture();
      const product = await create(created, { stock: 5 });

      await products.deactivate(product.id, created.organizationId);
      await expect(
        siteRowAt(product.id, created.defaultSiteId),
      ).resolves.toMatchObject({
        stock: 5,
        reservedStock: 0,
      });
      await expect(aggregate(product.id)).resolves.toMatchObject({
        stock: 5,
        reservedStock: 0,
      });

      await products.reactivate(product.id, created.organizationId);
      await expect(
        siteRowAt(product.id, created.defaultSiteId),
      ).resolves.toMatchObject({
        stock: 5,
        reservedStock: 0,
      });
      await expect(aggregate(product.id)).resolves.toMatchObject({
        stock: 5,
        reservedStock: 0,
      });
      await expectAggregateMatchesSites(product.id);

      // Removal cascades the site rows and the aggregate with the product. A
      // product that already has kárdex history cannot be deleted at all, so
      // this case uses one that never moved a unit.
      const removable = await create(created, { stock: 0 });
      await products.remove(removable.id, created.organizationId);
      await expect(siteRows(removable.id)).resolves.toEqual([]);
      await expect(
        prisma.product.count({ where: { id: removable.id } }),
      ).resolves.toBe(0);
    });

    it('still refuses to deactivate a product with pending reservations', async () => {
      const created = await fixture();
      const product = await create(created, { stock: 5 });
      await prisma.productStock.update({
        where: {
          productId_locationId: {
            productId: product.id,
            locationId: created.defaultSiteId,
          },
        },
        data: { reservedStock: 2 },
      });

      await expect(
        products.deactivate(product.id, created.organizationId),
      ).rejects.toMatchObject({
        status: 409,
        message:
          'No se puede reducir el stock por debajo de lo reservado, desactivar, eliminar o dejar de controlar un producto con reservas pendientes',
      });
      await expect(
        siteRowAt(product.id, created.defaultSiteId),
      ).resolves.toMatchObject({
        stock: 5,
        reservedStock: 2,
      });
      await expect(
        prisma.product.findUniqueOrThrow({
          where: { id: product.id },
          select: { active: true, stock: true, reservedStock: true },
        }),
      ).resolves.toEqual({ active: true, stock: 5, reservedStock: 2 });
    });
  },
);
