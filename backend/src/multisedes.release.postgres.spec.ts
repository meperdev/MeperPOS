import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OrgRole, PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';
import type { RequestUser } from './common/interfaces/request-user.interface';
import { SequenceService } from './common/sequences/sequence.service';
import { CacheService } from './common/services/cache.service';
import { WAREHOUSE_IS_NOT_A_STORE } from './locations/authorized-site';
import { CounterpartyType } from './loans/dto/create-loan.dto';
import { InventoryLoansService } from './loans/inventory-loans.service';
import { LoansService } from './loans/loans.service';
import {
  MULTI_SITE_STOCK_EDIT_REFUSED,
  ProductsService,
} from './products/products.service';
import { PurchaseOrdersService } from './purchase-orders/purchase-orders.service';
import { ReceiptsService } from './receipts/receipts.service';
import { SalesService } from './sales/sales.service';
import { SettingsService } from './settings/settings.service';
import { TransfersService } from './transfers/transfers.service';
import { UsersService } from './users/users.service';

/**
 * Release regression — the multi-site shipment, end to end.
 *
 * This suite is the last read of the shipped behaviour before deploying it. It
 * covers the cases no focused unit of the feature owns on its own: a one-site
 * organization still behaving exactly like before (B), the multi-site rules
 * (C), who may sell and read where (D), the tenant boundary of the transfer and
 * adjustment APIs (E), a deterministic sale-versus-dispatch race for the last
 * unit (F), and the aggregate guard (H). The upgrade rehearsal (A) lives in
 * `backend/test/migrations/multisedes-upgrade.rehearse.sh` because it needs two
 * migration chains on the same database.
 *
 * The services come from a real `AppModule` so the assertions run through the
 * modules, providers and Prisma client that production boots, not hand-built
 * copies. The race case builds two dedicated clients to observe the lock.
 *
 * The suite is bound to an explicitly provided disposable database and creates
 * only its own uniquely named rows; it never migrates, resets or deletes
 * anything it did not create. Run it with
 *
 *   RELEASE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/meperpos_stock_rehearsal_release_spec?schema=public \
 *     npx jest --runInBand src/multisedes.release.postgres.spec.ts
 */
const databaseUrl = process.env.RELEASE_TEST_DATABASE_URL;

