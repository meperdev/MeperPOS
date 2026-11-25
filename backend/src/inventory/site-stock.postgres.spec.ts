import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import {
  applySiteStockDelta,
  resolveDefaultSiteWithin,
  SiteStockError,
} from './site-stock';

/**
 * T3a — the per-site ledger against real PostgreSQL.
 *
 * The migration seeds `ProductStock` from the organization-wide balance and
 * installs the two triggers that keep that balance equal to the sum of its site
 * rows. These cases drive the storage contract directly: the default-site row a
 * new product opens, the aggregate after inserts/updates/deletes across two
 * sites, the helper's conditional compare-and-swap, tenant isolation and the
 * concurrent decrements the aggregate must never lose.
 *
 * The suite is bound to an explicitly provided disposable database and creates
 * its own uniquely named rows; it never migrates, resets or deletes anything it
 * did not create. Run it with `T3A_TEST_DATABASE_URL` pointing at a disposable
 * database that already has the migration applied, e.g.
 *
 *   T3A_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/meperpos_stock_rehearsal_u1?schema=public \
 *     npx jest --runInBand src/inventory/site-stock.postgres.spec.ts
 */
const databaseUrl = process.env.T3A_TEST_DATABASE_URL;

interface OrganizationFixture {
  id: string;
  categoryId: string;
}

