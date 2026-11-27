import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { applySiteStockDelta } from './site-stock';

/**
 * T3g — the site ledger, and only the site ledger, writes the aggregate.
 *
 * `20261125150000_product_stock_guard` installs a BEFORE UPDATE trigger on
 * `Product`: `stock`/`reservedStock` may only move from inside the
 * `ProductStock` aggregate trigger, while every other column stays editable and
 * inserts keep opening the default-site row.
 *
 * The suite is bound to an explicitly provided disposable database and creates
 * its own uniquely named rows; it never migrates, resets or deletes anything it
 * did not create. Run it with `T3G_TEST_DATABASE_URL` pointing at a disposable
 * database that already has the migration applied, e.g.
 *
 *   T3G_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/meperpos_stock_rehearsal_w3_cut_guard?schema=public \
 *     npx jest --runInBand src/inventory/product-stock-guard.postgres.spec.ts
 *
 * Against a database without the guard the first direct write simply succeeds,
 * so the rejection cases fail: that is the intended RED for this rule.
 */
const databaseUrl = process.env.T3G_TEST_DATABASE_URL;

interface Tenant {
  organizationId: string;
  categoryId: string;
  productId: string;
  defaultSiteId: string;
}

(databaseUrl ? describe : describe.skip)(
  'Product stock guard (real PostgreSQL)',
  () => {
    const label = `t3g-${randomUUID()}`;
    let prisma: PrismaClient;
    const organizations: string[] = [];

    beforeAll(() => {
      const url = new URL(databaseUrl!);
      if (
        url.protocol !== 'postgresql:' ||
        url.hostname !== '127.0.0.1' ||
        !url.port ||
        url.port === '5432' ||
        url.search !== '?schema=public' ||
        !/^\/meperpos_stock_rehearsal_w3_cut[a-z0-9_]*$/.test(url.pathname)
      ) {
        throw new Error(
          'Expected an explicit disposable T3g PostgreSQL database',
        );
      }
      prisma = new PrismaClient({ datasourceUrl: url.href });
    });

    afterAll(async () => {
      if (!prisma) return;
      try {
        if (organizations.length > 0) {
          await prisma.organization.deleteMany({
            where: { id: { in: organizations } },
          });
        }
      } finally {
        await prisma.$disconnect();
      }
    });

    /** A tenant, its default site and one tracked product carrying 5/1. */
    async function tenant(tag: string): Promise<Tenant> {
      const unique = `${label}-${tag}-${randomUUID()}`;
      const organization = await prisma.organization.create({
        data: { name: unique, slug: unique },
      });
      organizations.push(organization.id);

      const category = await prisma.category.create({
        data: { name: unique, organizationId: organization.id },
      });

      // Created through the API shape every writer uses: the insert trigger is
      // the one path allowed to open the aggregate and the site row together.
      const product = await prisma.product.create({
        data: {
          name: unique,
          sku: unique,
          costPrice: 10,
          salePrice: 20,
          stock: 5,
          reservedStock: 1,
          categoryId: category.id,
          organizationId: organization.id,
        },
      });

      const site = await prisma.location.findFirstOrThrow({
        where: { organizationId: organization.id, isDefault: true },
        select: { id: true },
      });

      return {
        organizationId: organization.id,
        categoryId: category.id,
        productId: product.id,
        defaultSiteId: site.id,
      };
    }

    const aggregate = (productId: string) =>
      prisma.product.findUniqueOrThrow({
        where: { id: productId },
        select: { stock: true, reservedStock: true, version: true },
      });

    const ledger = (productId: string) =>
      prisma.productStock.findMany({
        where: { productId },
        select: {
          locationId: true,
          organizationId: true,
          stock: true,
          reservedStock: true,
        },
      });

    it('installs the guard on Product and keeps the aggregate triggers', async () => {
      const rows = await prisma.$queryRaw<{ tgname: string }[]>`
        SELECT tgname FROM pg_trigger
        WHERE tgrelid = '"Product"'::regclass AND NOT tgisinternal
        ORDER BY tgname
      `;
      expect(rows.map(({ tgname }) => tgname)).toEqual(
        expect.arrayContaining([
          'Product_default_site_stock',
          'Product_guard_stock_aggregate',
        ]),
      );
      const stockTriggers = await prisma.$queryRaw<{ tgname: string }[]>`
        SELECT tgname FROM pg_trigger
        WHERE tgrelid = '"ProductStock"'::regclass AND NOT tgisinternal
      `;
      expect(stockTriggers.map(({ tgname }) => tgname)).toEqual([
        'ProductStock_aggregate_delta',
      ]);
    });

    it('rejects a direct stock write and leaves both balances untouched', async () => {
      const tenantRow = await tenant('direct-stock');
      expect(await aggregate(tenantRow.productId)).toEqual({
        stock: 5,
        reservedStock: 1,
        version: 0,
      });
      const before = {
        aggregate: await aggregate(tenantRow.productId),
        ledger: await ledger(tenantRow.productId),
      };

      // The raw statement every removed writer used to issue.
      await expect(
        prisma.$executeRaw`
          UPDATE "Product" SET "stock" = "stock" + 3
          WHERE "id" = ${tenantRow.productId}
        `,
      ).rejects.toMatchObject({
        code: 'P2010',
        meta: expect.objectContaining({ code: '23514' }),
      });

      // The ORM path is refused by the same trigger.
      await expect(
        prisma.product.update({
          where: { id: tenantRow.productId },
          data: { stock: { increment: 3 } },
        }),
      ).rejects.toThrow(/site balances in ProductStock own those values/);

      expect({
        aggregate: await aggregate(tenantRow.productId),
        ledger: await ledger(tenantRow.productId),
      }).toEqual(before);
    });

    it('rejects a direct reservation write and names the site ledger', async () => {
      const tenantRow = await tenant('direct-reserve');
      const before = {
        aggregate: await aggregate(tenantRow.productId),
        ledger: await ledger(tenantRow.productId),
      };

      await expect(
        prisma.product.update({
          where: { id: tenantRow.productId },
          data: { reservedStock: 0 },
        }),
      ).rejects.toThrow(
        /Product .* cannot change stock or reservedStock directly \(stock 5 -> 5, reservedStock 1 -> 0\)/,
      );

      expect({
        aggregate: await aggregate(tenantRow.productId),
        ledger: await ledger(tenantRow.productId),
      }).toEqual(before);
    });

    it('still allows an ordinary edit of any other Product column', async () => {
      const tenantRow = await tenant('ordinary-edit');
      await expect(
        prisma.product.update({
          where: { id: tenantRow.productId },
          data: {
            name: `${label} renamed`,
            salePrice: new Prisma.Decimal('25.50'),
            version: { increment: 1 },
            updatedAt: new Date(),
          },
        }),
      ).resolves.toMatchObject({
        name: `${label} renamed`,
        stock: 5,
        reservedStock: 1,
        version: 1,
      });
      expect(await ledger(tenantRow.productId)).toEqual([
        {
          locationId: tenantRow.defaultSiteId,
          organizationId: tenantRow.organizationId,
          stock: 5,
          reservedStock: 1,
        },
      ]);
    });

    it('keeps the shared helper as the writer: the aggregate follows its site row', async () => {
      const tenantRow = await tenant('helper');
      const result = await prisma.$transaction((tx) =>
        applySiteStockDelta(tx, {
          organizationId: tenantRow.organizationId,
          productId: tenantRow.productId,
          locationId: tenantRow.defaultSiteId,
          stockDelta: -2,
          reservedDelta: 1,
          requireAvailable: 1,
        }),
      );
      expect(result).toEqual({ applied: true, created: false });
      expect(await aggregate(tenantRow.productId)).toMatchObject({
        stock: 3,
        reservedStock: 2,
      });

      // A refused delta keeps the guard out of the picture entirely.
      const refused = await prisma.$transaction((tx) =>
        applySiteStockDelta(tx, {
          organizationId: tenantRow.organizationId,
          productId: tenantRow.productId,
          locationId: tenantRow.defaultSiteId,
          stockDelta: -4,
          reservedDelta: 0,
        }),
      );
      expect(refused).toEqual({
        applied: false,
        reason: 'insufficient-stock',
      });
      expect(await aggregate(tenantRow.productId)).toMatchObject({
        stock: 3,
        reservedStock: 2,
      });
    });

    it('follows a raw site-row write and a site-row delete', async () => {
      const tenantRow = await tenant('raw-ledger');
      const second = await prisma.location.create({
        data: {
          organizationId: tenantRow.organizationId,
          name: `${label} secondary`,
        },
      });

      await prisma.productStock.create({
        data: {
          productId: tenantRow.productId,
          locationId: second.id,
          organizationId: tenantRow.organizationId,
          stock: 4,
          reservedStock: 0,
        },
      });
      expect(await aggregate(tenantRow.productId)).toMatchObject({
        stock: 9,
        reservedStock: 1,
      });

      await prisma.productStock.delete({
        where: {
          productId_locationId: {
            productId: tenantRow.productId,
            locationId: second.id,
          },
        },
      });
      expect(await aggregate(tenantRow.productId)).toMatchObject({
        stock: 5,
        reservedStock: 1,
      });
    });

    it('keeps creating a product with a balance allowed, and seeds its site row', async () => {
      const tenantRow = await tenant('insert');
      const created = await prisma.product.create({
        data: {
          name: `${label} inserted`,
          sku: `${label}-${randomUUID()}`,
          costPrice: 10,
          salePrice: 20,
          stock: 7,
          reservedStock: 2,
          categoryId: tenantRow.categoryId,
          organizationId: tenantRow.organizationId,
        },
      });
      expect(await aggregate(created.id)).toMatchObject({
        stock: 7,
        reservedStock: 2,
      });
      expect(await ledger(created.id)).toEqual([
        {
          locationId: tenantRow.defaultSiteId,
          organizationId: tenantRow.organizationId,
          stock: 7,
          reservedStock: 2,
        },
      ]);
    });
  },
);
