import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { OrgRole, PrismaClient, ProductType } from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { LocationsService } from '../locations/locations.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

/**
 * T25 — the inventory site view answers with the site's assortment.
 *
 * The catalog belongs to the organization; the units belong to a site. Every
 * product is created with a balance row at the default site, and any other site
 * only gets a row (even a zero one) when stock actually moves there. Reading a
 * site with `carriedAtSite=true` therefore means "the products this site
 * carries": tracked products that hold a row at that site, sold out included,
 * while services and uncounted merchandise stay out because no site ever holds
 * them. Without the flag the read keeps answering the whole catalog exactly as
 * before, and the flag is meaningless without a site.
 *
 * The suite is bound to an explicitly provided disposable database and creates
 * its own uniquely named rows; it never migrates, resets or deletes anything it
 * did not create. Run it with `T25_TEST_DATABASE_URL` pointing at a disposable
 * database that already has the migration chain applied, e.g.
 *
 *   T25_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/meperpos_stock_rehearsal_t25_assortment?schema=public \
 *     npx jest --runInBand src/products/products.site-assortment.postgres.spec.ts
 */
const databaseUrl = process.env.T25_TEST_DATABASE_URL;

interface SiteProduct {
  id: string;
  name: string;
  sku: string;
}

interface Fixture {
  organizationId: string;
  principalSiteId: string;
  warehouseId: string;
  categoryId: string;
  emptyCategoryId: string;
  foreignSiteId: string;
  owner: RequestUser;
  cashier: RequestUser;
  /** Tracked, five units at the principal site, never stocked at the warehouse. */
  principalOnly: SiteProduct;
  /** Tracked, all four units at the warehouse with one reserved. */
  atWarehouse: SiteProduct;
  /** Tracked, carried at the warehouse but sold out there (row at 0). */
  soldOutAtWarehouse: SiteProduct;
  /** Tracked and deactivated, still carried at the warehouse. */
  inactiveAtWarehouse: SiteProduct;
  /** Sold labour: never counted at any site. */
  service: SiteProduct;
  /** Untracked merchandise: never counted at any site. */
  untracked: SiteProduct;
  foreignProductId: string;
}

const USER_SHAPE = { tokenVersion: 0, isSuperAdmin: false } as const;

