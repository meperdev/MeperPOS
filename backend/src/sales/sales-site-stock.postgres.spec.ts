import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { OrgRole, PrismaClient } from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { SequenceService } from '../common/sequences/sequence.service';
import { CacheService } from '../common/services/cache.service';
import { SettingsService } from '../settings/settings.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { SalesService } from './sales.service';

/**
 * T3b — sales create/cancel against the per-site balance (real PostgreSQL).
 *
 * `ProductStock` is the site balance and the database trigger keeps
 * `Product.stock`/`reservedStock` equal to the sum of its site rows. These cases
 * drive the public service: a sale takes its units out of the site that
 * fulfils it — the explicit authorized origin, else the organization default
 * site — and cancelling it puts them back on that same site.
 *
 * The suite is bound to an explicitly provided disposable database and creates
 * its own uniquely named rows; it never migrates, resets or deletes anything it
 * did not create. Run it with `T3B_TEST_DATABASE_URL` pointing at a disposable
 * database that already has the migration applied, e.g.
 *
 *   T3B_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/meperpos_stock_rehearsal_w2_sales?schema=public \
 *     npx jest --runInBand src/sales/sales-site-stock.postgres.spec.ts
 */
const databaseUrl = process.env.T3B_TEST_DATABASE_URL;

interface TenantFixture {
  organizationId: string;
  categoryId: string;
  actor: RequestUser;
  productId: string;
  defaultSiteId: string;
}

