import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { OrgRole, PrismaClient, ProductType } from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { LocationsService } from '../locations/locations.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

/**
 * T3f — the POS reads one site (real PostgreSQL).
 *
 * `ProductStock` is the per-site ledger; `Product.stock`/`reservedStock` stay
 * the organization-wide aggregate every report and alert reads. The POS
 * catalogue, its search and its quick search may therefore ask for one site:
 * the availability filter then follows that site's balance, the projected
 * `stock`/`reservedStock`/`availableStock` are the site's, and a site the
 * caller cannot read is rejected with the same 404 the other site routes use.
 * Without a requested site every reader must answer exactly as before.
 *
 * The suite is bound to an explicitly provided disposable database and creates
 * its own uniquely named rows; it never migrates, resets or deletes anything it
 * did not create. Run it with `T3F_TEST_DATABASE_URL` pointing at a disposable
 * database that already has the migration applied, e.g.
 *
 *   T3F_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/meperpos_stock_rehearsal_t3f_reads?schema=public \
 *     npx jest --runInBand src/products/products.site-stock-reads.postgres.spec.ts
 */
const databaseUrl = process.env.T3F_TEST_DATABASE_URL;

interface SiteProduct {
  id: string;
  name: string;
  sku: string;
}

interface Fixture {
  organizationId: string;
  principalSiteId: string;
  warehouseId: string;
  foreignOrganizationId: string;
  foreignSiteId: string;
  owner: RequestUser;
  cashierUserId: string;
  cashier: RequestUser;
  /** Five units at the principal site, two of them reserved, minStock 5. */
  atPrincipal: SiteProduct;
  /** Empty at the principal site, four units at the warehouse. */
  atWarehouse: SiteProduct;
  /** Sold labour: never counted at any site. */
  service: SiteProduct;
  /** Untracked merchandise: never counted at any site. */
  untracked: SiteProduct;
  /** Tracked and empty at both sites. */
  empty: SiteProduct;
  foreignProductId: string;
}

const USER_SHAPE = { tokenVersion: 0, isSuperAdmin: false } as const;

