import { randomUUID } from 'node:crypto';
import { OrgRole, PrismaClient } from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { LocationsService } from '../locations/locations.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { StockAdjustmentDto } from './dto/stock-adjustment.dto';

/**
 * T22 — per-site inventory read and per-site stock adjustment (real PostgreSQL).
 *
 * The inventory screen needs two things the organization aggregate cannot
 * answer: how many units this product holds at each site the caller may read,
 * and a way to move one site's balance without sending the whole organization
 * delta to the principal site. Products with more than one site therefore stop
 * accepting an absolute `stock` edit and answer a Spanish 409 pointing at the
 * per-site adjustment; a single-site organization keeps that edit exactly as it
 * was.
 *
 * The suite is bound to an explicitly provided disposable database and creates
 * its own uniquely named rows; it never migrates, resets or deletes anything it
 * did not create. Run it with `T22_TEST_DATABASE_URL` pointing at a disposable
 * database that already has the migration applied, e.g.
 *
 *   T22_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/meperpos_stock_rehearsal_t22_reads?schema=public \
 *     npx jest --runInBand src/products/products.stock-by-site.postgres.spec.ts
 */
const databaseUrl = process.env.T22_TEST_DATABASE_URL;

const USER_SHAPE = { tokenVersion: 0, isSuperAdmin: false } as const;

interface Site {
  id: string;
  name: string;
}

interface Fixture {
  organizationId: string;
  principal: Site;
  warehouse: Site;
  north: Site;
  foreignOrganizationId: string;
  foreignSiteId: string;
  foreignProductId: string;
  owner: RequestUser;
  cashier: RequestUser;
  unassigned: RequestUser;
  stockedId: string;
  serviceId: string;
  untrackedId: string;
}

const MESSAGES = {
  multiSite:
    'Esta organización tiene más de una sede: ajusta las existencias por sede en lugar de editar el stock total',
  refused:
    'La sede no puede absorber el ajuste: quedaría por debajo de lo reservado o sin existencias',
  notTracked:
    'Solo los productos que manejan inventario pueden ajustar existencias por sede',
  reason: 'El motivo del ajuste es obligatorio',
} as const;