(databaseUrl ? describe : describe.skip)(
  'Per-site stock ledger (real PostgreSQL)',
  () => {
    const label = `t3a-${randomUUID()}`;
    let prisma: PrismaClient;
    let peer: PrismaClient;
    const organizations: string[] = [];

    beforeAll(() => {
      const url = new URL(databaseUrl!);
      if (
        url.protocol !== 'postgresql:' ||
        url.hostname !== '127.0.0.1' ||
        !url.port ||
        url.port === '5432' ||
        url.search !== '?schema=public' ||
        !/^\/meperpos_stock_rehearsal_u1[a-z0-9_]*$/.test(url.pathname)
      ) {
        throw new Error(
          'Expected an explicit disposable T3a PostgreSQL database',
        );
      }
      prisma = new PrismaClient({ datasourceUrl: url.href });
      peer = new PrismaClient({ datasourceUrl: url.href });
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
        await Promise.all([peer?.$disconnect(), prisma.$disconnect()]);
      }
    });

    /** A fresh tenant, its category and, optionally, a default site. */
    async function tenant(
      tag: string,
      options: { withDefaultSite?: boolean } = {},
    ): Promise<OrganizationFixture & { defaultSiteId?: string }> {
      const unique = `${label}-${tag}-${randomUUID()}`;
      const organization = await prisma.organization.create({
        data: { name: unique, slug: unique },
      });
      organizations.push(organization.id);
      const category = await prisma.category.create({
        data: { name: unique, organizationId: organization.id },
      });

      if (!options.withDefaultSite) {
        return { id: organization.id, categoryId: category.id };
      }
      const site = await prisma.location.create({
        data: {
          organizationId: organization.id,
          name: 'Principal',
          isDefault: true,
        },
      });
      return {
        id: organization.id,
        categoryId: category.id,
        defaultSiteId: site.id,
      };
    }

    async function site(organizationId: string, name = 'Bodega') {
      return prisma.location.create({
        data: { organizationId, name: `${label}-${name}-${randomUUID()}` },
      });
    }

    async function product(
      organization: OrganizationFixture,
      data: {
        stock?: number;
        reservedStock?: number;
        type?: 'PRODUCT' | 'SERVICE';
        tracksStock?: boolean;
      } = {},
    ) {
      return prisma.product.create({
        data: {
          organizationId: organization.id,
          categoryId: organization.categoryId,
          sku: randomUUID(),
          name: label,
          costPrice: 100,
          salePrice: 200,
          stock: data.stock ?? 0,
          reservedStock: data.reservedStock ?? 0,
          type: data.type ?? 'PRODUCT',
          tracksStock: data.tracksStock ?? true,
        },
      });
    }

    const aggregate = (productId: string) =>
      prisma.product.findUniqueOrThrow({
        where: { id: productId },
        select: { stock: true, reservedStock: true },
      });

    const siteRows = (productId: string) =>
      prisma.productStock.findMany({
        where: { productId },
        orderBy: { locationId: 'asc' },
      });

    /** One site's balance, by site, so the assertion cannot depend on UUID order. */
    const siteRowAt = (productId: string, locationId: string) =>
      prisma.productStock.findUniqueOrThrow({
        where: { productId_locationId: { productId, locationId } },
      });

    /** The invariant after every statement: Product is its site rows' sum. */
    async function expectAggregateMatchesSites(productId: string) {
      const rows = await siteRows(productId);
      expect(rows.length).toBeGreaterThan(0);
      await expect(aggregate(productId)).resolves.toEqual({
        stock: rows.reduce((total, row) => total + row.stock, 0),
        reservedStock: rows.reduce(
          (total, row) => total + row.reservedStock,
          0,
        ),
      });
      return rows;
    }

    const inTransaction = <T>(
      work: (tx: Prisma.TransactionClient) => Promise<T>,
    ) => prisma.$transaction(work, { timeout: 20000 });

    it('opens the default-site row for a new product without double counting', async () => {
      const organization = await tenant('product-insert', {
        withDefaultSite: true,
      });
      const tracked = await product(organization, {
        stock: 7,
        reservedStock: 2,
      });
      const service = await product(organization, {
        type: 'SERVICE',
        tracksStock: false,
      });

      await expect(siteRows(tracked.id)).resolves.toEqual([
        {
          productId: tracked.id,
          locationId: organization.defaultSiteId,
          organizationId: organization.id,
          stock: 7,
          reservedStock: 2,
        },
      ]);
      await expect(aggregate(tracked.id)).resolves.toEqual({
        stock: 7,
        reservedStock: 2,
      });
      await expectAggregateMatchesSites(tracked.id);

      await expect(siteRows(service.id)).resolves.toEqual([
        {
          productId: service.id,
          locationId: organization.defaultSiteId,
          organizationId: organization.id,
          stock: 0,
          reservedStock: 0,
        },
      ]);
      await expect(aggregate(service.id)).resolves.toEqual({
        stock: 0,
        reservedStock: 0,
      });
      // The insert reuses the organization's own site, it never adds one.
      await expect(
        prisma.location.count({ where: { organizationId: organization.id } }),
      ).resolves.toBe(1);
    });

    it('creates the default site for a product whose organization has none', async () => {
      const organization = await tenant('no-default-site');
      const created = await product(organization, { stock: 5 });

      const sites = await prisma.location.findMany({
        where: { organizationId: organization.id },
        select: { id: true, name: true, isDefault: true },
      });
      expect(sites).toEqual([
        expect.objectContaining({ name: 'Sede principal', isDefault: true }),
      ]);
      await expect(siteRows(created.id)).resolves.toEqual([
        {
          productId: created.id,
          locationId: sites[0].id,
          organizationId: organization.id,
          stock: 5,
          reservedStock: 0,
        },
      ]);
      await expect(aggregate(created.id)).resolves.toEqual({
        stock: 5,
        reservedStock: 0,
      });
    });

    it('keeps the aggregate equal to the sum of every site row', async () => {
      const organization = await tenant('aggregate', {
        withDefaultSite: true,
      });
      const created = await product(organization, { stock: 10 });
      const warehouse = await site(organization.id);

      await prisma.productStock.create({
        data: {
          productId: created.id,
          locationId: warehouse.id,
          organizationId: organization.id,
          stock: 4,
          reservedStock: 1,
        },
      });
      await expect(aggregate(created.id)).resolves.toEqual({
        stock: 14,
        reservedStock: 1,
      });

      await prisma.productStock.update({
        where: {
          productId_locationId: {
            productId: created.id,
            locationId: warehouse.id,
          },
        },
        data: { stock: 6, reservedStock: 3 },
      });
      await expect(aggregate(created.id)).resolves.toEqual({
        stock: 16,
        reservedStock: 3,
      });
      await expectAggregateMatchesSites(created.id);

      await prisma.productStock.delete({
        where: {
          productId_locationId: {
            productId: created.id,
            locationId: warehouse.id,
          },
        },
      });
      await expect(aggregate(created.id)).resolves.toEqual({
        stock: 10,
        reservedStock: 0,
      });
      await expectAggregateMatchesSites(created.id);
    });

    it('refuses an over-draw through the helper and leaves both ledgers unchanged', async () => {
      const organization = await tenant('over-draw', {
        withDefaultSite: true,
      });
      const created = await product(organization, { stock: 5 });
      const target = {
        organizationId: organization.id,
        productId: created.id,
        locationId: organization.defaultSiteId!,
      };

      await expect(
        inTransaction((tx) =>
          applySiteStockDelta(tx, {
            ...target,
            stockDelta: -6,
            reservedDelta: 0,
          }),
        ),
      ).resolves.toEqual({ applied: false, reason: 'insufficient-stock' });
      await expect(siteRows(created.id)).resolves.toEqual([
        expect.objectContaining({ stock: 5, reservedStock: 0 }),
      ]);
      await expect(aggregate(created.id)).resolves.toEqual({
        stock: 5,
        reservedStock: 0,
      });

      await expect(
        inTransaction((tx) =>
          applySiteStockDelta(tx, {
            ...target,
            stockDelta: -5,
            reservedDelta: 0,
          }),
        ),
      ).resolves.toEqual({ applied: true, created: false });
      await expect(siteRows(created.id)).resolves.toEqual([
        expect.objectContaining({ stock: 0, reservedStock: 0 }),
      ]);
      await expect(aggregate(created.id)).resolves.toEqual({
        stock: 0,
        reservedStock: 0,
      });
    });

    it('holds a reservation only while the site keeps the stock reserved', async () => {
      const organization = await tenant('reservation', {
        withDefaultSite: true,
      });
      const created = await product(organization, { stock: 5 });
      const target = {
        organizationId: organization.id,
        productId: created.id,
        locationId: organization.defaultSiteId!,
      };

      await expect(
        inTransaction((tx) =>
          applySiteStockDelta(tx, {
            ...target,
            stockDelta: 0,
            reservedDelta: 5,
          }),
        ),
      ).resolves.toEqual({ applied: true, created: false });
      await expect(
        inTransaction((tx) =>
          applySiteStockDelta(tx, {
            ...target,
            stockDelta: 0,
            reservedDelta: 1,
          }),
        ),
      ).resolves.toEqual({ applied: false, reason: 'insufficient-stock' });
      await expect(
        inTransaction((tx) =>
          applySiteStockDelta(tx, {
            ...target,
            stockDelta: -1,
            reservedDelta: 0,
          }),
        ),
      ).resolves.toEqual({ applied: false, reason: 'insufficient-stock' });
      await expect(aggregate(created.id)).resolves.toEqual({
        stock: 5,
        reservedStock: 5,
      });

      // Releasing the reservation is never conditional: it raises availability.
      await expect(
        inTransaction((tx) =>
          applySiteStockDelta(tx, {
            ...target,
            stockDelta: 0,
            reservedDelta: -5,
          }),
        ),
      ).resolves.toEqual({ applied: true, created: false });
      await expect(aggregate(created.id)).resolves.toEqual({
        stock: 5,
        reservedStock: 0,
      });
    });

    it('opens a missing site row once, even when two writers race for it', async () => {
      const organization = await tenant('create-race', {
        withDefaultSite: true,
      });
      const created = await product(organization, { stock: 2 });
      const warehouse = await site(organization.id);
      const delta = {
        organizationId: organization.id,
        productId: created.id,
        locationId: warehouse.id,
        stockDelta: 1,
        reservedDelta: 0,
      };

      const results = await Promise.all([
        inTransaction((tx) => applySiteStockDelta(tx, delta)),
        peer.$transaction((tx) => applySiteStockDelta(tx, delta), {
          timeout: 20000,
        }),
      ]);

      expect(results).toEqual(
        expect.arrayContaining([{ applied: true, created: true }]),
      );
      expect(results.every((result) => result.applied)).toBe(true);
      await expect(siteRows(created.id)).resolves.toHaveLength(2);
      await expect(
        siteRowAt(created.id, organization.defaultSiteId!),
      ).resolves.toMatchObject({ stock: 2, reservedStock: 0 });
      await expect(siteRowAt(created.id, warehouse.id)).resolves.toMatchObject({
        stock: 2,
        reservedStock: 0,
      });
      await expect(aggregate(created.id)).resolves.toEqual({
        stock: 4,
        reservedStock: 0,
      });
    });

    it('keeps the invariant under concurrent decrements at two sites', async () => {
      const organization = await tenant('decrement-race', {
        withDefaultSite: true,
      });
      const created = await product(organization, { stock: 10 });
      const warehouse = await site(organization.id);
      await prisma.productStock.create({
        data: {
          productId: created.id,
          locationId: warehouse.id,
          organizationId: organization.id,
          stock: 5,
          reservedStock: 0,
        },
      });

      const results = await Promise.all(
        [
          {
            organizationId: organization.id,
            productId: created.id,
            locationId: organization.defaultSiteId!,
            stockDelta: -4,
            reservedDelta: 0,
          },
          {
            organizationId: organization.id,
            productId: created.id,
            locationId: warehouse.id,
            stockDelta: -4,
            reservedDelta: 0,
          },
        ].map((delta) => inTransaction((tx) => applySiteStockDelta(tx, delta))),
      );

      expect(results).toEqual([
        { applied: true, created: false },
        { applied: true, created: false },
      ]);
      await expect(siteRows(created.id)).resolves.toHaveLength(2);
      await expect(
        siteRowAt(created.id, organization.defaultSiteId!),
      ).resolves.toMatchObject({ stock: 6, reservedStock: 0 });
      await expect(siteRowAt(created.id, warehouse.id)).resolves.toMatchObject({
        stock: 1,
        reservedStock: 0,
      });
      await expect(aggregate(created.id)).resolves.toEqual({
        stock: 7,
        reservedStock: 0,
      });
      await expectAggregateMatchesSites(created.id);
    });

    it('lets only one of several racing decrements take the same units', async () => {
      const organization = await tenant('same-site-race', {
        withDefaultSite: true,
      });
      const created = await product(organization, { stock: 5 });
      const target = {
        organizationId: organization.id,
        productId: created.id,
        locationId: organization.defaultSiteId!,
        stockDelta: -4,
        reservedDelta: 0,
      };

      const results = await Promise.all([
        inTransaction((tx) => applySiteStockDelta(tx, target)),
        peer.$transaction((tx) => applySiteStockDelta(tx, target), {
          timeout: 20000,
        }),
        peer.$transaction((tx) => applySiteStockDelta(tx, target), {
          timeout: 20000,
        }),
      ]);

      expect(results.filter((result) => result.applied)).toHaveLength(1);
      await expect(siteRows(created.id)).resolves.toEqual([
        expect.objectContaining({ stock: 1, reservedStock: 0 }),
      ]);
      await expect(aggregate(created.id)).resolves.toEqual({
        stock: 1,
        reservedStock: 0,
      });
    });

    it('rejects a site balance from another tenant', async () => {
      const organization = await tenant('tenant-a', { withDefaultSite: true });
      const foreign = await tenant('tenant-b', { withDefaultSite: true });
      const created = await product(organization, { stock: 3 });
      const foreignProduct = await product(foreign, { stock: 1 });

      await expect(
        prisma.productStock.create({
          data: {
            productId: created.id,
            locationId: foreign.defaultSiteId!,
            organizationId: organization.id,
            stock: 1,
            reservedStock: 0,
          },
        }),
      ).rejects.toBeInstanceOf(Error);

      await expect(
        prisma.productStock.create({
          data: {
            productId: foreignProduct.id,
            locationId: organization.defaultSiteId!,
            organizationId: organization.id,
            stock: 1,
            reservedStock: 0,
          },
        }),
      ).rejects.toBeInstanceOf(Error);

      await expect(aggregate(created.id)).resolves.toEqual({
        stock: 3,
        reservedStock: 0,
      });
      await expect(
        prisma.productStock.count({ where: { productId: foreignProduct.id } }),
      ).resolves.toBe(1);
    });

    it('reads the default site inside the transaction and fails closed without one', async () => {
      const organization = await tenant('default-site', {
        withDefaultSite: true,
      });
      const bare = await tenant('no-site');

      await expect(
        inTransaction((tx) => resolveDefaultSiteWithin(tx, organization.id)),
      ).resolves.toBe(organization.defaultSiteId);
      await expect(
        inTransaction((tx) => resolveDefaultSiteWithin(tx, bare.id)),
      ).rejects.toThrow(SiteStockError);

      const rollback = new Error('roll back the deleted default site');
      await expect(
        inTransaction(async (tx) => {
          await tx.location.update({
            where: { id: organization.defaultSiteId! },
            data: { isDefault: false },
          });
          await expect(
            resolveDefaultSiteWithin(tx, organization.id),
          ).rejects.toThrow(SiteStockError);
          throw rollback;
        }),
      ).rejects.toThrow(rollback);
      await expect(
        prisma.location.count({
          where: { organizationId: organization.id, isDefault: true },
        }),
      ).resolves.toBe(1);
    });

    it('leaves no site balance behind when the product is deleted', async () => {
      const organization = await tenant('product-delete', {
        withDefaultSite: true,
      });
      const created = await product(organization, { stock: 4 });
      const warehouse = await site(organization.id);
      await prisma.productStock.create({
        data: {
          productId: created.id,
          locationId: warehouse.id,
          organizationId: organization.id,
          stock: 2,
          reservedStock: 0,
        },
      });
      await expect(aggregate(created.id)).resolves.toEqual({
        stock: 6,
        reservedStock: 0,
      });

      await prisma.product.delete({ where: { id: created.id } });
      await expect(
        prisma.productStock.count({ where: { productId: created.id } }),
      ).resolves.toBe(0);
    });

    it('still rejects a site balance that reserves more than it holds', async () => {
      const organization = await tenant('site-bound', {
        withDefaultSite: true,
      });
      const created = await product(organization, { stock: 2 });

      await expect(
        prisma.productStock.update({
          where: {
            productId_locationId: {
              productId: created.id,
              locationId: organization.defaultSiteId!,
            },
          },
          data: { reservedStock: 3 },
        }),
      ).rejects.toBeInstanceOf(Error);
      await expect(aggregate(created.id)).resolves.toEqual({
        stock: 2,
        reservedStock: 0,
      });
    });
  },
);
