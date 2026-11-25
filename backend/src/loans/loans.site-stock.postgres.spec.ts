import { randomUUID } from 'node:crypto';
import { OrgRole, Prisma, PrismaClient } from '@prisma/client';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { SequenceService } from '../common/sequences/sequence.service';
import { LoansService } from './loans.service';

/**
 * T3c — the financed POS hold, finalize and release against real PostgreSQL.
 *
 * `LoansService.initiateFromPos` now reserves at the site that will deliver the
 * cart, `completePosSale` consumes that reservation and the stock at the stored
 * `PosLoanSaleIntentOriginSite` (the organization default when the intent never
 * carried one, which is where legacy holds were seeded), and a cancelled
 * financing releases the reservation at the same site. `Product.stock` and
 * `Product.reservedStock` are only what the T3a trigger keeps equal to the sum of
 * their `ProductStock` rows.
 *
 * The suite is bound to an explicitly provided disposable database, creates its
 * own uniquely named rows and never migrates, resets or deletes anything it did
 * not create. Run it with `T3C_TEST_DATABASE_URL` pointing at a disposable
 * database that already has every migration applied, e.g.
 *
 *   T3C_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/meperpos_stock_rehearsal_t3c_loans?schema=public \
 *     npx jest --runInBand src/loans/loans.site-stock.postgres.spec.ts
 */
const databaseUrl = process.env.T3C_TEST_DATABASE_URL;

type Fixture = {
  organizationId: string;
  defaultSiteId: string;
  productId: string;
  customerId: string;
  userId: string;
  actor: RequestUser;
};