(databaseUrl ? describe : describe.skip)(
  'Sales at the site balance (real PostgreSQL)',
  () => {
    const label = `t3b-${randomUUID()}`;
    const organizations: string[] = [];
    let prisma: PrismaClient;
    let service: SalesService;

    beforeAll(() => {
      const url = new URL(databaseUrl!);
      if (
        url.protocol !== 'postgresql:' ||
        url.hostname !== '127.0.0.1' ||
        !url.port ||
        url.port === '5432' ||
        url.search !== '?schema=public' ||
        !/^\/meperpos_stock_rehearsal_w2_sales[a-z0-9_]*$/.test(url.pathname)
      ) {
        throw new Error(
          'Expected an explicit disposable T3b PostgreSQL database',
        );
      }
      prisma = new PrismaClient({ datasourceUrl: url.href });
      service = new SalesService(
        prisma as never,
        new CacheService(),
        new SettingsService(
          prisma as never,
          {
            uploadImage: jest.fn(),
          } as never,
        ),
        new SequenceService(),
        new ReceiptsService(),
      );
    });

    afterAll(async () => {
      if (!prisma) return;
      try {
        const scope = { organizationId: { in: organizations } };
        await prisma.inventoryMovement.deleteMany({ where: scope });
        await prisma.payment.deleteMany({ where: scope });
        await prisma.saleItem.deleteMany({ where: scope });
        await prisma.fiscalDocument.deleteMany({ where: scope });
        await prisma.sale.deleteMany({ where: scope });
        await prisma.organization.deleteMany({
          where: { id: { in: organizations } },
        });
      } finally {
        await prisma.$disconnect();
      }
    });

    /**
     * A fresh tenant: its trigger-created default site, one category, one
     * ADMIN member with a live membership, a SALE counter and one tracked
     * product opened at the default site.
     */
    async function openTenant(
      tag: string,
      product: { stock?: number; reservedStock?: number } = {},
    ): Promise<TenantFixture> {
      const unique = `${label}-${tag}-${randomUUID()}`;
      const organization = await prisma.organization.create({
        data: { name: unique, slug: unique },
      });
      organizations.push(organization.id);

      const user = await prisma.user.create({
        data: {
          email: `${unique}@example.com`,
          password: 'hash',
          name: `Actor ${tag}`,
          tokenVersion: 0,
        },
      });
      await prisma.organizationUser.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          role: OrgRole.ADMIN,
        },
      });
      const category = await prisma.category.create({
        data: { name: unique, organizationId: organization.id },
      });
      await prisma.organizationSequence.create({
        data: {
          organizationId: organization.id,
          type: 'SALE',
          prefix: 'REC',
          currentNumber: 0,
          year: new Date().getFullYear(),
        },
      });
      // What the provisioning service creates for a real tenant; a direct SQL
      // tenant gets it lazily, when its first product opens its site row.
      const defaultSite = await prisma.location.create({
        data: {
          organizationId: organization.id,
          name: 'Sede principal',
          isDefault: true,
        },
      });
      const created = await prisma.product.create({
        data: {
          organizationId: organization.id,
          categoryId: category.id,
          sku: randomUUID(),
          name: unique,
          costPrice: 500,
          salePrice: 1000,
          taxRate: 0,
          stock: product.stock ?? 0,
          reservedStock: product.reservedStock ?? 0,
        },
      });

      return {
        organizationId: organization.id,
        categoryId: category.id,
        productId: created.id,
        defaultSiteId: defaultSite.id,
        actor: {
          userId: user.id,
          email: user.email,
          organizationId: organization.id,
          role: OrgRole.ADMIN,
          tokenVersion: 0,
          isSuperAdmin: false,
        },
      };
    }

    /** A second, non-default site with its own balance for one product. */
    async function openWarehouse(
      shop: TenantFixture,
      stock: number,
      reservedStock = 0,
    ) {
      const site = await prisma.location.create({
        data: {
          organizationId: shop.organizationId,
          name: `${label}-bodega-${randomUUID()}`,
        },
      });
      await prisma.productStock.create({
        data: {
          productId: shop.productId,
          locationId: site.id,
          organizationId: shop.organizationId,
          stock,
          reservedStock,
        },
      });
      return site.id;
    }

    const siteRowAt = (productId: string, locationId: string) =>
      prisma.productStock.findUniqueOrThrow({
        where: { productId_locationId: { productId, locationId } },
      });

    const aggregate = (productId: string) =>
      prisma.product.findUniqueOrThrow({
        where: { id: productId },
        select: { stock: true, reservedStock: true, version: true },
      });

    /** The invariant after every write: Product is its site rows' sum. */
    async function expectAggregateMatchesSites(productId: string) {
      const rows = await prisma.productStock.findMany({ where: { productId } });
      expect(rows.length).toBeGreaterThan(0);
      const sum = rows.reduce(
        (total, row) => ({
          stock: total.stock + row.stock,
          reservedStock: total.reservedStock + row.reservedStock,
        }),
        { stock: 0, reservedStock: 0 },
      );
      const product = await aggregate(productId);
      expect({
        stock: product.stock,
        reservedStock: product.reservedStock,
      }).toEqual(sum);
    }

    function sell(
      shop: TenantFixture,
      quantity: number,
      extra: { locationId?: string; requestKey?: string } = {},
      actor: RequestUser = shop.actor,
    ) {
      return service.create(
        {
          items: [{ productId: shop.productId, quantity }],
          payments: [{ method: 'CASH' as const, amount: 1000 * quantity }],
          ...extra,
        },
        actor.userId,
        shop.organizationId,
        actor,
      );
    }

    /**
     * A cashier whose whole assignment is one site. The principal-site grant the
     * membership baseline installs is removed, which is what an administrator
     * replacing the set leaves behind.
     */
    async function restrictedCashier(
      shop: TenantFixture,
      locationId: string,
    ): Promise<RequestUser> {
      const email = `${label}-cashier-${randomUUID()}@example.com`;
      const user = await prisma.user.create({
        data: {
          email,
          password: 'hash',
          name: `Cashier ${label}`,
          tokenVersion: 0,
        },
      });
      await prisma.organizationUser.create({
        data: {
          userId: user.id,
          organizationId: shop.organizationId,
          role: OrgRole.CASHIER,
        },
      });
      await prisma.membershipLocation.deleteMany({
        where: { userId: user.id },
      });
      await prisma.membershipLocation.create({
        data: {
          userId: user.id,
          organizationId: shop.organizationId,
          locationId,
        },
      });
      return {
        userId: user.id,
        email,
        organizationId: shop.organizationId,
        role: OrgRole.CASHIER,
        tokenVersion: 0,
        isSuperAdmin: false,
      };
    }

    const cancel = (shop: TenantFixture, saleId: string) =>
      service.update(
        saleId,
        { status: 'CANCELLED' },
        shop.actor.userId,
        shop.organizationId,
        shop.actor,
      );

    const movementsOf = (saleId: string) =>
      prisma.inventoryMovement.findMany({
        where: { saleId },
        orderBy: { type: 'asc' },
        select: {
          type: true,
          quantity: true,
          previousStock: true,
          newStock: true,
          locationId: true,
        },
      });

    const snapshot = async (shop: TenantFixture) => {
      const scope = { organizationId: shop.organizationId };
      return {
        sales: await prisma.sale.count({ where: scope }),
        movements: await prisma.inventoryMovement.count({ where: scope }),
        sites: await prisma.productStock.findMany({
          where: { productId: shop.productId },
          orderBy: { locationId: 'asc' },
          select: { locationId: true, stock: true, reservedStock: true },
        }),
        product: await aggregate(shop.productId),
        counter: await prisma.organizationSequence.findFirstOrThrow({
          where: { ...scope, type: 'SALE' },
          select: { currentNumber: true },
        }),
      };
    };

    it('takes the sold units out of the organization default site', async () => {
      const shop = await openTenant('default', { stock: 10 });

      const sale = await sell(shop, 3);

      await expect(
        siteRowAt(shop.productId, shop.defaultSiteId),
      ).resolves.toMatchObject({ stock: 7, reservedStock: 0 });
      // A sale without an explicit site keeps its legacy shape: it stores no
      // origin, and its movement still names the site that fulfilled it.
      await expect(
        prisma.saleOriginSite.findFirst({ where: { saleId: sale.id } }),
      ).resolves.toBeNull();
      await expect(movementsOf(sale.id)).resolves.toEqual([
        {
          type: 'SALE',
          quantity: -3,
          previousStock: 10,
          newStock: 7,
          locationId: shop.defaultSiteId,
        },
      ]);
      await expect(aggregate(shop.productId)).resolves.toMatchObject({
        stock: 7,
        version: 1,
      });
      await expectAggregateMatchesSites(shop.productId);
    });

    it("keeps a second site's balance untouched", async () => {
      const shop = await openTenant('second-site', { stock: 4 });
      const warehouseId = await openWarehouse(shop, 6);
      await expect(aggregate(shop.productId)).resolves.toMatchObject({
        stock: 10,
      });

      await sell(shop, 2);

      await expect(
        siteRowAt(shop.productId, shop.defaultSiteId),
      ).resolves.toMatchObject({ stock: 2, reservedStock: 0 });
      await expect(
        siteRowAt(shop.productId, warehouseId),
      ).resolves.toMatchObject({ stock: 6, reservedStock: 0 });
      await expect(aggregate(shop.productId)).resolves.toMatchObject({
        stock: 8,
      });
      await expectAggregateMatchesSites(shop.productId);
    });

    it('refuses to over-draw the site even when another site holds the stock', async () => {
      const shop = await openTenant('over-draw', { stock: 1 });
      await openWarehouse(shop, 9);
      const before = await snapshot(shop);

      await expect(sell(shop, 2)).rejects.toBeInstanceOf(ConflictException);
      await expect(sell(shop, 2)).rejects.toMatchObject({
        status: 409,
        message: `Insufficient stock for product ${shop.productId}`,
      });
      expect(await snapshot(shop)).toEqual(before);
    });

    it("counts only the site's availability, not the organization aggregate", async () => {
      const shop = await openTenant('availability', {
        stock: 10,
        reservedStock: 4,
      });
      const before = await snapshot(shop);

      // 10 on the site with 4 reserved: only 6 are sellable there.
      await expect(sell(shop, 7)).rejects.toMatchObject({
        status: 409,
        message: `Insufficient stock for product ${shop.productId}`,
      });
      expect(await snapshot(shop)).toEqual(before);

      await sell(shop, 6);
      await expect(
        siteRowAt(shop.productId, shop.defaultSiteId),
      ).resolves.toMatchObject({ stock: 4, reservedStock: 4 });
      await expectAggregateMatchesSites(shop.productId);
    });

    it('restores the default site when an unattributed sale is cancelled', async () => {
      const shop = await openTenant('cancel-default', { stock: 5 });
      const sale = await sell(shop, 2);
      await expect(
        siteRowAt(shop.productId, shop.defaultSiteId),
      ).resolves.toMatchObject({ stock: 3 });

      await expect(cancel(shop, sale.id)).resolves.toMatchObject({
        status: 'CANCELLED',
      });

      await expect(
        siteRowAt(shop.productId, shop.defaultSiteId),
      ).resolves.toMatchObject({ stock: 5, reservedStock: 0 });
      const movements = await movementsOf(sale.id);
      expect(movements).toHaveLength(2);
      expect(movements).toEqual(
        expect.arrayContaining([
          {
            type: 'SALE',
            quantity: -2,
            previousStock: 5,
            newStock: 3,
            locationId: shop.defaultSiteId,
          },
          {
            type: 'RETURN',
            quantity: 2,
            previousStock: 3,
            newStock: 5,
            locationId: shop.defaultSiteId,
          },
        ]),
      );
      await expect(aggregate(shop.productId)).resolves.toMatchObject({
        stock: 5,
        version: 2,
      });
      await expectAggregateMatchesSites(shop.productId);
    });

    it("restores the sale's stored origin and keeps a later site untouched", async () => {
      const shop = await openTenant('cancel-origin', { stock: 5 });
      const sale = await sell(shop, 2, { locationId: shop.defaultSiteId });
      await expect(
        prisma.saleOriginSite.findFirstOrThrow({ where: { saleId: sale.id } }),
      ).resolves.toMatchObject({
        organizationId: shop.organizationId,
        locationId: shop.defaultSiteId,
      });
      // A second site opened after the sale: cancelling must not move it.
      const warehouseId = await openWarehouse(shop, 0);

      await cancel(shop, sale.id);

      await expect(
        siteRowAt(shop.productId, shop.defaultSiteId),
      ).resolves.toMatchObject({ stock: 5 });
      await expect(
        siteRowAt(shop.productId, warehouseId),
      ).resolves.toMatchObject({ stock: 0, reservedStock: 0 });
      const movements = await movementsOf(sale.id);
      expect(movements).toHaveLength(2);
      expect(movements).toEqual(
        expect.arrayContaining([
          {
            type: 'SALE',
            quantity: -2,
            previousStock: 5,
            newStock: 3,
            locationId: shop.defaultSiteId,
          },
          {
            type: 'RETURN',
            quantity: 2,
            previousStock: 3,
            newStock: 5,
            locationId: shop.defaultSiteId,
          },
        ]),
      );
      await expectAggregateMatchesSites(shop.productId);
    });

    it('keeps the request-key replay read-only', async () => {
      const shop = await openTenant('replay', { stock: 10 });
      const first = await sell(shop, 1, { requestKey: 'venta-replay-0001' });
      const after = await snapshot(shop);

      await expect(
        sell(shop, 1, { requestKey: 'venta-replay-0001' }),
      ).resolves.toMatchObject({ id: first.id, saleNumber: first.saleNumber });
      expect(await snapshot(shop)).toEqual(after);
      await expect(movementsOf(first.id)).resolves.toHaveLength(1);
    });

    it('applies one delta per repeated line of the same product', async () => {
      const shop = await openTenant('repeated', { stock: 10 });
      const sale = await service.create(
        {
          items: [
            { productId: shop.productId, quantity: 1 },
            { productId: shop.productId, quantity: 2 },
          ],
          payments: [{ method: 'CASH' as const, amount: 3000 }],
        },
        shop.actor.userId,
        shop.organizationId,
        shop.actor,
      );

      await expect(
        siteRowAt(shop.productId, shop.defaultSiteId),
      ).resolves.toMatchObject({ stock: 7 });
      const movements = await movementsOf(sale.id);
      expect(movements).toHaveLength(2);
      expect(movements).toEqual(
        expect.arrayContaining([
          {
            type: 'SALE',
            quantity: -1,
            previousStock: 10,
            newStock: 9,
            locationId: shop.defaultSiteId,
          },
          {
            type: 'SALE',
            quantity: -2,
            previousStock: 9,
            newStock: 7,
            locationId: shop.defaultSiteId,
          },
        ]),
      );
      await expectAggregateMatchesSites(shop.productId);
    });

    it('sells a service without touching any site balance', async () => {
      const shop = await openTenant('service');
      const attendant = await prisma.product.create({
        data: {
          organizationId: shop.organizationId,
          categoryId: shop.categoryId,
          sku: randomUUID(),
          name: `${label}-servicio-${randomUUID()}`,
          costPrice: 0,
          salePrice: 20000,
          taxRate: 0,
          type: 'SERVICE',
          tracksStock: false,
        },
      });

      const sale = await service.create(
        {
          items: [{ productId: attendant.id, quantity: 2 }],
          payments: [{ method: 'CASH' as const, amount: 40000 }],
        },
        shop.actor.userId,
        shop.organizationId,
        shop.actor,
      );

      await expect(movementsOf(sale.id)).resolves.toEqual([]);
      await expect(
        prisma.productStock.findMany({ where: { productId: attendant.id } }),
      ).resolves.toEqual([
        expect.objectContaining({ stock: 0, reservedStock: 0 }),
      ]);
    });

    it('authorizes the implicit default site like an explicit one', async () => {
      const shop = await openTenant('implicit-grant', { stock: 10 });
      const otherSiteId = await openWarehouse(shop, 0);
      // Assigned to another site only: the default site is not hers.
      const cashier = await restrictedCashier(shop, otherSiteId);
      const before = await snapshot(shop);

      await expect(sell(shop, 1, {}, cashier)).rejects.toMatchObject({
        status: 404,
        message: 'Location not found',
      });
      await expect(snapshot(shop)).resolves.toEqual(before);

      // The legacy no-site request keeps working, byte for byte, once an
      // administrator assigns the principal site.
      await prisma.membershipLocation.create({
        data: {
          userId: cashier.userId,
          organizationId: shop.organizationId,
          locationId: shop.defaultSiteId,
        },
      });
      const sale = await sell(shop, 1, {}, cashier);

      await expect(
        prisma.saleOriginSite.findFirst({ where: { saleId: sale.id } }),
      ).resolves.toBeNull();
      await expect(
        siteRowAt(shop.productId, shop.defaultSiteId),
      ).resolves.toMatchObject({ stock: 9, reservedStock: 0 });
      await expect(movementsOf(sale.id)).resolves.toEqual([
        expect.objectContaining({
          type: 'SALE',
          quantity: -1,
          locationId: shop.defaultSiteId,
        }),
      ]);
      await expectAggregateMatchesSites(shop.productId);
    });
  },
);