function deferred() {
  let release!: () => void;
  const wait = new Promise<void>((done) => {
    release = done;
  });
  return { wait, release };
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

function settle<T>(work: Promise<T>): Promise<Settled<T>> {
  return work.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

function failure(error: unknown) {
  return error as { status?: number; message?: string };
}

/** The SQL text of a raw call, whether tagged or built with `Prisma.sql`. */
function sqlText(input: unknown): string {
  if (typeof input === 'string') return input;
  if (Array.isArray(input)) return input.join('?');
  const candidate = input as { sql?: string; text?: string } | undefined;
  return candidate?.sql ?? candidate?.text ?? '';
}

(databaseUrl ? describe : describe.skip)(
  'Multisedes release regression (real PostgreSQL)',
  () => {
    const label = `release-${randomUUID()}`;
    let prisma: PrismaClient;
    let app: INestApplication;
    let sales: SalesService;
    let transfers: TransfersService;
    let products: ProductsService;
    let loans: LoansService;
    let inventoryLoans: InventoryLoansService;
    let purchaseOrders: PurchaseOrdersService;
    let users: UsersService;
    let orderNumber = 0;

    beforeAll(async () => {
      const url = new URL(databaseUrl!);
      if (
        url.protocol !== 'postgresql:' ||
        url.hostname !== '127.0.0.1' ||
        !url.port ||
        url.port === '5432' ||
        url.search !== '?schema=public' ||
        !/^\/meperpos_stock_rehearsal_release[a-z0-9_]*$/.test(url.pathname)
      ) {
        throw new Error(
          'Expected an explicit disposable release PostgreSQL database',
        );
      }
      // The application reads its datasource from the environment at boot; the
      // suite's own client uses the same disposable URL explicitly.
      process.env.DATABASE_URL = url.href;
      process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'release-spec-secret';

      prisma = new PrismaClient({ datasourceUrl: url.href });

      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleRef.createNestApplication({ logger: false });
      await app.init();

      sales = app.get(SalesService);
      transfers = app.get(TransfersService);
      products = app.get(ProductsService);
      loans = app.get(LoansService);
      // The inventory-loan service is intentionally not registered in any Nest
      // module (rollout gate L3C-C), so the suite builds it on the same client.
      inventoryLoans = new InventoryLoansService(prisma as never);
      purchaseOrders = app.get(PurchaseOrdersService);
      users = app.get(UsersService);
    });

    afterAll(async () => {
      await app?.close();
      await prisma?.$disconnect();
    });

    interface Tenant {
      organizationId: string;
      owner: RequestUser;
      admin: RequestUser;
      cashier: RequestUser;
      otherCashier: RequestUser;
      member: RequestUser;
      principal: { id: string; name: string };
      addSite: (name: string, type?: 'STORE' | 'WAREHOUSE') => Promise<void>;
      site: (name: string) => { id: string; name: string };
      grant: (userId: string, locationId: string) => Promise<void>;
      unassignAll: (userId: string) => Promise<void>;
      product: (options?: {
        stock?: number;
        type?: 'PRODUCT' | 'SERVICE';
        price?: number;
      }) => Promise<{ id: string; sku: string }>;
      supplier: () => Promise<{ id: string }>;
      customer: () => Promise<{ id: string }>;
      stockAt: (productId: string, locationId: string) => Promise<number>;
      aggregate: (productId: string) => Promise<{
        stock: number;
        reservedStock: number;
      }>;
      sidebar: (productId: string) => Promise<Record<string, number>>;
      invariant: (productId: string) => Promise<void>;
      digest: () => Promise<string>;
    }

    /**
     * A tenant whose actors exist before any site, so no membership receives a
     * grant automatically: every case writes exactly the access it asserts.
     */
    async function tenant(tag: string): Promise<Tenant> {
      const unique = `${label}-${tag}-${randomUUID()}`;
      const organization = await prisma.organization.create({
        data: { name: unique, slug: unique },
      });
      const organizationId = organization.id;

      const actor = async (role: OrgRole): Promise<RequestUser> => {
        const created = await prisma.user.create({
          data: {
            name: `${unique} ${role}`,
            email: `${randomUUID()}@example.test`,
            password: 'not-a-real-credential',
            organizationUsers: { create: { organizationId, role } },
          },
        });
        return {
          userId: created.id,
          email: created.email,
          role,
          organizationId,
          tokenVersion: created.tokenVersion,
          isSuperAdmin: false,
        };
      };

      const owner = await actor(OrgRole.ADMIN);
      const admin = await actor(OrgRole.ADMIN);
      const cashier = await actor(OrgRole.CASHIER);
      const otherCashier = await actor(OrgRole.CASHIER);
      const member = await actor(OrgRole.CASHIER);

      const principal = await prisma.location.create({
        data: {
          organizationId,
          name: 'Sede principal',
          isDefault: true,
          type: 'STORE',
        },
      });
      const sites = new Map<string, { id: string; name: string }>([
        [principal.name, principal],
      ]);

      const tenantRow: Tenant = {
        organizationId,
        owner,
        admin,
        cashier,
        otherCashier,
        member,
        principal,
        async addSite(name, type = 'STORE') {
          const created = await prisma.location.create({
            data: { organizationId, name, type },
          });
          sites.set(name, created);
        },
        site(name) {
          const found = sites.get(name);
          if (!found) throw new Error(`Fixture site ${name} was not created`);
          return found;
        },
        grant: async (userId, locationId) => {
          await prisma.membershipLocation.create({
            data: { userId, organizationId, locationId },
          });
        },
        unassignAll: async (userId) => {
          await prisma.membershipLocation.deleteMany({
            where: { userId, organizationId },
          });
        },
        async product(options = {}) {
          const category = await prisma.category.create({
            data: { name: `${unique} category`, organizationId },
          });
          const stock = options.stock ?? 0;
          const price = options.price ?? 1000;
          return prisma.product.create({
            data: {
              name: `${unique} product`,
              sku: `${unique}-${randomUUID()}`,
              categoryId: category.id,
              organizationId,
              type: options.type ?? 'PRODUCT',
              tracksStock: (options.type ?? 'PRODUCT') === 'PRODUCT',
              costPrice: 100,
              salePrice: price,
              taxRate: 0,
              stock,
            },
            select: { id: true, sku: true },
          });
        },
        supplier: () =>
          prisma.supplier.create({
            data: {
              organizationId,
              name: `${unique} supplier`,
              documentNumber: `${randomUUID()}`,
            },
            select: { id: true },
          }),
        customer: () =>
          prisma.customer.create({
            data: {
              organizationId,
              name: `${unique} customer`,
              documentType: 'CC',
              documentNumber: `${randomUUID()}`,
            },
            select: { id: true },
          }),
        stockAt: async (productId, locationId) => {
          const row = await prisma.productStock.findUnique({
            where: { productId_locationId: { productId, locationId } },
            select: { stock: true },
          });
          return row?.stock ?? 0;
        },
        aggregate: (productId) =>
          prisma.product.findUniqueOrThrow({
            where: { id: productId },
            select: { stock: true, reservedStock: true },
          }),
        sidebar: async (productId) => {
          const rows = await prisma.productStock.findMany({
            where: { productId },
            select: { locationId: true, stock: true },
            orderBy: { locationId: 'asc' },
          });
          return Object.fromEntries(rows.map((r) => [r.locationId, r.stock]));
        },
        invariant: async (productId) => {
          const rows = await prisma.productStock.findMany({
            where: { productId },
          });
          expect(rows.length).toBeGreaterThan(0);
          expect(await tenantRow.aggregate(productId)).toEqual({
            stock: rows.reduce((total, row) => total + row.stock, 0),
            reservedStock: rows.reduce(
              (total, row) => total + row.reservedStock,
              0,
            ),
          });
        },
        digest: async () => {
          const scoped = { organizationId };
          const [
            productRows,
            balances,
            transferRows,
            movements,
            locations,
            grants,
          ] = await Promise.all([
            prisma.product.findMany({
              where: scoped,
              select: {
                id: true,
                stock: true,
                reservedStock: true,
                version: true,
              },
              orderBy: { id: 'asc' },
            }),
            prisma.productStock.findMany({
              where: scoped,
              orderBy: [{ productId: 'asc' }, { locationId: 'asc' }],
            }),
            prisma.stockTransfer.findMany({
              where: scoped,
              orderBy: { id: 'asc' },
            }),
            prisma.inventoryMovement.findMany({
              where: scoped,
              orderBy: { id: 'asc' },
            }),
            prisma.location.findMany({
              where: scoped,
              orderBy: { id: 'asc' },
            }),
            prisma.membershipLocation.findMany({
              where: scoped,
              orderBy: [{ userId: 'asc' }, { locationId: 'asc' }],
            }),
          ]);
          return createHash('sha256')
            .update(
              JSON.stringify({
                productRows,
                balances,
                transferRows,
                movements,
                locations,
                grants,
              }),
            )
            .digest('hex');
        },
      };
      return tenantRow;
    }

    /** Creates a SALE sequence row the sale numbering step can claim. */
    async function withSaleSequence(t: Tenant) {
      await prisma.organizationSequence.create({
        data: {
          organizationId: t.organizationId,
          type: 'SALE',
          year: new Date().getFullYear(),
        },
      });
    }

    const sell = (
      t: Tenant,
      actor: RequestUser,
      productId: string,
      quantity: number,
      locationId?: string,
    ) =>
      sales.create(
        {
          items: [{ productId, quantity }],
          payments: [{ method: 'CASH', amount: 1000 * quantity }],
          ...(locationId === undefined ? {} : { locationId }),
        },
        actor.userId,
        t.organizationId,
        actor,
      );

    async function pendingOrder(t: Tenant, productId: string) {
      const supplier = await t.supplier();
      orderNumber += 1;
      return prisma.purchaseOrder.create({
        data: {
          organizationId: t.organizationId,
          supplierId: supplier.id,
          createdById: t.owner.userId,
          orderNumber,
          status: 'PENDING',
          subtotal: 100,
          total: 100,
          items: {
            create: [
              {
                organizationId: t.organizationId,
                productId,
                qtyOrdered: 1,
                unitCost: 100,
                taxRate: 0,
                subtotal: 100,
                taxAmount: 0,
              },
            ],
          },
        },
        include: { items: true },
      });
    }

    // ---------------------------------------------------------------------
    // B — a one-site organization keeps the behaviour it had before.
    // ---------------------------------------------------------------------
    it('keeps every legacy request shape of a one-site organization', async () => {
      const t = await tenant('single-site');
      await withSaleSequence(t);
      const product = await t.product({ stock: 10 });
      await t.grant(t.cashier.userId, t.principal.id);

      const site = () => t.stockAt(product.id, t.principal.id);
      const at = async () => ({
        stock: await site(),
        aggregate: await t.aggregate(product.id),
      });
      expect(await at()).toEqual({
        stock: 10,
        aggregate: { stock: 10, reservedStock: 0 },
      });

      // A sale that omits `locationId` still lands on the single site and keeps
      // its totals, with no origin row inventing an attribution.
      const sale = await sell(t, t.cashier, product.id, 2);
      expect(Number(sale.total)).toBe(2000);
      expect(sale.status).toBe('COMPLETED');
      expect(await site()).toBe(8);
      expect(
        await prisma.saleOriginSite.count({
          where: { saleId: sale.id, organizationId: t.organizationId },
        }),
      ).toBe(0);
      await t.invariant(product.id);
      expect(await at()).toEqual({
        stock: 8,
        aggregate: { stock: 8, reservedStock: 0 },
      });

      // Cancelling restores exactly what the sale took from the same site.
      const cancelled = await sales.update(
        sale.id,
        { status: 'CANCELLED', cancelReason: 'Release regression' },
        t.owner.userId,
        t.organizationId,
        t.owner,
      );
      expect(cancelled.status).toBe('CANCELLED');
      expect(await at()).toEqual({
        stock: 10,
        aggregate: { stock: 10, reservedStock: 0 },
      });
      await t.invariant(product.id);

      // A purchase receipt with no destination credits the same single site.
      const order = await pendingOrder(t, product.id);
      const received = await purchaseOrders.receive(
        order.id,
        {
          items: [{ itemId: order.items[0].id, qtyReceivedNow: 1 }],
        },
        t.owner.userId,
        t.organizationId,
        t.owner,
      );
      expect(received.status).toBe('RECEIVED');
      expect(await at()).toEqual({
        stock: 11,
        aggregate: { stock: 11, reservedStock: 0 },
      });
      await t.invariant(product.id);

      // An absolute stock edit is still allowed when the organization owns one
      // site, and it moves that site's balance.
      const edited = await products.update(
        product.id,
        { stock: 15 },
        t.admin.userId,
        t.organizationId,
      );
      expect(edited.stock).toBe(15);
      expect(await at()).toEqual({
        stock: 15,
        aggregate: { stock: 15, reservedStock: 0 },
      });
      await t.invariant(product.id);

      // Inventory loan: create reserves, deliver leaves the site, return comes
      // back to the same site.
      const customer = await t.customer();
      const loan = await inventoryLoans.create(
        {
          requestKey: randomUUID(),
          counterpartyType: CounterpartyType.CUSTOMER,
          counterpartyId: customer.id,
          items: [{ productId: product.id, quantity: 3 }],
        },
        t.admin,
      );
      expect(await at()).toEqual({
        stock: 15,
        aggregate: { stock: 15, reservedStock: 3 },
      });
      await t.invariant(product.id);

      await inventoryLoans.deliver(
        loan.id,
        {
          requestKey: randomUUID(),
          items: [{ itemId: loan.items[0].id, quantity: 3 }],
        },
        t.admin,
      );
      expect(await at()).toEqual({
        stock: 12,
        aggregate: { stock: 12, reservedStock: 0 },
      });
      await t.invariant(product.id);

      await inventoryLoans.returnItems(
        loan.id,
        {
          requestKey: randomUUID(),
          items: [{ itemId: loan.items[0].id, quantity: 1 }],
        },
        t.admin,
      );
      expect(await at()).toEqual({
        stock: 13,
        aggregate: { stock: 13, reservedStock: 0 },
      });
      await t.invariant(product.id);

      // POS financing: the hold reserves, completion consumes it, and a second
      // hold cancelled releases it without touching the balance.
      const financed = await t.customer();
      const hold = (quantity: number) =>
        loans.initiateFromPos(
          {
            customerId: financed.id,
            requestKey: randomUUID(),
            issuedAt: '2026-11-01',
            dueAt: '2026-12-01',
            reason: 'Release regression financing',
            items: [{ productId: product.id, quantity }],
          },
          t.organizationId,
          t.cashier,
        );

      const first = await hold(2);
      expect(await at()).toMatchObject({
        stock: 13,
        aggregate: { reservedStock: 2 },
      });
      await t.invariant(product.id);

      const firstLoanId = String(first.loanId);
      const moneyLoan = await prisma.moneyLoan.findFirstOrThrow({
        where: { id: firstLoanId, organizationId: t.organizationId },
        select: { amount: true },
      });
      await loans.mutate(
        firstLoanId,
        'COLLECTED',
        {
          requestKey: randomUUID(),
          amount: Number(moneyLoan.amount.toFixed(2)),
          method: 'CASH',
        },
        t.cashier.userId,
        t.organizationId,
        t.cashier,
      );
      const completed = await loans.completePosSale(
        firstLoanId,
        { requestKey: randomUUID() },
        t.organizationId,
        t.cashier,
      );
      expect(typeof completed.saleId).toBe('string');
      expect(await at()).toEqual({
        stock: 11,
        aggregate: { stock: 11, reservedStock: 0 },
      });
      await t.invariant(product.id);

      const second = await hold(1);
      expect(await at()).toMatchObject({
        stock: 11,
        aggregate: { reservedStock: 1 },
      });
      await loans.mutate(
        String(second.loanId),
        'CANCELLED',
        { requestKey: randomUUID(), reason: 'Release regression cancel' },
        t.cashier.userId,
        t.organizationId,
        t.cashier,
      );
      expect(await at()).toEqual({
        stock: 11,
        aggregate: { stock: 11, reservedStock: 0 },
      });
      await t.invariant(product.id);
    }, 40000);

    // ---------------------------------------------------------------------
    // C — the multi-site rules.
    // ---------------------------------------------------------------------
    it('refuses the aggregate edit, sells from one site only and rejects a warehouse origin', async () => {
      const t = await tenant('multi-site');
      await withSaleSequence(t);
      await t.addSite('Sucursal norte');
      await t.addSite('Bodega', 'WAREHOUSE');
      const north = t.site('Sucursal norte');
      const warehouse = t.site('Bodega');
      const product = await t.product({ stock: 5 });
      await prisma.productStock.create({
        data: {
          organizationId: t.organizationId,
          productId: product.id,
          locationId: north.id,
          stock: 3,
          reservedStock: 0,
        },
      });

      const before = await t.digest();
      const refused = await products
        .update(product.id, { stock: 9 }, t.admin.userId, t.organizationId)
        .then(
          () => ({ status: 200 as const }),
          (error) => ({
            status: failure(error).status,
            message: failure(error).message,
          }),
        );
      expect(refused).toEqual({
        status: 409,
        message: MULTI_SITE_STOCK_EDIT_REFUSED,
      });
      expect(await t.digest()).toBe(before);
      expect(await t.sidebar(product.id)).toEqual({
        [t.principal.id]: 5,
        [north.id]: 3,
      });

      // A sale at the second store takes only that store's units.
      const sale = await sell(t, t.owner, product.id, 2, north.id);
      expect(sale.status).toBe('COMPLETED');
      expect(await t.sidebar(product.id)).toEqual({
        [t.principal.id]: 5,
        [north.id]: 1,
      });
      expect(await t.aggregate(product.id)).toEqual({
        stock: 6,
        reservedStock: 0,
      });
      await t.invariant(product.id);
      await expect(
        prisma.inventoryMovement.findFirstOrThrow({
          where: { saleId: sale.id, type: 'SALE' },
          select: { locationId: true, quantity: true },
        }),
      ).resolves.toEqual({ locationId: north.id, quantity: -2 });

      // A warehouse is not a till.
      const rejected = await sell(t, t.owner, product.id, 1, warehouse.id).then(
        () => ({ status: 201 as const }),
        (error) => ({
          status: failure(error).status,
          message: failure(error).message,
        }),
      );
      expect(rejected).toEqual({
        status: 400,
        message: WAREHOUSE_IS_NOT_A_STORE,
      });
      expect(await t.sidebar(product.id)).toEqual({
        [t.principal.id]: 5,
        [north.id]: 1,
      });
      await t.invariant(product.id);
    }, 30000);

    // ---------------------------------------------------------------------
    // D — who may sell at which site, and who may read the sale afterwards.
    // ---------------------------------------------------------------------
    it('restricts a cashier to its own site while owners list and open the sale', async () => {
      const t = await tenant('roles');
      await withSaleSequence(t);
      await t.addSite('Sucursal sur');
      const south = t.site('Sucursal sur');
      const product = await t.product({ stock: 2 });
      await prisma.productStock.create({
        data: {
          organizationId: t.organizationId,
          productId: product.id,
          locationId: south.id,
          stock: 3,
          reservedStock: 0,
        },
      });

      // A cashier created after the sites exist starts with exactly the
      // principal grant: no second site is granted automatically.
      const created = await users.create(
        {
          name: 'Release cashier',
          email: `${randomUUID()}@example.test`,
          password: 'Fixture12345',
          role: OrgRole.CASHIER,
        },
        t.organizationId,
        t.admin,
      );
      expect(
        await prisma.membershipLocation.findMany({
          where: { userId: created.id, organizationId: t.organizationId },
          select: { locationId: true },
        }),
      ).toEqual([{ locationId: t.principal.id }]);

      // Assigned to the south store only.
      await prisma.membershipLocation.deleteMany({
        where: { userId: created.id, organizationId: t.organizationId },
      });
      await t.grant(created.id, south.id);
      const cashier: RequestUser = {
        ...t.cashier,
        userId: created.id,
        email: created.email,
      };

      const before = await t.digest();
      const denial = (work: Promise<unknown>) =>
        work.then(
          () => ({ status: 201 as const }),
          (error) => ({
            status: failure(error).status,
            message: failure(error).message,
          }),
        );
      expect(await denial(sell(t, cashier, product.id, 1))).toEqual({
        status: 404,
        message: 'Location not found',
      });
      expect(
        await denial(sell(t, cashier, product.id, 1, t.principal.id)),
      ).toEqual({ status: 404, message: 'Location not found' });
      expect(await t.digest()).toBe(before);

      const sale = await sell(t, cashier, product.id, 1, south.id);
      expect(sale.status).toBe('COMPLETED');
      expect(await t.sidebar(product.id)).toEqual({
        [t.principal.id]: 2,
        [south.id]: 2,
      });
      await t.invariant(product.id);

      // The owner lists every sale of the organization and opens this one both
      // by id and by its number.
      const listed = await sales.findAll(
        t.organizationId,
        1,
        10,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        t.owner,
      );
      expect(listed.data.map((row) => row.id)).toContain(sale.id);
      const byId = await sales.findOne(sale.id, t.organizationId, t.owner);
      expect(byId.id).toBe(sale.id);
      expect(Number(byId.total)).toBe(1000);
      const byNumber = await sales.findBySaleNumber(sale.saleNumber, t.owner);
      expect(byNumber?.id).toBe(sale.id);

      // A different cashier keeps seeing only its own sales.
      const ownScope = await sales.findAll(
        t.organizationId,
        1,
        10,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        t.otherCashier,
      );
      expect(ownScope.data.map((row) => row.id)).not.toContain(sale.id);
      await expect(
        sales.findOne(sale.id, t.organizationId, t.otherCashier),
      ).rejects.toMatchObject({ status: 403 });
    }, 30000);

    // ---------------------------------------------------------------------
    // E — the tenant boundary of transfers and stock adjustments.
    // ---------------------------------------------------------------------
    it('never lets another tenant dispatch, receive, cancel, read or adjust', async () => {
      const a = await tenant('tenant-a');
      const b = await tenant('tenant-b');
      await withSaleSequence(b);
      await b.addSite('Bodega b', 'WAREHOUSE');
      const bWarehouse = b.site('Bodega b');
      const bProduct = await b.product({ stock: 4 });
      await b.grant(b.cashier.userId, b.principal.id);

      const transfer = await transfers.dispatch(b.cashier, {
        fromLocationId: b.principal.id,
        toLocationId: bWarehouse.id,
        items: [{ productId: bProduct.id, quantity: 1 }],
      });
      expect(transfer.status).toBe('IN_TRANSIT');

      const aProduct = await a.product({ stock: 2 });
      const before = await b.digest();

      const tries: Array<[string, () => Promise<unknown>]> = [
        ['read', () => transfers.findOne(a.admin, transfer.id)],
        ['receive', () => transfers.receive(a.admin, transfer.id)],
        [
          'cancel',
          () =>
            transfers.cancel(a.admin, transfer.id, { reason: 'Foreign try' }),
        ],
        [
          'dispatch from a foreign site',
          () =>
            transfers.dispatch(a.admin, {
              fromLocationId: b.principal.id,
              toLocationId: bWarehouse.id,
              items: [{ productId: bProduct.id, quantity: 1 }],
            }),
        ],
        [
          'adjust a foreign product',
          () =>
            products.adjustSiteStock(
              bProduct.id,
              {
                locationId: b.principal.id,
                quantity: 1,
                reason: 'Foreign try',
              },
              a.admin,
            ),
        ],
        [
          'adjust an own product at a foreign site',
          () =>
            products.adjustSiteStock(
              aProduct.id,
              {
                locationId: b.principal.id,
                quantity: 1,
                reason: 'Foreign try',
              },
              a.admin,
            ),
        ],
      ];

      for (const [name, attempt] of tries) {
        const outcome = await attempt().then(
          () => ({ status: 200 as const, message: undefined }),
          (error) => ({
            status: failure(error).status,
            message: failure(error).message,
          }),
        );
        expect({ name, status: outcome.status }).toEqual({
          name,
          status: 404,
        });
      }

      // Nothing of the other tenant moved, down to the row hashes.
      expect(await b.digest()).toBe(before);
      const still = await prisma.stockTransfer.findUniqueOrThrow({
        where: { id: transfer.id },
      });
      expect(still.status).toBe('IN_TRANSIT');
      expect(await b.stockAt(bProduct.id, b.principal.id)).toBe(3);
      expect(await b.stockAt(bProduct.id, bWarehouse.id)).toBe(0);
      await b.invariant(bProduct.id);
      await a.invariant(aProduct.id);
    }, 30000);

    // ---------------------------------------------------------------------
    // F — the deterministic last-unit race between a sale and a dispatch.
    // ---------------------------------------------------------------------
    it('settles a sale and a dispatch racing for the last unit with one winner', async () => {
      const t = await tenant('race');
      await withSaleSequence(t);
      await t.addSite('Sucursal carrera');
      await t.addSite('Bodega carrera', 'WAREHOUSE');
      const store = t.site('Sucursal carrera');
      const warehouse = t.site('Bodega carrera');
      const product = await t.product({ stock: 0 });
      await prisma.productStock.create({
        data: {
          organizationId: t.organizationId,
          productId: product.id,
          locationId: store.id,
          stock: 1,
          reservedStock: 0,
        },
      });
      await t.grant(t.cashier.userId, store.id);

      // Two dedicated clients: one runs the gated dispatch, the other one is a
      // single-connection peer so `pg_blocking_pids` observes the actual
      // competing transaction.
      const first = new PrismaClient({ datasourceUrl: databaseUrl! });
      const peerUrl = new URL(databaseUrl!);
      peerUrl.searchParams.set('connection_limit', '1');
      const peer = new PrismaClient({ datasourceUrl: peerUrl.href });
      const [peerRow] = await peer.$queryRaw<{ pid: number }[]>`
        SELECT pg_backend_pid() AS pid
      `;
      const peerPid = peerRow.pid;

      const reached = deferred();
      const proceed = deferred();
      let firstPid = 0;
      const gated = new Proxy(first, {
        get(target, property) {
          if (property !== '$transaction') {
            const value = Reflect.get(target, property);
            return typeof value === 'function' ? value.bind(target) : value;
          }
          return (work: unknown, options?: unknown) =>
            target.$transaction(async (tx) => {
              const scoped = new Proxy(tx, {
                get(txTarget, txProperty) {
                  if (txProperty !== '$executeRaw') {
                    const value = Reflect.get(txTarget, txProperty);
                    return typeof value === 'function'
                      ? value.bind(txTarget)
                      : value;
                  }
                  return async (...args: unknown[]) => {
                    const original = tx.$executeRaw as (
                      ...inner: unknown[]
                    ) => Promise<number>;
                    // Only the site-balance statement takes the row lock this
                    // race needs; the sequence insert is not part of it.
                    if (!sqlText(args[0]).includes('"ProductStock"')) {
                      return Reflect.apply(original, txTarget, args);
                    }
                    // The gate has to sit *after* the statement: the UPDATE is
                    // what takes the site-row lock the sale will wait on.
                    const applied = await Reflect.apply(
                      original,
                      txTarget,
                      args,
                    );
                    const [row] = await tx.$queryRaw<{ pid: number }[]>`
                      SELECT pg_backend_pid() AS pid
                    `;
                    firstPid = row.pid;
                    reached.release();
                    await proceed.wait;
                    return applied;
                  };
                },
              });
              return (work as (client: unknown) => Promise<unknown>)(scoped);
            }, options as never);
        },
      });

      const gatedTransfers = new TransfersService(
        gated as never,
        new SequenceService(),
      );
      const peerSales = new SalesService(
        peer as never,
        new CacheService(),
        new SettingsService(peer as never, {} as never),
        new SequenceService(),
        new ReceiptsService(),
      );

      const dispatch = settle(
        gatedTransfers.dispatch(t.cashier, {
          fromLocationId: store.id,
          toLocationId: warehouse.id,
          items: [{ productId: product.id, quantity: 1 }],
        }),
      );
      let saleRunner: Promise<Settled<unknown>> | undefined;
      try {
        await Promise.race([
          reached.wait,
          dispatch.then((outcome) => {
            throw new Error(
              `Dispatch never reached its site write: ${JSON.stringify(outcome)}`,
            );
          }),
        ]);

        let finished = false;
        let saleOutcome: Settled<unknown> | undefined;
        saleRunner = settle(
          peerSales.create(
            {
              items: [{ productId: product.id, quantity: 1 }],
              payments: [{ method: 'CASH', amount: 1000 }],
              locationId: store.id,
            },
            t.cashier.userId,
            t.organizationId,
            t.cashier,
          ),
        );
        void saleRunner.then((outcome) => {
          saleOutcome = outcome;
          finished = true;
        });

        const deadline = Date.now() + 5000;
        for (;;) {
          const [row] = await prisma.$queryRaw<{ blocked: boolean }[]>`
            SELECT ${firstPid}::int = ANY(pg_blocking_pids(${peerPid}::int)) AS blocked
          `;
          if (row.blocked) break;
          if (finished) {
            throw new Error(
              `The sale finished instead of waiting on the dispatch: ${JSON.stringify(saleOutcome)}`,
            );
          }
          if (Date.now() >= deadline) {
            throw new Error(
              'The sale neither finished nor waited on the dispatch',
            );
          }
          await delay(10);
        }

        proceed.release();
        const [dispatched, sold] = await Promise.all([dispatch, saleRunner]);
        expect(dispatched.ok).toBe(true);
        expect(sold).toMatchObject({
          ok: false,
          error: { status: 409 },
        });
      } finally {
        proceed.release();
        await Promise.all([dispatch, saleRunner ?? Promise.resolve()]);
        await Promise.all([peer.$disconnect(), first.$disconnect()]);
      }

      // Exactly one leg moved the unit and no site went negative.
      expect(await t.stockAt(product.id, store.id)).toBe(0);
      expect(await t.stockAt(product.id, warehouse.id)).toBe(0);
      expect(await t.aggregate(product.id)).toEqual({
        stock: 0,
        reservedStock: 0,
      });
      await t.invariant(product.id);
      expect(
        await prisma.stockTransfer.count({
          where: { organizationId: t.organizationId, status: 'IN_TRANSIT' },
        }),
      ).toBe(1);
      expect(
        await prisma.sale.count({
          where: { organizationId: t.organizationId },
        }),
      ).toBe(0);
      expect(
        await prisma.inventoryMovement.count({
          where: { organizationId: t.organizationId, type: 'TRANSFER_OUT' },
        }),
      ).toBe(1);
    }, 40000);

    // ---------------------------------------------------------------------
    // H — the aggregate guard.
    // ---------------------------------------------------------------------
    it('rejects a direct aggregate write and still opens the default-site row on insert', async () => {
      const t = await tenant('guard');
      await t.addSite('Sucursal guardia');
      const product = await t.product({ stock: 4 });
      const before = await t.aggregate(product.id);

      await expect(
        prisma.$executeRaw`
          UPDATE "Product" SET "stock" = "stock" + 1 WHERE "id" = ${product.id}
        `,
      ).rejects.toMatchObject({
        code: 'P2010',
        meta: expect.objectContaining({ code: '23514' }),
      });
      await expect(
        prisma.product.update({
          where: { id: product.id },
          data: { stock: { increment: 1 } },
        }),
      ).rejects.toThrow(/site balances in ProductStock own those values/);
      expect(await t.aggregate(product.id)).toEqual(before);
      expect(await t.sidebar(product.id)).toEqual({ [t.principal.id]: 4 });

      // An insert is the one path allowed to open both balances together.
      const category = await prisma.category.create({
        data: {
          name: `${label} guard category`,
          organizationId: t.organizationId,
        },
      });
      const inserted = await prisma.product.create({
        data: {
          name: `${label} inserted`,
          sku: `${label}-${randomUUID()}`,
          categoryId: category.id,
          organizationId: t.organizationId,
          costPrice: 10,
          salePrice: 20,
          stock: 7,
        },
      });
      expect(await t.aggregate(inserted.id)).toEqual({
        stock: 7,
        reservedStock: 0,
      });
      expect(await t.sidebar(inserted.id)).toEqual({ [t.principal.id]: 7 });
      await t.invariant(inserted.id);
      // The two-site organization did not gain a third site for the insert.
      expect(
        await prisma.location.count({
          where: { organizationId: t.organizationId },
        }),
      ).toBe(2);
    }, 30000);
  },
);