(databaseUrl ? describe : describe.skip)(
  'LoansService — financed POS site ledger (real PostgreSQL)',
  () => {
    let prisma: PrismaClient;
    let loans: LoansService;
    const label = `t3c-${randomUUID()}`;

    beforeAll(() => {
      const url = new URL(databaseUrl!);
      if (
        url.protocol !== 'postgresql:' ||
        url.hostname !== '127.0.0.1' ||
        !url.port ||
        url.port === '5432' ||
        url.search !== '?schema=public' ||
        !/^\/meperpos_stock_rehearsal_t3c[a-z0-9_]*$/.test(url.pathname)
      ) {
        throw new Error(
          'Expected an explicit disposable T3c PostgreSQL database',
        );
      }
      prisma = new PrismaClient({ datasourceUrl: url.href });
      loans = new LoansService(prisma as never, new SequenceService());
    });

    afterAll(async () => {
      // Rows stay: the isolated database is evidence, not a scratch pad, and the
      // financing lifecycle has no cascade back from "Organization".
      await prisma?.$disconnect();
    });

    const nextKey = () => `${label}-${randomUUID()}`;

    /** A tenant whose product was created with `stock` at its default site. */
    async function tenant(
      tag: string,
      options: { stock?: number; extraSites?: number } = {},
    ): Promise<Fixture & { extraSiteIds: string[] }> {
      const unique = `${label}-${tag}-${randomUUID()}`;
      const organization = await prisma.organization.create({
        data: { name: unique, slug: unique },
      });
      const defaultSite = await prisma.location.create({
        data: {
          organizationId: organization.id,
          name: 'Sede principal',
          isDefault: true,
        },
      });
      const extraSiteIds: string[] = [];
      for (let index = 0; index < (options.extraSites ?? 0); index += 1) {
        const site = await prisma.location.create({
          data: { organizationId: organization.id, name: `Bodega ${index}` },
        });
        extraSiteIds.push(site.id);
      }
      const user = await prisma.user.create({
        data: {
          email: `${unique}@t3c.test`,
          password: 'not-a-real-password',
          name: `T3c ${tag} cashier`,
        },
      });
      await prisma.organizationUser.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          role: OrgRole.CASHIER,
        },
      });
      await prisma.membershipLocation.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          locationId: defaultSite.id,
        },
      });
      const customer = await prisma.customer.create({
        data: {
          name: `${unique} customer`,
          documentType: 'CC',
          documentNumber: `900${tag.length}11222`,
          organizationId: organization.id,
        },
      });
      const category = await prisma.category.create({
        data: { name: `${unique} category`, organizationId: organization.id },
      });
      const product = await prisma.product.create({
        data: {
          name: `${unique} product`,
          sku: unique,
          costPrice: new Prisma.Decimal('40.00'),
          salePrice: new Prisma.Decimal('100.00'),
          taxRate: new Prisma.Decimal('0.00'),
          taxable: false,
          stock: options.stock ?? 0,
          reservedStock: 0,
          type: 'PRODUCT',
          tracksStock: true,
          categoryId: category.id,
          organizationId: organization.id,
        },
      });
      await prisma.organizationSequence.create({
        data: {
          organizationId: organization.id,
          type: 'SALE',
          year: new Date().getFullYear(),
          currentNumber: 0,
        },
      });
      const actor: RequestUser = {
        userId: user.id,
        email: `${unique}@t3c.test`,
        organizationId: organization.id,
        role: OrgRole.CASHIER,
        isSuperAdmin: false,
        tokenVersion: 0,
      };
      return {
        organizationId: organization.id,
        defaultSiteId: defaultSite.id,
        extraSiteIds,
        productId: product.id,
        customerId: customer.id,
        userId: user.id,
        actor,
      };
    }

    const initiate = (
      fixture: Fixture,
      changes: { quantity?: number; locationId?: string } = {},
    ) =>
      loans.initiateFromPos(
        {
          customerId: fixture.customerId,
          requestKey: nextKey(),
          issuedAt: '2026-11-01',
          dueAt: '2026-12-01',
          reason: 'Compra financiada T3c',
          items: [
            {
              productId: fixture.productId,
              quantity: changes.quantity ?? 2,
            },
          ],
          ...(changes.locationId === undefined
            ? {}
            : { locationId: changes.locationId }),
        },
        fixture.organizationId,
        fixture.actor,
      );

    /** The invariant after every write: Product is its site rows' sum. */
    async function expectAggregateMatchesSites(productId: string) {
      const rows = await prisma.productStock.findMany({ where: { productId } });
      expect(rows.length).toBeGreaterThan(0);
      const product = await prisma.product.findUniqueOrThrow({
        where: { id: productId },
        select: { stock: true, reservedStock: true },
      });
      expect(product).toEqual({
        stock: rows.reduce((total, row) => total + row.stock, 0),
        reservedStock: rows.reduce(
          (total, row) => total + row.reservedStock,
          0,
        ),
      });
      return rows;
    }

    const siteRowAt = (productId: string, locationId: string) =>
      prisma.productStock.findFirst({
        where: { productId, locationId },
      });

    /** Collects the financed principal so completion is allowed. */
    async function collectEverything(fixture: Fixture, loanId: string) {
      const loan = await prisma.moneyLoan.findFirstOrThrow({
        where: { id: loanId, organizationId: fixture.organizationId },
      });
      await loans.mutate(
        loanId,
        'COLLECTED',
        {
          requestKey: nextKey(),
          amount: Number(loan.amount.toFixed(2)),
          method: 'CASH',
        },
        fixture.userId,
        fixture.organizationId,
      );
    }

    it('reserves at the explicit origin site and keeps the aggregate as its sum', async () => {
      const fixture = await tenant('explicit-origin', { stock: 10 });
      const result = await initiate(fixture, {
        locationId: fixture.defaultSiteId,
      });

      await expect(
        siteRowAt(fixture.productId, fixture.defaultSiteId),
      ).resolves.toEqual({
        productId: fixture.productId,
        locationId: fixture.defaultSiteId,
        organizationId: fixture.organizationId,
        stock: 10,
        reservedStock: 2,
      });
      await expect(
        prisma.posLoanSaleIntentOriginSite.findFirstOrThrow({
          where: { intentId: String(result.intentId) },
          select: { locationId: true },
        }),
      ).resolves.toEqual({ locationId: fixture.defaultSiteId });
      await expectAggregateMatchesSites(fixture.productId);
    });

    it('holds at the default site without an origin and leaves a second site untouched', async () => {
      const fixture = await tenant('default-hold', {
        stock: 10,
        extraSites: 1,
      });
      const [secondSiteId] = fixture.extraSiteIds;
      await initiate(fixture);

      await expect(
        siteRowAt(fixture.productId, fixture.defaultSiteId),
      ).resolves.toMatchObject({ stock: 10, reservedStock: 2 });
      await expect(siteRowAt(fixture.productId, secondSiteId)).resolves.toBe(
        null,
      );
      await expectAggregateMatchesSites(fixture.productId);
      await expect(
        prisma.posLoanSaleIntentOriginSite.count({
          where: { organizationId: fixture.organizationId },
        }),
      ).resolves.toBe(0);
    });

    it('completes at the stored origin: stock and reservation leave the same site', async () => {
      const fixture = await tenant('complete-origin', { stock: 10 });
      const initiated = await initiate(fixture, {
        locationId: fixture.defaultSiteId,
      });
      const loanId = String(initiated.loanId);
      await collectEverything(fixture, loanId);

      const completed = await loans.completePosSale(
        loanId,
        { requestKey: nextKey() },
        fixture.organizationId,
        fixture.actor,
      );

      await expect(
        siteRowAt(fixture.productId, fixture.defaultSiteId),
      ).resolves.toEqual({
        productId: fixture.productId,
        locationId: fixture.defaultSiteId,
        organizationId: fixture.organizationId,
        stock: 8,
        reservedStock: 0,
      });
      await expectAggregateMatchesSites(fixture.productId);
      await expect(
        prisma.inventoryMovement.findFirstOrThrow({
          where: { saleId: String(completed.saleId) },
          select: { type: true, quantity: true, locationId: true },
        }),
      ).resolves.toEqual({
        type: 'SALE',
        quantity: -2,
        locationId: fixture.defaultSiteId,
      });
      await expect(
        prisma.saleOriginSite.findFirstOrThrow({
          where: { saleId: String(completed.saleId) },
          select: { locationId: true },
        }),
      ).resolves.toEqual({ locationId: fixture.defaultSiteId });
    });

    it('completes a legacy intent without origin at the default site, not the second one', async () => {
      const fixture = await tenant('complete-legacy', {
        stock: 10,
        extraSites: 1,
      });
      const [secondSiteId] = fixture.extraSiteIds;
      const initiated = await initiate(fixture);
      const loanId = String(initiated.loanId);
      await collectEverything(fixture, loanId);

      const completed = await loans.completePosSale(
        loanId,
        { requestKey: nextKey() },
        fixture.organizationId,
        fixture.actor,
      );

      await expect(
        siteRowAt(fixture.productId, fixture.defaultSiteId),
      ).resolves.toMatchObject({ stock: 8, reservedStock: 0 });
      await expect(siteRowAt(fixture.productId, secondSiteId)).resolves.toBe(
        null,
      );
      await expectAggregateMatchesSites(fixture.productId);
      await expect(
        prisma.inventoryMovement.findFirstOrThrow({
          where: { saleId: String(completed.saleId) },
          select: { locationId: true },
        }),
      ).resolves.toEqual({ locationId: fixture.defaultSiteId });
      await expect(
        prisma.saleOriginSite.count({
          where: { saleId: String(completed.saleId) },
        }),
      ).resolves.toBe(0);
    });

    it('releases a cancelled reservation at the site that held it', async () => {
      const fixture = await tenant('cancel-release', { stock: 10 });
      const initiated = await initiate(fixture, {
        locationId: fixture.defaultSiteId,
      });

      await loans.mutate(
        String(initiated.loanId),
        'CANCELLED',
        { requestKey: nextKey(), reason: 'Cancelar sin abonos' },
        fixture.userId,
        fixture.organizationId,
        fixture.actor,
      );

      await expect(
        siteRowAt(fixture.productId, fixture.defaultSiteId),
      ).resolves.toEqual({
        productId: fixture.productId,
        locationId: fixture.defaultSiteId,
        organizationId: fixture.organizationId,
        stock: 10,
        reservedStock: 0,
      });
      await expectAggregateMatchesSites(fixture.productId);
    });

    it('refuses a hold the site cannot cover even when another site holds the stock', async () => {
      const fixture = await tenant('site-overdraw', {
        stock: 0,
        extraSites: 1,
      });
      const [secondSiteId] = fixture.extraSiteIds;
      // The stock lives at the other site: the aggregate is enough, the default
      // site this hold would use is not.
      await prisma.productStock.create({
        data: {
          productId: fixture.productId,
          locationId: secondSiteId,
          organizationId: fixture.organizationId,
          stock: 10,
          reservedStock: 0,
        },
      });
      const before = {
        loans: await prisma.moneyLoan.count({
          where: { organizationId: fixture.organizationId },
        }),
        siteRows: await prisma.productStock.findMany({
          where: { productId: fixture.productId },
          orderBy: { locationId: 'asc' },
        }),
      };

      await expect(initiate(fixture, { quantity: 1 })).rejects.toMatchObject({
        status: 409,
        message: 'Existencias disponibles insuficientes',
      });

      await expect(
        prisma.moneyLoan.count({
          where: { organizationId: fixture.organizationId },
        }),
      ).resolves.toBe(before.loans);
      await expect(
        prisma.productStock.findMany({
          where: { productId: fixture.productId },
          orderBy: { locationId: 'asc' },
        }),
      ).resolves.toEqual(before.siteRows);
      // T3g: the sole-principal gate is gone. A warehouse still cannot be a POS
      // origin (400, nothing written), while an authorized store reserves at
      // its own balance.
      await prisma.membershipLocation.create({
        data: {
          userId: fixture.userId,
          organizationId: fixture.organizationId,
          locationId: secondSiteId,
        },
      });
      const warehouse = await prisma.location.create({
        data: {
          organizationId: fixture.organizationId,
          name: `${label}-bodega-${randomUUID()}`,
          type: 'WAREHOUSE',
        },
      });
      await prisma.membershipLocation.create({
        data: {
          userId: fixture.userId,
          organizationId: fixture.organizationId,
          locationId: warehouse.id,
        },
      });
      await expect(
        initiate(fixture, { quantity: 1, locationId: warehouse.id }),
      ).rejects.toMatchObject({
        status: 400,
        message:
          'La sede seleccionada es una bodega: solo una sucursal puede ser el origen de una venta o una financiación',
      });
      await expect(
        prisma.productStock.findMany({
          where: { productId: fixture.productId },
          orderBy: { locationId: 'asc' },
        }),
      ).resolves.toEqual(before.siteRows);

      await expect(
        initiate(fixture, { quantity: 1, locationId: secondSiteId }),
      ).resolves.toMatchObject({ organizationId: fixture.organizationId });
      await expect(siteRowAt(fixture.productId, secondSiteId)).resolves.toEqual(
        {
          productId: fixture.productId,
          locationId: secondSiteId,
          organizationId: fixture.organizationId,
          stock: 10,
          reservedStock: 1,
        },
      );
      await expect(
        siteRowAt(fixture.productId, fixture.defaultSiteId),
      ).resolves.toEqual({
        productId: fixture.productId,
        locationId: fixture.defaultSiteId,
        organizationId: fixture.organizationId,
        stock: 0,
        reservedStock: 0,
      });
      await expectAggregateMatchesSites(fixture.productId);
    });
  },
);