(databaseUrl ? describe : describe.skip)(
  'POS catalogue reads at one site (real PostgreSQL)',
  () => {
    const label = `t3f-reads-${randomUUID()}`;
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
        !/^\/meperpos_stock_rehearsal_t3f[a-z0-9_]*$/.test(url.pathname)
      ) {
        throw new Error(
          'Expected an explicit disposable T3f PostgreSQL database',
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
        data: { organizationId: organization.id, name: 'Bodega' },
      });
      const category = await prisma.category.create({
        data: { name: unique, organizationId: organization.id },
      });
      const owner = await prisma.user.create({
        data: {
          email: `${unique}-owner@example.com`,
          password: 'not-a-real-hash',
          name: 'T3f owner',
          tokenVersion: 0,
        },
      });
      const cashier = await prisma.user.create({
        data: {
          email: `${unique}-cashier@example.com`,
          password: 'not-a-real-hash',
          name: 'T3f cashier',
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
            categoryId: category.id,
            organizationId: organization.id,
          },
        });

      const atPrincipal = await createProduct({
        suffix: 'principal',
        stock: 5,
        minStock: 5,
      });
      // The insert opened the principal-site row through the database trigger;
      // two of those units are reserved for a pending loan at that site.
      await prisma.productStock.update({
        where: {
          productId_locationId: {
            productId: atPrincipal.id,
            locationId: principalSite.id,
          },
        },
        data: { reservedStock: 2 },
      });

      const atWarehouse = await createProduct({ suffix: 'warehouse' });
      await prisma.productStock.create({
        data: {
          organizationId: organization.id,
          productId: atWarehouse.id,
          locationId: warehouse.id,
          stock: 4,
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
      const empty = await createProduct({ suffix: 'empty' });

      fixture = {
        organizationId: organization.id,
        principalSiteId: principalSite.id,
        warehouseId: warehouse.id,
        foreignOrganizationId: foreign.id,
        foreignSiteId: foreignSite.id,
        owner: {
          userId: owner.id,
          email: owner.email,
          organizationId: organization.id,
          role: OrgRole.OWNER,
          ...USER_SHAPE,
        },
        cashierUserId: cashier.id,
        cashier: {
          userId: cashier.id,
          email: cashier.email,
          organizationId: organization.id,
          role: OrgRole.CASHIER,
          ...USER_SHAPE,
        },
        atPrincipal,
        atWarehouse,
        service,
        untracked,
        empty,
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

    const listAt = (
      locationId?: string,
      options: { available?: boolean; limit?: number } = {},
    ) =>
      products.findAll(
        fixture.organizationId,
        1,
        options.limit ?? 20,
        undefined,
        undefined,
        'active',
        undefined,
        undefined,
        undefined,
        undefined,
        options.available ?? false,
        locationId,
      );

    const ids = (rows: { id: string }[]) => rows.map(({ id }) => id).sort();

    it('filters available products by the requested site balance', async () => {
      const atPrincipal = await listAt(fixture.principalSiteId, {
        available: true,
      });
      const atWarehouse = await listAt(fixture.warehouseId, {
        available: true,
      });

      expect(ids(atPrincipal.data)).toEqual(
        ids([fixture.atPrincipal, fixture.service, fixture.untracked]),
      );
      expect(atPrincipal.meta.total).toBe(3);
      expect(ids(atWarehouse.data)).toEqual(
        ids([fixture.atWarehouse, fixture.service, fixture.untracked]),
      );
      expect(atWarehouse.meta.total).toBe(3);
      // The empty tracked product has no row at either site, and a missing row
      // is zero stock, not availability.
      expect(ids(atPrincipal.data)).not.toContain(fixture.empty.id);
      expect(ids(atWarehouse.data)).not.toContain(fixture.empty.id);
    });

    it('keeps service and untracked products available at every site', async () => {
      for (const site of [fixture.principalSiteId, fixture.warehouseId]) {
        const { data } = await listAt(site, { available: true });
        const service = data.find(({ id }) => id === fixture.service.id);
        const untracked = data.find(({ id }) => id === fixture.untracked.id);

        expect(service?.availableStock).toBeNull();
        expect(untracked?.availableStock).toBeNull();
      }
    });

    it('projects the site balance and reservations with the organization low-stock flag', async () => {
      const full = await listAt(fixture.principalSiteId);
      // Every active product is listed; `available` is what narrows the set.
      expect(full.meta.total).toBe(5);
      expect(
        full.data.every((row) => row.organizationId === fixture.organizationId),
      ).toBe(true);
      expect(ids(full.data)).not.toContain(fixture.foreignProductId);

      const atPrincipal = full.data.find(
        ({ id }) => id === fixture.atPrincipal.id,
      );
      expect(atPrincipal).toMatchObject({
        stock: 5,
        reservedStock: 2,
        availableStock: 3,
        // The low-stock rule stays organization-level: 5 <= minStock 5.
        minStock: 5,
        isLowStock: true,
      });

      const atWarehouse = full.data.find(
        ({ id }) => id === fixture.atWarehouse.id,
      );
      expect(atWarehouse).toMatchObject({
        stock: 0,
        reservedStock: 0,
        availableStock: 0,
        minStock: 0,
        // The aggregate holds 4 units, so the row is not low on stock even
        // though this site has none.
        isLowStock: false,
      });

      const empty = full.data.find(({ id }) => id === fixture.empty.id);
      expect(empty).toMatchObject({ stock: 0, availableStock: 0 });

      const warehouse = await listAt(fixture.warehouseId);
      const atWarehouseFromWarehouse = warehouse.data.find(
        ({ id }) => id === fixture.atWarehouse.id,
      );
      expect(atWarehouseFromWarehouse).toMatchObject({
        stock: 4,
        reservedStock: 0,
        availableStock: 4,
      });
    });

    it('projects the site balance on search and quick search without changing the payload shape', async () => {
      const aggregateSearch = await products.searchProducts(
        fixture.atWarehouse.name,
        20,
        fixture.organizationId,
      );
      const siteSearch = await products.searchProducts(
        fixture.atWarehouse.name,
        20,
        fixture.organizationId,
        fixture.principalSiteId,
      );
      const aggregateQuick = await products.quickSearch(
        fixture.atWarehouse.sku,
        fixture.organizationId,
      );
      const siteQuick = await products.quickSearch(
        fixture.atWarehouse.sku,
        fixture.organizationId,
        fixture.principalSiteId,
      );

      expect(aggregateSearch).toHaveLength(1);
      expect(aggregateSearch[0]).toMatchObject({
        stock: 4,
        availableStock: 4,
      });
      expect(siteSearch).toHaveLength(1);
      expect(siteSearch[0]).toMatchObject({
        stock: 0,
        availableStock: 0,
        isLowStock: false,
      });
      // The site only moves the numbers: the response keeps the same keys.
      expect(Object.keys(siteSearch[0])).toEqual(
        Object.keys(aggregateSearch[0]),
      );

      expect(aggregateQuick).toMatchObject({ stock: 4, availableStock: 4 });
      expect(siteQuick).toMatchObject({ stock: 0, availableStock: 0 });
      expect(Object.keys(siteQuick!)).toEqual(Object.keys(aggregateQuick!));
    });

    it('keeps the organization aggregate when no site is requested', async () => {
      const full = await listAt();

      expect(
        full.data.find(({ id }) => id === fixture.atWarehouse.id),
      ).toMatchObject({ stock: 4, reservedStock: 0, availableStock: 4 });
      expect(
        full.data.find(({ id }) => id === fixture.atPrincipal.id),
      ).toMatchObject({ stock: 5, reservedStock: 2, availableStock: 3 });
      const available = await listAt(undefined, { available: true });
      expect(ids(available.data)).toEqual(
        ids([
          fixture.atPrincipal,
          fixture.atWarehouse,
          fixture.service,
          fixture.untracked,
        ]),
      );
    });

    it('rejects a foreign, unassigned or unknown site with the shared 404', async () => {
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
          true,
          fixture.foreignSiteId,
        )
        .then(() => undefined)
        .catch((error: unknown) => error);
      expect(foreign).toBeInstanceOf(NotFoundException);
      expect(foreign).toMatchObject({
        status: 404,
        message: 'Location not found',
      });

      const unknown = await controller
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
          true,
          randomUUID(),
        )
        .then(() => undefined)
        .catch((error: unknown) => error);
      expect(unknown).toBeInstanceOf(NotFoundException);

      // A restricted role reads only the sites an administrator assigned; the
      // products read reuses that rule instead of deriving its own.
      const unassigned = await controller
        .quickSearch(
          fixture.cashier,
          fixture.atPrincipal.sku,
          fixture.principalSiteId,
        )
        .then(() => undefined)
        .catch((error: unknown) => error);
      expect(unassigned).toBeInstanceOf(NotFoundException);

      await prisma.membershipLocation.create({
        data: {
          userId: fixture.cashierUserId,
          organizationId: fixture.organizationId,
          locationId: fixture.principalSiteId,
        },
      });
      await expect(
        controller.quickSearch(
          fixture.cashier,
          fixture.atPrincipal.sku,
          fixture.principalSiteId,
        ),
      ).resolves.toMatchObject({ stock: 5, availableStock: 3 });
    });

    it('never reads a site row of another organization', async () => {
      // The foreign product stays invisible even when a site is requested.
      const { data } = await listAt(fixture.principalSiteId);
      expect(data.map(({ id }) => id)).not.toContain(fixture.foreignProductId);
      expect(
        data.find(({ id }) => id === fixture.atPrincipal.id),
      ).toMatchObject({ stock: 5, reservedStock: 2 });
    });

    it('rejects a site read without an organization scope', async () => {
      await expect(
        products.findAll(
          undefined,
          1,
          20,
          undefined,
          undefined,
          'active',
          undefined,
          undefined,
          undefined,
          undefined,
          true,
          fixture.principalSiteId,
        ),
      ).rejects.toMatchObject({
        status: 400,
        message: 'Organization ID is required for this operation',
      });
    });
  },
);
