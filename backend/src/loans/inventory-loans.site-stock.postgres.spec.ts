import { randomUUID } from 'node:crypto';
import { OrgRole, PrismaClient } from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryLoansService } from './inventory-loans.service';
import { CounterpartyType } from './dto/create-loan.dto';

/**
 * T3e — inventory loans write the per-site ledger (real PostgreSQL).
 *
 * `ProductStock` is the source of truth and `Product.stock`/`reservedStock` are
 * the organization-wide aggregate the delta trigger keeps equal to the sum of
 * the site rows. These cases drive the public loan lifecycle (reserve, deliver,
 * return, cancel, close) and assert, after every step, that the tenant default
 * site moved by the right delta, that the aggregate still equals the sum of the
 * site rows, and that a second site of the same organization never moves.
 *
 * The suite is bound to an explicitly provided disposable database and creates
 * its own uniquely named rows; it never migrates, resets or deletes anything it
 * did not create. Run it with `T3E_TEST_DATABASE_URL` pointing at a disposable
 * database that already has the migration applied, e.g.
 *
 *   T3E_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/meperpos_stock_rehearsal_t3e_loans?schema=public \
 *     npx jest --runInBand src/loans/inventory-loans.site-stock.postgres.spec.ts
 */
const databaseUrl = process.env.T3E_TEST_DATABASE_URL;

interface Fixture {
  organizationId: string;
  defaultSiteId: string;
  warehouseId: string;
  productId: string;
  customerId: string;
  actor: RequestUser;
}