(databaseUrl ? describe : describe.skip)(
  'Inventory reads of one site assortment (real PostgreSQL)',
  () => {
    const label = `t25-assortment-${randomUUID()}`;
    let prisma: PrismaClient;
    let products: ProductsService;
    let locations: LocationsService;
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
        !/^\/meperpos_stock_rehearsal_t25[a-z0-9_]*$/.test(url.pathname)
      ) {
        throw new Error(
          'Expected an explicit disposable T25 PostgreSQL database',
        );
      }
      prisma = new PrismaClient({ datasourceUrl: url.href });
      const prismaService = prisma as unknown as PrismaService;
      products = new ProductsService(
        prismaService,
        { uploadImage: jest.fn() } as never,
        { invalidateCache: jest.fn() } as never,
      );
      locations = new LocationsService(prismaService);
      controller = new ProductsController(products, locations);

      const unique = `${label}-${randomUUID()}`;
      const organization = await prisma.organization.create({
        data: { name: unique, slug: unique },
      });
      const principalSite = await prisma.location.create({
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
      const category = await prisma.category.create({
        data: { name: unique, organizationId: organization.id },
      });
      const emptyCategory = await prisma.category.create({
        data: { name: `${unique}-empty`, organizationId: organization.id },
      });
      const owner = await prisma.user.create({
        data: {
          email: `${unique}-owner@example.com`,
          password: 'not-a-real-hash',
          name: 'T25 owner',
          tokenVersion: 0,
        },
      });
      const cashier = await prisma.user.create({
        data: {
          email: `${unique}-cashier@example.com`,
          password: 'not-a-real-hash',
          name: 'T25 cashier',
          tokenVersion: 0,
        },
      });
      await prisma.organizationUser.create({
        data: {
          userId: owner.id,
          organizationId: organization.id,
          role: OrgRole.OWNER,
        },
      });
      await prisma.organizationUser.create({
        data: {
          userId: cashier.id,
          organizationId: organization.id,
          role: OrgRole.CASHIER,
        },
      });

      // A second tenant, so a site outside the caller's organization has to be
      // rejected instead of read.
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
          name: `${unique}-foreign-product`,
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
        minStock?: number;
        type?: ProductType;
        tracksStock?: boolean;
        active?: boolean;
        categoryId?: string;
      }) =>
        prisma.product.create({
          data: {
            name: `${unique}-${input.suffix}`,
            sku: `${unique}-${input.suffix}-sku`,
            costPrice: 100,
            salePrice: 200,
            stock: input.stock ?? 0,
            minStock: input.minStock ?? 0,
            type: input.type ?? ProductType.PRODUCT,
            tracksStock: input.tracksStock ?? true,
            active: input.active ?? true,
            categoryId: input.categoryId ?? category.id,
            organizationId: organization.id,
          },
        });

      // Every insert opened its default-site row through the database trigger,
      // so a product is carried at the principal site from birth.
      const principalOnly = await createProduct({
        suffix: 'principal',
        stock: 5,
        minStock: 5,
      });
      const atWarehouse = await createProduct({
        suffix: 'warehouse',
        minStock: 5,
      });
      await prisma.productStock.create({
        data: {
          organizationId: organization.id,
          productId: atWarehouse.id,
          locationId: warehouse.id,
          stock: 4,
          reservedStock: 1,
        },
      });
      const soldOutAtWarehouse = await createProduct({ suffix: 'sold-out' });
      // A carried product whose row survives at zero: selling out does not
      // remove the site from the assortment.
      await prisma.productStock.create({
        data: {
          organizationId: organization.id,
          productId: soldOutAtWarehouse.id,
          locationId: warehouse.id,
          stock: 0,
          reservedStock: 0,
        },
      });
      const inactiveAtWarehouse = await createProduct({
        suffix: 'inactive',
        stock: 1,
        active: false,
      });
      await prisma.productStock.create({
        data: {
          organizationId: organization.id,
          productId: inactiveAtWarehouse.id,
          locationId: warehouse.id,
          stock: 1,
          reservedStock: 0,
        },
      });
      const service = await createProduct({
        suffix: 'service',
        type: ProductType.SERVICE,
        tracksStock: false,
      });
      const untracked = await createProduct({
        suffix: 'untracked',
        tracksStock: false,
      });

      fixture = {
        organizationId: organization.id,
        principalSiteId: principalSite.id,
        warehouseId: warehouse.id,
        categoryId: category.id,
        emptyCategoryId: emptyCategory.id,
        foreignSiteId: foreignSite.id,
        owner: {
          userId: owner.id,
          email: owner.email,
          organizationId: organization.id,
          role: OrgRole.OWNER,
          ...USER_SHAPE,
        },
        cashier: {
          userId: cashier.id,
          email: cashier.email,
          organizationId: organization.id,
          role: OrgRole.CASHIER,
          ...USER_SHAPE,
        },
        principalOnly,
        atWarehouse,
        soldOutAtWarehouse,
        inactiveAtWarehouse,
        service,
        untracked,
        foreignProductId: foreignProduct.id,
      };
    });

    afterAll(async () => {
      if (!prisma) return;
      // Stock movements are immutable by trigger, so the rows this suite
      // created stay as evidence in the disposable database. Every run uses
      // freshly generated identifiers, so nothing is reused.
      await prisma.$disconnect();
    });

    interface ListOptions {
      page?: number;
      limit?: number;
      search?: string;
      categoryId?: string;
      status?: 'active' | 'inactive' | 'all';
      lowStock?: boolean;
      available?: boolean;
      locationId?: string;
      carriedAtSite?: boolean;
    }

    const list = (options: ListOptions = {}) =>
      products.findAll(
        fixture.organizationId,
        options.page ?? 1,
        options.limit ?? 20,
        options.search,
        options.categoryId,
        options.status ?? 'active',
        options.lowStock,
        undefined,
        undefined,
        undefined,
        options.available ?? false,
        options.locationId,
        options.carriedAtSite,
      );

    const ids = (rows: { id: string }[]) => rows.map(({ id }) => id).sort();

    it('lists only the products the site carries, sold out included', async () => {
      const { data, meta } = await list({
        locationId: fixture.warehouseId,
        carriedAtSite: true,
      });

      // The carried set: the row that holds units and the row that sold out.
      // Services, uncounted merchandise and products never stocked here stay
      // out, and so does the deactivated one under the default active status.
      expect(ids(data)).toEqual(
        ids([fixture.atWarehouse, fixture.soldOutAtWarehouse]),
      );
      expect(meta.total).toBe(2);
      expect(ids(data)).not.toContain(fixture.principalOnly.id);
      expect(ids(data)).not.toContain(fixture.service.id);
      expect(ids(data)).not.toContain(fixture.untracked.id);
      expect(ids(data)).not.toContain(fixture.inactiveAtWarehouse.id);

      // The numbers are still the site's, including the sold-out zero.
      expect(
        data.find(({ id }) => id === fixture.atWarehouse.id),
      ).toMatchObject({ stock: 4, reservedStock: 1, availableStock: 3 });
      expect(
        data.find(({ id }) => id === fixture.soldOutAtWarehouse.id),
      ).toMatchObject({ stock: 0, availableStock: 0 });
    });

    it('reads the default site as the tracked products it opened rows for', async () => {
      const { data, meta } = await list({
        locationId: fixture.principalSiteId,
        carriedAtSite: true,
      });

      // The default site holds a row for every product from the moment it is
      // created, zero balances included; the uncounted ones are still excluded
      // because no site holds their units.
      expect(ids(data)).toEqual(
        ids([
          fixture.principalOnly,
          fixture.atWarehouse,
          fixture.soldOutAtWarehouse,
        ]),
      );
      expect(meta.total).toBe(3);
      expect(ids(data)).not.toContain(fixture.service.id);
      expect(ids(data)).not.toContain(fixture.untracked.id);
    });

    it('keeps answering the whole catalog when the flag is absent', async () => {
      const aggregate = await list({ locationId: fixture.warehouseId });
      const carried = await list({
        locationId: fixture.warehouseId,
        carriedAtSite: true,
      });
      const unfiltered = await list();

      // Same site, same numbers, no flag: the read this screen has always made.
      expect(aggregate.meta.total).toBe(5);
      expect(ids(aggregate.data)).toEqual(
        ids([
          fixture.principalOnly,
          fixture.atWarehouse,
          fixture.soldOutAtWarehouse,
          fixture.service,
          fixture.untracked,
          // The inactive product is not part of the default active status.
        ]),
      );
      expect(aggregate.meta.total).toBeGreaterThan(carried.meta.total);

      // And the organization aggregate stays exactly where it was.
      expect(unfiltered.meta.total).toBe(5);
      expect(ids(unfiltered.data)).not.toContain(fixture.foreignProductId);
    });

    it('rejects the flag without a site', async () => {
      await expect(list({ carriedAtSite: true })).rejects.toMatchObject({
        status: 400,
        message: 'carriedAtSite requires a locationId',
      });
      // Explicitly asking for the catalog at no site is just as meaningless.
      await expect(list({ carriedAtSite: false })).rejects.toMatchObject({
        status: 400,
        message: 'carriedAtSite requires a locationId',
      });
      await expect(
        controller.findAll(
          fixture.owner,
          1,
          20,
          undefined,
          undefined,
          'active',
          undefined,
          undefined,
          undefined,
          undefined,
          false,
          undefined,
          true,
        ),
      ).rejects.toMatchObject({
        status: 400,
        message: 'carriedAtSite requires a locationId',
      });
    });

    it('keeps pagination, search, category and low-stock filters inside the assortment', async () => {
      const firstPage = await list({
        locationId: fixture.warehouseId,
        carriedAtSite: true,
        limit: 1,
        page: 1,
      });
      const secondPage = await list({
        locationId: fixture.warehouseId,
        carriedAtSite: true,
        limit: 1,
        page: 2,
      });
      expect(firstPage.meta).toMatchObject({
        total: 2,
        page: 1,
        limit: 1,
        totalPages: 2,
      });
      expect(firstPage.data).toHaveLength(1);
      expect(secondPage.data).toHaveLength(1);
      expect(firstPage.data[0].id).not.toBe(secondPage.data[0].id);

      // Search runs over the carried set, not the catalog: a product that only
      // lives at the principal site is not found here.
      const notCarried = await list({
        locationId: fixture.warehouseId,
        carriedAtSite: true,
        search: fixture.principalOnly.name,
      });
      expect(notCarried.meta.total).toBe(0);
      const carriedByName = await list({
        locationId: fixture.warehouseId,
        carriedAtSite: true,
        search: fixture.atWarehouse.name,
      });
      expect(ids(carriedByName.data)).toEqual([fixture.atWarehouse.id]);

      const emptyCategory = await list({
        locationId: fixture.warehouseId,
        carriedAtSite: true,
        categoryId: fixture.emptyCategoryId,
      });
      expect(emptyCategory.meta.total).toBe(0);
      const carriedCategory = await list({
        locationId: fixture.warehouseId,
        carriedAtSite: true,
        categoryId: fixture.categoryId,
      });
      expect(carriedCategory.meta.total).toBe(2);

      // The low-stock rule stays organization-level, but it intersects the
      // site's assortment: only carried rows can appear. The sold-out row is
      // low at zero while the principal-only product is not carried here.
      const lowStock = await list({
        locationId: fixture.warehouseId,
        carriedAtSite: true,
        lowStock: true,
      });
      expect(ids(lowStock.data)).toEqual(
        ids([fixture.atWarehouse, fixture.soldOutAtWarehouse]),
      );
      const withBadge = await list({
        locationId: fixture.warehouseId,
        carriedAtSite: true,
      });
      expect(withBadge.meta.lowStockCount).toBe(2);

      // A deactivated product the site still carries is reachable on demand.
      const allStatuses = await list({
        locationId: fixture.warehouseId,
        carriedAtSite: true,
        status: 'all',
      });
      expect(ids(allStatuses.data)).toEqual(
        ids([
          fixture.atWarehouse,
          fixture.soldOutAtWarehouse,
          fixture.inactiveAtWarehouse,
        ]),
      );
    });

    it('keeps the existing 404 for a site the caller cannot read', async () => {
      const foreign = await controller
        .findAll(
          fixture.owner,
          1,
          20,
          undefined,
          undefined,
          'active',
          undefined,
          undefined,
          undefined,
          undefined,
          false,
          fixture.foreignSiteId,
          true,
        )
        .then(() => undefined)
        .catch((error: unknown) => error);
      expect(foreign).toBeInstanceOf(NotFoundException);
      expect(foreign).toMatchObject({
        status: 404,
        message: 'Location not found',
      });

      // Every operational membership starts with the principal site (T3h), so
      // the warehouse is the site this cashier does not hold.
      const unassigned = await controller
        .findAll(
          fixture.cashier,
          1,
          20,
          undefined,
          undefined,
          'active',
          undefined,
          undefined,
          undefined,
          undefined,
          false,
          fixture.warehouseId,
          true,
        )
        .then(() => undefined)
        .catch((error: unknown) => error);
      expect(unassigned).toBeInstanceOf(NotFoundException);

      await expect(
        controller.findAll(
          fixture.cashier,
          1,
          20,
          undefined,
          undefined,
          'active',
          undefined,
          undefined,
          undefined,
          undefined,
          false,
          fixture.principalSiteId,
          true,
        ),
      ).resolves.toMatchObject({ meta: { total: 3 } });
    });
  },
);