(databaseUrl ? describe : describe.skip)(
  'Per-site inventory read and adjustment (real PostgreSQL)',
  () => {
    const label = `t22-stock-${randomUUID()}`;
    let prisma: PrismaClient;
    let products: ProductsService;
    let controller: ProductsController;
    let fixture: Fixture;

    beforeAll(async () => {
      const url = new URL(databaseUrl!);
      if (
        url.protocol !== 'postgresql:' ||
        url.hostname !== '127.0.0.1' ||
        !url.port ||
        url.port === '5432' ||
        url.search !== '?schema=public' ||
        !/^\/meperpos_stock_rehearsal_t22[a-z0-9_]*$/.test(url.pathname)
      ) {
        throw new Error(
          'Expected an explicit disposable T22 PostgreSQL database',
        );
      }
      prisma = new PrismaClient({ datasourceUrl: url.href });
      const prismaService = prisma as unknown as PrismaService;
      products = new ProductsService(
        prismaService,
        { uploadImage: jest.fn() } as never,
        { invalidateCache: jest.fn() } as never,
      );
      const locations = new LocationsService(prismaService);
      controller = new ProductsController(products, locations);

      const unique = `${label}-${randomUUID()}`;
      const organization = await prisma.organization.create({
        data: { name: unique, slug: unique },
      });
      const principal = await prisma.location.create({
        data: {
          organizationId: organization.id,
          name: 'Principal',
          isDefault: true,
        },
      });
      const warehouse = await prisma.location.create({
        data: {
          organizationId: organization.id,
          name: 'Bodega',
          type: 'WAREHOUSE',
        },
      });
      const north = await prisma.location.create({
        data: { organizationId: organization.id, name: 'Norte' },
      });
      const category = await prisma.category.create({
        data: { name: unique, organizationId: organization.id },
      });
      const owner = await prisma.user.create({
        data: {
          email: `${unique}-owner@example.com`,
          password: 'not-a-real-hash',
          name: 'T22 owner',
          tokenVersion: 0,
        },
      });
      const cashier = await prisma.user.create({
        data: {
          email: `${unique}-cashier@example.com`,
          password: 'not-a-real-hash',
          name: 'T22 cashier',
          tokenVersion: 0,
        },
      });
      const unassigned = await prisma.user.create({
        data: {
          email: `${unique}-member@example.com`,
          password: 'not-a-real-hash',
          name: 'T22 member',
          tokenVersion: 0,
        },
      });
      await prisma.organizationUser.create({
        data: {
          userId: owner.id,
          organizationId: organization.id,
          role: OrgRole.ADMIN,
        },
      });
      await prisma.organizationUser.create({
        data: {
          userId: cashier.id,
          organizationId: organization.id,
          role: OrgRole.CASHIER,
        },
      });
      await prisma.organizationUser.create({
        data: {
          userId: unassigned.id,
          organizationId: organization.id,
          role: OrgRole.CASHIER,
        },
      });
      // The principal-site grant trigger gives every new operational membership
      // the principal site (S3 baseline). This suite models an administrator who
      // then narrowed the access: the cashier works the warehouse only, and the
      // member was left with no site at all — which is not the same as every
      // site.
      await prisma.membershipLocation.deleteMany({
        where: {
          organizationId: organization.id,
          userId: { in: [cashier.id, unassigned.id] },
        },
      });
      await prisma.membershipLocation.create({
        data: {
          userId: cashier.id,
          organizationId: organization.id,
          locationId: warehouse.id,
        },
      });

      const foreign = await prisma.organization.create({
        data: { name: `${unique}-foreign`, slug: `${unique}-foreign` },
      });
      const foreignSite = await prisma.location.create({
        data: {
          organizationId: foreign.id,
          name: 'Principal',
          isDefault: true,
        },
      });
      const foreignCategory = await prisma.category.create({
        data: { name: `${unique}-foreign`, organizationId: foreign.id },
      });
      const foreignProduct = await prisma.product.create({
        data: {
          name: `${unique}-foreign`,
          sku: `${unique}-foreign-sku`,
          costPrice: 100,
          salePrice: 200,
          stock: 9,
          minStock: 0,
          categoryId: foreignCategory.id,
          organizationId: foreign.id,
        },
      });

      const createProduct = async (input: {
        suffix: string;
        stock?: number;
        type?: 'PRODUCT' | 'SERVICE';
        tracksStock?: boolean;
      }) =>
        prisma.product.create({
          data: {
            name: `${unique}-${input.suffix}`,
            sku: `${unique}-${input.suffix}-sku`,
            costPrice: 100,
            salePrice: 200,
            stock: input.stock ?? 0,
            minStock: 0,
            type: input.type ?? 'PRODUCT',
            tracksStock: input.tracksStock ?? true,
            categoryId: category.id,
            organizationId: organization.id,
          },
        });

      // Five units at the principal site through the insert trigger, plus three
      // at the warehouse — one of them reserved. The aggregate is therefore 8/1.
      const stocked = await createProduct({ suffix: 'stocked', stock: 5 });
      await prisma.productStock.create({
        data: {
          organizationId: organization.id,
          productId: stocked.id,
          locationId: warehouse.id,
          stock: 3,
          reservedStock: 1,
        },
      });
      const service = await createProduct({
        suffix: 'service',
        type: 'SERVICE',
        tracksStock: false,
      });
      const untracked = await createProduct({
        suffix: 'untracked',
        tracksStock: false,
      });

      fixture = {
        organizationId: organization.id,
        principal,
        warehouse,
        north,
        foreignOrganizationId: foreign.id,
        foreignSiteId: foreignSite.id,
        foreignProductId: foreignProduct.id,
        owner: {
          userId: owner.id,
          email: owner.email,
          organizationId: organization.id,
          role: OrgRole.ADMIN,
          ...USER_SHAPE,
        },
        cashier: {
          userId: cashier.id,
          email: cashier.email,
          organizationId: organization.id,
          role: OrgRole.CASHIER,
          ...USER_SHAPE,
        },
        unassigned: {
          userId: unassigned.id,
          email: unassigned.email,
          organizationId: organization.id,
          role: OrgRole.CASHIER,
          ...USER_SHAPE,
        },
        stockedId: stocked.id,
        serviceId: service.id,
        untrackedId: untracked.id,
      };
    });

    afterAll(async () => {
      if (!prisma) return;
      // Movements are immutable by trigger, so the rows this suite created stay
      // as evidence in the disposable database. Every run uses fresh ids.
      await prisma.$disconnect();
    });

    const adjustment = (
      overrides: Partial<StockAdjustmentDto> = {},
    ): StockAdjustmentDto =>
      Object.assign(new StockAdjustmentDto(), {
        locationId: fixture.warehouse.id,
        quantity: 1,
        reason: 'Conteo físico',
        ...overrides,
      });

    const aggregate = (productId = fixture.stockedId) =>
      prisma.product.findUniqueOrThrow({
        where: { id: productId },
        select: { stock: true, reservedStock: true, version: true },
      });

    const siteRow = (locationId: string, productId = fixture.stockedId) =>
      prisma.productStock.findUnique({
        where: { productId_locationId: { productId, locationId } },
      });

    const movements = (productId = fixture.stockedId) =>
      prisma.inventoryMovement.findMany({
        where: { productId },
        orderBy: { createdAt: 'asc' },
        select: {
          type: true,
          quantity: true,
          previousStock: true,
          newStock: true,
          reason: true,
          locationId: true,
          userId: true,
        },
      });

    describe('GET /api/products/:id/stock-by-site', () => {
      it('breaks the balance down over every site an owner can read, with a missing row as zero', async () => {
        const breakdown = await controller.stockBySite(
          fixture.stockedId,
          fixture.owner,
        );

        expect(breakdown).toEqual([
          {
            locationId: fixture.principal.id,
            name: 'Principal',
            type: 'STORE',
            isDefault: true,
            stock: 5,
            reservedStock: 0,
            availableStock: 5,
          },
          {
            locationId: fixture.warehouse.id,
            name: 'Bodega',
            type: 'WAREHOUSE',
            isDefault: false,
            stock: 3,
            reservedStock: 1,
            availableStock: 2,
          },
          {
            // No ProductStock row at this site yet: zero units, not missing.
            locationId: fixture.north.id,
            name: 'Norte',
            type: 'STORE',
            isDefault: false,
            stock: 0,
            reservedStock: 0,
            availableStock: 0,
          },
        ]);
      });

      it('only lists the sites a restricted membership was assigned', async () => {
        await expect(
          controller.stockBySite(fixture.stockedId, fixture.cashier),
        ).resolves.toEqual([
          {
            locationId: fixture.warehouse.id,
            name: 'Bodega',
            type: 'WAREHOUSE',
            isDefault: false,
            stock: 3,
            reservedStock: 1,
            availableStock: 2,
          },
        ]);

        // Zero assignments never mean every site.
        await expect(
          controller.stockBySite(fixture.stockedId, fixture.unassigned),
        ).resolves.toEqual([]);
      });

      it('404s a product outside the tenant and an unknown product', async () => {
        await expect(
          controller.stockBySite(fixture.foreignProductId, fixture.owner),
        ).rejects.toMatchObject({
          status: 404,
          message: 'Product not found',
        });
        await expect(
          controller.stockBySite(randomUUID(), fixture.owner),
        ).rejects.toMatchObject({
          status: 404,
          message: 'Product not found',
        });
      });
    });

    describe('POST /api/products/:id/stock-adjustments', () => {
      it('adjusts one site up with a single attributed movement and the aggregate as the sum', async () => {
        const before = await aggregate();
        expect(before).toMatchObject({ stock: 8, reservedStock: 1 });

        const result = await products.adjustSiteStock(
          fixture.stockedId,
          adjustment({ locationId: fixture.warehouse.id, quantity: 4 }),
          fixture.owner,
        );

        await expect(siteRow(fixture.warehouse.id)).resolves.toMatchObject({
          stock: 7,
          reservedStock: 1,
        });
        await expect(siteRow(fixture.principal.id)).resolves.toMatchObject({
          stock: 5,
        });
        await expect(aggregate()).resolves.toMatchObject({
          stock: 12,
          reservedStock: 1,
          version: before.version + 1,
        });
        expect(result).toMatchObject({
          product: { id: fixture.stockedId, stock: 12 },
          site: {
            locationId: fixture.warehouse.id,
            stock: 7,
            reservedStock: 1,
            availableStock: 6,
          },
        });
        const [movement, ...rest] = await movements();
        expect(rest).toEqual([]);
        expect(movement).toEqual({
          type: 'ADJUSTMENT_IN',
          quantity: 4,
          // The movement explains the organization aggregate it moved.
          previousStock: 8,
          newStock: 12,
          reason: 'Conteo físico',
          locationId: fixture.warehouse.id,
          userId: fixture.owner.userId,
        });
      });

      it('adjusts one site down, and refuses a drop below that site reservations without writing anything', async () => {
        const before = {
          product: await aggregate(),
          warehouse: await siteRow(fixture.warehouse.id),
          north: await siteRow(fixture.north.id),
          movements: await prisma.inventoryMovement.count({
            where: { productId: fixture.stockedId },
          }),
        };

        // A site cannot go below its own reservations, whatever the aggregate
        // could pay for: build the drop from the live row so the case holds
        // whatever the earlier adjustments left behind.
        const held = await siteRow(fixture.warehouse.id);
        expect(held?.reservedStock).toBeGreaterThan(0);
        const overdraw = -held!.stock;

        await expect(
          products.adjustSiteStock(
            fixture.stockedId,
            adjustment({ quantity: overdraw }),
            fixture.owner,
          ),
        ).rejects.toMatchObject({ status: 409, message: MESSAGES.refused });

        expect(await aggregate()).toEqual(before.product);
        expect(await siteRow(fixture.warehouse.id)).toEqual(before.warehouse);
        expect(await siteRow(fixture.north.id)).toEqual(before.north);
        await expect(
          prisma.inventoryMovement.count({
            where: { productId: fixture.stockedId },
          }),
        ).resolves.toBe(before.movements);

        // Two units still leave cleanly: stock minus two, and one
        // ADJUSTMENT_OUT appended to the same site.
        const beforeDrop = await aggregate();
        const countBeforeDrop = (await movements()).length;
        await products.adjustSiteStock(
          fixture.stockedId,
          adjustment({ quantity: -2, reason: '  Merma  ' }),
          fixture.owner,
        );
        await expect(siteRow(fixture.warehouse.id)).resolves.toMatchObject({
          stock: held!.stock - 2,
          reservedStock: 1,
        });
        await expect(aggregate()).resolves.toMatchObject({
          stock: beforeDrop.stock - 2,
          reservedStock: 1,
        });
        const trail = await movements();
        expect(trail).toHaveLength(countBeforeDrop + 1);
        expect(trail[trail.length - 1]).toEqual({
          type: 'ADJUSTMENT_OUT',
          quantity: -2,
          previousStock: beforeDrop.stock,
          newStock: beforeDrop.stock - 2,
          // Trimmed: the stored reason carries no stray whitespace.
          reason: 'Merma',
          locationId: fixture.warehouse.id,
          userId: fixture.owner.userId,
        });
      });

      it('opens a site row that never carried the product', async () => {
        await products.adjustSiteStock(
          fixture.stockedId,
          adjustment({ locationId: fixture.north.id, quantity: 3 }),
          fixture.owner,
        );

        await expect(siteRow(fixture.north.id)).resolves.toMatchObject({
          stock: 3,
          reservedStock: 0,
        });
        // The aggregate is the sum of its site rows after the write.
        const rows = await prisma.productStock.findMany({
          where: { productId: fixture.stockedId },
        });
        expect(await aggregate()).toMatchObject({
          stock: rows.reduce((total, row) => total + row.stock, 0),
          reservedStock: rows.reduce(
            (total, row) => total + row.reservedStock,
            0,
          ),
        });
      });

      it('404s an unauthorized or foreign site and writes nothing', async () => {
        const before = {
          product: await aggregate(),
          principal: await siteRow(fixture.principal.id),
          warehouse: await siteRow(fixture.warehouse.id),
          movements: await prisma.inventoryMovement.count({
            where: { productId: fixture.stockedId },
          }),
        };

        // The cashier works the warehouse only; the principal site is not hers.
        await expect(
          products.adjustSiteStock(
            fixture.stockedId,
            adjustment({ locationId: fixture.principal.id, quantity: 1 }),
            fixture.cashier,
          ),
        ).rejects.toMatchObject({
          status: 404,
          message: 'Location not found',
        });
        // A member with no assignment at all.
        await expect(
          products.adjustSiteStock(
            fixture.stockedId,
            adjustment({ locationId: fixture.warehouse.id, quantity: 1 }),
            fixture.unassigned,
          ),
        ).rejects.toMatchObject({
          status: 404,
          message: 'Location not found',
        });
        // An owner naming another tenant's site.
        await expect(
          products.adjustSiteStock(
            fixture.stockedId,
            adjustment({ locationId: fixture.foreignSiteId, quantity: 1 }),
            fixture.owner,
          ),
        ).rejects.toMatchObject({
          status: 404,
          message: 'Location not found',
        });
        // Another tenant's product is never reachable, whatever the site.
        await expect(
          products.adjustSiteStock(
            fixture.foreignProductId,
            adjustment({ quantity: 1 }),
            fixture.owner,
          ),
        ).rejects.toMatchObject({
          status: 404,
          message: 'Product not found',
        });

        expect(await aggregate()).toEqual(before.product);
        expect(await siteRow(fixture.principal.id)).toEqual(before.principal);
        expect(await siteRow(fixture.warehouse.id)).toEqual(before.warehouse);
        await expect(
          prisma.inventoryMovement.count({
            where: { productId: fixture.stockedId },
          }),
        ).resolves.toBe(before.movements);
      });

      it('refuses a product that does not track stock and an empty reason', async () => {
        for (const productId of [fixture.serviceId, fixture.untrackedId]) {
          await expect(
            products.adjustSiteStock(
              productId,
              adjustment({ quantity: 1 }),
              fixture.owner,
            ),
          ).rejects.toMatchObject({
            status: 400,
            message: MESSAGES.notTracked,
          });
        }

        await expect(
          products.adjustSiteStock(
            fixture.stockedId,
            adjustment({ quantity: 1, reason: '   ' }),
            fixture.owner,
          ),
        ).rejects.toMatchObject({ status: 400, message: MESSAGES.reason });
        await expect(
          products.adjustSiteStock(
            fixture.stockedId,
            adjustment({ quantity: 0 }),
            fixture.owner,
          ),
        ).rejects.toMatchObject({
          status: 400,
          message: 'El ajuste debe mover al menos una unidad',
        });
      });
    });

    describe('PATCH-absolute stock edit', () => {
      it('refuses an absolute stock edit in an organization with more than one site', async () => {
        const before = {
          product: await aggregate(),
          principal: await siteRow(fixture.principal.id),
          warehouse: await siteRow(fixture.warehouse.id),
          movements: await prisma.inventoryMovement.count({
            where: { productId: fixture.stockedId },
          }),
        };

        await expect(
          products.update(
            fixture.stockedId,
            { stock: 20 },
            fixture.owner.userId,
            fixture.organizationId,
          ),
        ).rejects.toMatchObject({
          status: 409,
          message: MESSAGES.multiSite,
        });

        expect(await aggregate()).toEqual(before.product);
        expect(await siteRow(fixture.principal.id)).toEqual(before.principal);
        expect(await siteRow(fixture.warehouse.id)).toEqual(before.warehouse);
        await expect(
          prisma.inventoryMovement.count({
            where: { productId: fixture.stockedId },
          }),
        ).resolves.toBe(before.movements);

        // Sending the current aggregate is not a change, so the ordinary edit
        // still works: only a stock *change* is redirected to the per-site
        // adjustment.
        const current = before.product.stock;
        const renamed = await products.update(
          fixture.stockedId,
          { name: `${label}-renamed`, stock: current },
          fixture.owner.userId,
          fixture.organizationId,
        );
        expect(renamed).toMatchObject({
          name: `${label}-renamed`,
          stock: current,
        });
        await expect(aggregate()).resolves.toMatchObject({
          stock: current,
          version: before.product.version + 1,
        });
      });

      it('still lets a multi-site organization stop counting a product', async () => {
        // The declared stock of an untracked product is zero, so the payload of
        // a conversion carries `stock: 0`. That is the consequence of the type
        // change, not an absolute stock edit: the refusal above must not turn a
        // legitimate conversion into a dead end.
        const unique = `${label}-conversion-${randomUUID()}`;
        const convertible = await prisma.product.create({
          data: {
            name: unique,
            sku: `${unique}-sku`,
            costPrice: 100,
            salePrice: 200,
            stock: 4,
            minStock: 0,
            categoryId: (
              await prisma.category.findFirstOrThrow({
                where: { organizationId: fixture.organizationId },
              })
            ).id,
            organizationId: fixture.organizationId,
          },
        });

        const updated = await products.update(
          convertible.id,
          { tracksStock: false, stock: 0 },
          fixture.owner.userId,
          fixture.organizationId,
        );

        expect(updated).toMatchObject({ tracksStock: false, stock: 0 });
        await expect(
          siteRow(fixture.principal.id, convertible.id),
        ).resolves.toMatchObject({ stock: 0, reservedStock: 0 });
        await expect(aggregate(convertible.id)).resolves.toMatchObject({
          stock: 0,
          reservedStock: 0,
        });
      });

      it('keeps the absolute stock edit for a single-site organization', async () => {
        const unique = `${label}-single-${randomUUID()}`;
        const organization = await prisma.organization.create({
          data: { name: unique, slug: unique },
        });
        const site = await prisma.location.create({
          data: {
            organizationId: organization.id,
            name: 'Sucursal única',
            isDefault: true,
          },
        });
        const category = await prisma.category.create({
          data: { name: unique, organizationId: organization.id },
        });
        const product = await prisma.product.create({
          data: {
            name: unique,
            sku: `${unique}-sku`,
            costPrice: 100,
            salePrice: 200,
            stock: 10,
            minStock: 0,
            categoryId: category.id,
            organizationId: organization.id,
          },
        });
        const before = await prisma.product.findUniqueOrThrow({
          where: { id: product.id },
          select: { stock: true, version: true },
        });

        const updated = await products.update(
          product.id,
          { stock: 12 },
          fixture.owner.userId,
          organization.id,
        );

        expect(updated).toMatchObject({ stock: 12 });
        await expect(
          prisma.productStock.findUniqueOrThrow({
            where: {
              productId_locationId: {
                productId: product.id,
                locationId: site.id,
              },
            },
          }),
        ).resolves.toMatchObject({ stock: 12, reservedStock: 0 });
        await expect(
          prisma.product.findUniqueOrThrow({
            where: { id: product.id },
            select: { stock: true, version: true },
          }),
        ).resolves.toMatchObject({
          stock: 12,
          version: before.version + 1,
        });
        await expect(
          prisma.inventoryMovement.findMany({
            where: { productId: product.id },
            select: {
              type: true,
              quantity: true,
              previousStock: true,
              newStock: true,
              locationId: true,
            },
          }),
        ).resolves.toEqual([
          {
            type: 'ADJUSTMENT_IN',
            quantity: 2,
            previousStock: 10,
            newStock: 12,
            locationId: site.id,
          },
        ]);
      });
    });
  },
);