(databaseUrl ? describe : describe.skip)(
  'Inventory loans at the default site (real PostgreSQL)',
  () => {
    const label = `t3e-loans-${randomUUID()}`;
    let prisma: PrismaClient;
    let loans: InventoryLoansService;

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
      loans = new InventoryLoansService(prisma as unknown as PrismaService);
    });

    afterAll(async () => {
      if (!prisma) return;
      // Loans, their evidence and their movements are immutable by trigger, so
      // this suite keeps the rows it created as evidence in the disposable
      // database instead of forcing a deletion the schema forbids. Every run
      // uses freshly generated identifiers, so nothing is reused.
      await prisma.$disconnect();
    });

    /**
     * A tenant with a default site, a second site, an administrative actor and
     * one product whose whole balance sits at the default site.
     */
    async function fixture(stock = 10, reservedStock = 0): Promise<Fixture> {
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
      const user = await prisma.user.create({
        data: {
          email: `${unique}@example.com`,
          password: 'not-a-real-hash',
          name: 'T3e admin',
          tokenVersion: 0,
        },
      });
      await prisma.organizationUser.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          role: OrgRole.ADMIN,
        },
      });
      const category = await prisma.category.create({
        data: { name: unique, organizationId: organization.id },
      });
      const product = await prisma.product.create({
        data: {
          organizationId: organization.id,
          categoryId: category.id,
          sku: randomUUID(),
          name: unique,
          costPrice: 100,
          salePrice: 200,
          stock,
          reservedStock,
          type: 'PRODUCT',
          tracksStock: true,
        },
      });
      const customer = await prisma.customer.create({
        data: {
          organizationId: organization.id,
          name: unique,
          documentType: 'CC',
          documentNumber: randomUUID().slice(0, 12),
        },
      });

      return {
        organizationId: organization.id,
        defaultSiteId: site.id,
        warehouseId: warehouse.id,
        productId: product.id,
        customerId: customer.id,
        actor: {
          userId: user.id,
          organizationId: organization.id,
          role: OrgRole.ADMIN,
          email: `${unique}@example.com`,
          tokenVersion: 0,
          isSuperAdmin: false,
        },
      };
    }

    const siteRowAt = (fixture: Fixture, locationId: string) =>
      prisma.productStock.findUniqueOrThrow({
        where: {
          productId_locationId: {
            productId: fixture.productId,
            locationId,
          },
        },
      });

    const aggregate = (fixture: Fixture) =>
      prisma.product.findUniqueOrThrow({
        where: { id: fixture.productId },
        select: { stock: true, reservedStock: true, version: true },
      });

    /** The invariant after every step: Product is the sum of its site rows. */
    async function expectAggregateMatchesSites(fixture: Fixture) {
      const rows = await prisma.productStock.findMany({
        where: { productId: fixture.productId },
      });
      const product = await aggregate(fixture);
      expect(product).toMatchObject({
        stock: rows.reduce((total, row) => total + row.stock, 0),
        reservedStock: rows.reduce(
          (total, row) => total + row.reservedStock,
          0,
        ),
      });
    }

    /** One reservation at the default site, on a product kept in one place. */
    async function reservation(stock = 10, quantity = 2) {
      const created = await fixture(stock);
      const loan = await loans.create(
        {
          requestKey: randomUUID(),
          counterpartyType: CounterpartyType.CUSTOMER,
          counterpartyId: created.customerId,
          items: [{ productId: created.productId, quantity }],
        },
        created.actor,
      );
      return { created, loan };
    }

    it('reserves at the default site and keeps the aggregate equal to its sites', async () => {
      const { created } = await reservation();

      await expect(siteRowAt(created, created.defaultSiteId)).resolves.toEqual({
        productId: created.productId,
        locationId: created.defaultSiteId,
        organizationId: created.organizationId,
        stock: 10,
        reservedStock: 2,
      });
      await expect(
        siteRowAt(created, created.warehouseId),
      ).rejects.toBeInstanceOf(Error);
      await expect(aggregate(created)).resolves.toMatchObject({
        stock: 10,
        reservedStock: 2,
      });
      await expectAggregateMatchesSites(created);
    });

    it('delivers at the default site and returns the same units there', async () => {
      const { created, loan } = await reservation();

      await loans.deliver(
        loan.id,
        {
          requestKey: randomUUID(),
          items: [{ itemId: loan.items[0].id, quantity: 2 }],
        },
        created.actor,
      );
      await expect(
        siteRowAt(created, created.defaultSiteId),
      ).resolves.toMatchObject({
        stock: 8,
        reservedStock: 0,
      });
      await expect(aggregate(created)).resolves.toMatchObject({
        stock: 8,
        reservedStock: 0,
      });
      await expectAggregateMatchesSites(created);

      await loans.returnItems(
        loan.id,
        {
          requestKey: randomUUID(),
          items: [{ itemId: loan.items[0].id, quantity: 1 }],
        },
        created.actor,
      );
      await expect(
        siteRowAt(created, created.defaultSiteId),
      ).resolves.toMatchObject({
        stock: 9,
        reservedStock: 0,
      });
      await expect(aggregate(created)).resolves.toMatchObject({
        stock: 9,
        reservedStock: 0,
      });
      await expectAggregateMatchesSites(created);
    });

    it('releases a cancellation at the same site that reserved', async () => {
      const { created, loan } = await reservation();
      await expect(
        siteRowAt(created, created.defaultSiteId),
      ).resolves.toMatchObject({ stock: 10, reservedStock: 2 });

      await loans.cancel(loan.id, { requestKey: randomUUID() }, created.actor);
      await expect(
        siteRowAt(created, created.defaultSiteId),
      ).resolves.toMatchObject({
        stock: 10,
        reservedStock: 0,
      });
      await expect(aggregate(created)).resolves.toMatchObject({
        stock: 10,
        reservedStock: 0,
      });
      await expectAggregateMatchesSites(created);
    });

    it('releases a close only for the units still reserved at the default site', async () => {
      const { created, loan } = await reservation(10, 3);
      await loans.deliver(
        loan.id,
        {
          requestKey: randomUUID(),
          items: [{ itemId: loan.items[0].id, quantity: 1 }],
        },
        created.actor,
      );
      await loans.returnItems(
        loan.id,
        {
          requestKey: randomUUID(),
          items: [{ itemId: loan.items[0].id, quantity: 1 }],
        },
        created.actor,
      );
      await expect(
        siteRowAt(created, created.defaultSiteId),
      ).resolves.toMatchObject({
        stock: 10,
        reservedStock: 2,
      });

      await loans.close(loan.id, { requestKey: randomUUID() }, created.actor);
      await expect(
        siteRowAt(created, created.defaultSiteId),
      ).resolves.toMatchObject({
        stock: 10,
        reservedStock: 0,
      });
      await expectAggregateMatchesSites(created);
    });

    it('refuses a reservation the default site cannot cover and leaves both ledgers unchanged', async () => {
      const created = await fixture(5);
      // The organization-wide aggregate can cover the loan; the default site cannot.
      await prisma.productStock.create({
        data: {
          organizationId: created.organizationId,
          productId: created.productId,
          locationId: created.warehouseId,
          stock: 10,
          reservedStock: 0,
        },
      });
      const before = {
        product: await aggregate(created),
        defaultSite: await siteRowAt(created, created.defaultSiteId),
        warehouse: await siteRowAt(created, created.warehouseId),
      };

      await expect(
        loans.create(
          {
            requestKey: randomUUID(),
            counterpartyType: CounterpartyType.CUSTOMER,
            counterpartyId: created.customerId,
            items: [{ productId: created.productId, quantity: 6 }],
          },
          created.actor,
        ),
      ).rejects.toMatchObject({
        status: 409,
        message: 'Inventario disponible insuficiente o inválido',
      });

      expect(await aggregate(created)).toEqual(before.product);
      expect(await siteRowAt(created, created.defaultSiteId)).toEqual(
        before.defaultSite,
      );
      expect(await siteRowAt(created, created.warehouseId)).toEqual(
        before.warehouse,
      );
      await expect(
        prisma.inventoryLoan.count({
          where: { organizationId: created.organizationId },
        }),
      ).resolves.toBe(0);
      await expectAggregateMatchesSites(created);
    });

    it('answers a same-site race with the documented conflict, never a raw serialization error', async () => {
      const created = await fixture(10);
      const attempt = (quantity: number) =>
        loans
          .create(
            {
              requestKey: randomUUID(),
              counterpartyType: CounterpartyType.CUSTOMER,
              counterpartyId: created.customerId,
              items: [{ productId: created.productId, quantity }],
            },
            created.actor,
          )
          .then(
            () => 'created' as const,
            (error: { status?: number }) => ({ status: error.status }),
          );

      const results = await Promise.all([attempt(3), attempt(3)]);

      // Whatever interleaving the database picks, a loser must be the documented
      // 409 conflict: the raw site-stock statement reports PG 40001, which the
      // service maps instead of surfacing as an internal error.
      for (const result of results) {
        if (result !== 'created') expect(result.status).toBe(409);
      }
      const created_loans = results.filter((result) => result === 'created');
      expect(created_loans.length).toBeGreaterThanOrEqual(1);
      await expect(aggregate(created)).resolves.toMatchObject({
        stock: 10,
        reservedStock: created_loans.length * 3,
      });
      await expectAggregateMatchesSites(created);
    });

    it('never moves another site of the same organization', async () => {
      const created = await fixture(10);
      await prisma.productStock.create({
        data: {
          organizationId: created.organizationId,
          productId: created.productId,
          locationId: created.warehouseId,
          stock: 7,
          reservedStock: 1,
        },
      });

      const loan = await loans.create(
        {
          requestKey: randomUUID(),
          counterpartyType: CounterpartyType.CUSTOMER,
          counterpartyId: created.customerId,
          items: [{ productId: created.productId, quantity: 4 }],
        },
        created.actor,
      );

      await expect(
        siteRowAt(created, created.defaultSiteId),
      ).resolves.toMatchObject({
        stock: 10,
        reservedStock: 4,
      });
      await expect(
        siteRowAt(created, created.warehouseId),
      ).resolves.toMatchObject({
        stock: 7,
        reservedStock: 1,
      });
      await expect(aggregate(created)).resolves.toMatchObject({
        stock: 17,
        reservedStock: 5,
      });
      await expectAggregateMatchesSites(created);

      await loans.deliver(
        loan.id,
        {
          requestKey: randomUUID(),
          items: [{ itemId: loan.items[0].id, quantity: 4 }],
        },
        created.actor,
      );
      await expect(
        siteRowAt(created, created.defaultSiteId),
      ).resolves.toMatchObject({
        stock: 6,
        reservedStock: 0,
      });
      await expect(
        siteRowAt(created, created.warehouseId),
      ).resolves.toMatchObject({
        stock: 7,
        reservedStock: 1,
      });
      // The movement history is attributed to the site that actually moved; the
      // kárdex baseline stays the organization-wide aggregate it always was.
      await expect(
        prisma.inventoryMovement.findMany({
          where: { productId: created.productId },
          select: {
            locationId: true,
            quantity: true,
            previousStock: true,
            newStock: true,
          },
        }),
      ).resolves.toEqual([
        {
          locationId: created.defaultSiteId,
          quantity: -4,
          previousStock: 17,
          newStock: 13,
        },
      ]);
      await expectAggregateMatchesSites(created);
    });
  },
);
