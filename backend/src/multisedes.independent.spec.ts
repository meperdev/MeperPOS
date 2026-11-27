import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { OrgRole, PrismaClient } from '@prisma/client';
import { ReportsService } from './reports/reports.service';
import { ExportsService } from './exports/exports.service';
import { StockAlertsService } from './alerts/stock-alerts.service';
import { LocationsService } from './locations/locations.service';
import { ProductsService } from './products/products.service';
import { SalesService } from './sales/sales.service';
import { TransfersService } from './transfers/transfers.service';
import { SequenceService } from './common/sequences/sequence.service';
import { CacheService } from './common/services/cache.service';
import { SettingsService } from './settings/settings.service';
import { ReceiptsService } from './receipts/receipts.service';
import { LoansService } from './loans/loans.service';
import { UsersService } from './users/users.service';
import { PurchaseOrdersService } from './purchase-orders/purchase-orders.service';

const url = process.env.MULTI_VERIFY_URL;
(url ? describe : describe.skip)('Independent multisedes release', () => {
  const db = new PrismaClient({ datasourceUrl: url });
  const seq = new SequenceService();
  const sites = new LocationsService(db as never);
  const sales = new SalesService(
    db as never,
    new CacheService(),
    new SettingsService(db as never, {} as never),
    seq,
    new ReceiptsService(),
  );
  const transfers = new TransfersService(db as never, seq);
  const reports = new ReportsService(db as never, new CacheService());
  const exportsService = new ExportsService(db as never, reports, {} as never);
  const alerts = new StockAlertsService(
    db as never,
    {} as never,
    { sendText: jest.fn() } as never,
  );
  const products = new ProductsService(db as never, {} as never, {} as never);
  const loans = new LoansService(db as never, seq);
  const po = new PurchaseOrdersService(db as never, seq);
  const users = new UsersService(
    db as never,
    { invalidateCache: () => {} } as never,
    {} as never,
  );
  afterAll(() => db.$disconnect());
  beforeAll(() => {
    const parsed = new URL(url!);
    if (
      parsed.protocol !== 'postgresql:' ||
      parsed.hostname !== '127.0.0.1' ||
      !parsed.port ||
      parsed.port === '5432' ||
      parsed.search !== '?schema=public' ||
      !/^\/meperpos_stock_rehearsal_verify[a-z0-9_]*$/.test(parsed.pathname)
    ) {
      throw new Error('Use the disposable verifier database');
    }
  });
  async function fixture(a = 5, b = 3) {
    const tag = randomUUID();
    const org = await db.organization.create({
      data: { name: tag, slug: tag },
    });
    const organizationId = org.id;
    const actor = async (role: OrgRole) => {
      const u = await db.user.create({
        data: {
          name: tag,
          email: `${randomUUID()}@example.test`,
          password: 'not-a-real-credential',
          organizationUsers: { create: { organizationId, role } },
        },
      });
      return {
        userId: u.id,
        email: u.email,
        role,
        organizationId,
        tokenVersion: u.tokenVersion,
        isSuperAdmin: false,
      };
    };
    // Every operational membership created after a site exists starts with the
    // principal grant, so the operational actors of this fixture are created
    // before any site: their access is exactly the grants the cases write.
    const admin = await actor(OrgRole.ADMIN),
      owner = await actor(OrgRole.OWNER),
      cashier = await actor(OrgRole.CASHIER),
      member = await actor(OrgRole.MEMBER);
    const main = await db.location.create({
      data: { organizationId, name: 'Principal', isDefault: true },
    });
    const east = await sites.create(admin, { name: 'East', type: 'STORE' });
    const warehouse = await sites.create(admin, {
      name: 'Warehouse',
      type: 'WAREHOUSE',
    });
    const grant = (locationId: string, userId = cashier.userId) =>
      db.membershipLocation.create({
        data: { userId, organizationId, locationId },
      });
    await grant(east.id, member.userId);
    await grant(east.id);
    const category = await db.category.create({
      data: { name: tag, organizationId },
    });
    const product = await db.product.create({
      data: {
        name: tag,
        sku: tag,
        categoryId: category.id,
        organizationId,
        costPrice: 100,
        salePrice: 1000,
        taxRate: 0,
        stock: a,
        minStock: 4,
      },
    });
    if (b)
      await db.productStock.create({
        data: {
          organizationId,
          productId: product.id,
          locationId: east.id,
          stock: b,
          reservedStock: 0,
        },
      });
    await db.organizationSequence.create({
      data: { organizationId, type: 'SALE', year: new Date().getFullYear() },
    });
    const supplier = await db.supplier.create({
      data: { organizationId, name: tag, documentNumber: tag },
    });
    const balance = async () => {
      const rows = await db.productStock.findMany({
        where: { productId: product.id },
        orderBy: { locationId: 'asc' },
      });
      const aggregate = await db.product.findUniqueOrThrow({
        where: { id: product.id },
        select: { stock: true, reservedStock: true },
      });
      expect(aggregate).toEqual({
        stock: rows.reduce((s, r) => s + r.stock, 0),
        reservedStock: rows.reduce((s, r) => s + r.reservedStock, 0),
      });
      return Object.fromEntries(rows.map((r) => [r.locationId, r.stock]));
    };
    const digest = async () =>
      createHash('sha256')
        .update(
          JSON.stringify([
            await balance(),
            await db.sale.findMany({ where: { organizationId } }),
            await db.inventoryMovement.findMany({ where: { organizationId } }),
            await db.stockTransfer.findMany({ where: { organizationId } }),
          ]),
        )
        .digest('hex');
    const sell = (user: typeof admin, quantity: number, locationId?: string) =>
      sales.create(
        {
          items: [{ productId: product.id, quantity }],
          payments: [{ method: 'CASH', amount: 1000 * quantity }],
          ...(locationId === undefined ? {} : { locationId }),
        },
        user.userId,
        organizationId,
        user,
      );
    const dispatch = (
      user: typeof admin,
      fromLocationId: string,
      toLocationId: string,
      quantity = 1,
    ) =>
      transfers.dispatch(user, {
        fromLocationId,
        toLocationId,
        items: [{ productId: product.id, quantity }],
      });
    const order = (status: 'DRAFT' | 'PENDING') =>
      db.purchaseOrder.create({
        data: {
          organizationId,
          supplierId: supplier.id,
          createdById: admin.userId,
          orderNumber: status === 'DRAFT' ? 1 : 2,
          status,
          subtotal: 100,
          total: 100,
          items: {
            create: [
              {
                organizationId,
                productId: product.id,
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
    return {
      admin,
      owner,
      cashier,
      member,
      main,
      east,
      warehouse,
      product,
      grant,
      balance,
      digest,
      sell,
      dispatch,
      order,
      organizationId,
    };
  }
  it('keeps an implicitly selected default site behind the same grant as an explicit one', async () => {
    const f = await fixture(),
      before = await f.digest();
    await expect(f.sell(f.cashier, 1, f.main.id)).rejects.toMatchObject({
      status: 404,
      message: 'Location not found',
    });
    expect(await f.digest()).toBe(before);
    const outcome = await f.sell(f.cashier, 1).then(
      () => ({ status: 201 }),
      (e) => ({ status: e.status, message: e.message }),
    );
    expect({ outcome, unchanged: (await f.digest()) === before }).toEqual({
      outcome: { status: 404, message: 'Location not found' },
      unchanged: true,
    });
  });
  it('does not grant new sites, authorizes admins, restricts reads and rejects a warehouse origin', async () => {
    const f = await fixture(),
      g = await fixture(),
      before = await f.digest();
    for (const elevated of [f.admin, f.owner])
      for (const site of [f.main, f.east, f.warehouse])
        await expect(
          sites.findAccessible(elevated, site.id),
        ).resolves.toMatchObject({ id: site.id });
    for (const id of [f.main.id, f.warehouse.id, g.east.id])
      await expect(sites.findAccessible(f.cashier, id)).rejects.toMatchObject({
        status: 404,
        message: 'Location not found',
      });
    await expect(f.sell(f.admin, 1, f.warehouse.id)).rejects.toMatchObject({
      status: 400,
    });
    await expect(f.sell(f.admin, 1, g.east.id)).rejects.toMatchObject({
      status: 404,
      message: 'Location not found',
    });
    await expect(f.sell(f.cashier, 4, f.east.id)).rejects.toMatchObject({
      status: 409,
    });
    expect(await f.digest()).toBe(before);
    await f.sell(f.cashier, 2, f.east.id);
    expect(await f.balance()).toMatchObject({ [f.main.id]: 5, [f.east.id]: 1 });
    await expect(
      products.quickSearch(f.product.sku, f.organizationId, f.east.id),
    ).resolves.toMatchObject({ stock: 1 });
    await expect(
      products.quickSearch(f.product.sku, f.organizationId),
    ).resolves.toMatchObject({ stock: 6 });
  });
  it('opens a new operational membership at the principal only', async () => {
    const f = await fixture();
    const u = await users.create(
      {
        name: 'New cashier',
        email: `${randomUUID()}@example.test`,
        password: 'Fixture12345',
        role: OrgRole.CASHIER,
      },
      f.organizationId,
      f.admin,
    );
    expect(
      await db.membershipLocation.findMany({
        where: { userId: u.id },
        select: { locationId: true },
      }),
    ).toEqual([{ locationId: f.main.id }]);
  });
  it('serializes simultaneous sales from different sites without losing either delta', async () => {
    const f = await fixture();
    const race = await Promise.allSettled([
      f.sell(f.admin, 2, f.main.id),
      f.sell(f.cashier, 3, f.east.id),
    ]);
    expect(race.map((x) => x.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await f.balance()).toMatchObject({ [f.main.id]: 3, [f.east.id]: 0 });
  });
  it('never fulfills both a sale and dispatch for the last unit', async () => {
    const f = await fixture(5, 1);
    const race = await Promise.allSettled([
      f.sell(f.cashier, 1, f.east.id),
      f.dispatch(f.cashier, f.east.id, f.warehouse.id),
    ]);
    expect(race.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(race.find((x) => x.status === 'rejected')).toMatchObject({
      reason: { status: 409 },
    });
    expect(await f.balance()).toMatchObject({ [f.main.id]: 5, [f.east.id]: 0 });
  });
  it('authorizes both transfer endpoints independently and posts one terminal credit', async () => {
    const f = await fixture(),
      g = await fixture();
    const transfer = await f.dispatch(f.cashier, f.east.id, f.warehouse.id, 2);
    const hidden = await f.dispatch(f.admin, f.main.id, f.warehouse.id);
    const visible = await transfers.findAll(f.cashier, {});
    expect(visible.data.map((row) => row.id)).toEqual([transfer.id]);
    const before = await f.digest();
    await expect(
      transfers.receive(f.cashier, transfer.id),
    ).rejects.toMatchObject({ status: 404, message: 'Location not found' });
    await expect(transfers.receive(g.admin, hidden.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(await f.digest()).toBe(before);
    const race = await Promise.allSettled([
      transfers.receive(f.owner, transfer.id),
      transfers.cancel(f.cashier, transfer.id, {
        reason: 'Returned to origin',
      }),
    ]);
    expect(race.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(race.find((x) => x.status === 'rejected')).toMatchObject({
      reason: { status: 409 },
    });
    const terminal = await db.stockTransfer.findUniqueOrThrow({
      where: { id: transfer.id },
    });
    const balances = await f.balance();
    expect(balances[f.main.id]).toBe(4);
    expect(balances[f.east.id]).toBe(terminal.status === 'RECEIVED' ? 1 : 3);
    expect(balances[f.warehouse.id] ?? 0).toBe(
      terminal.status === 'RECEIVED' ? 2 : 0,
    );
  });
  it('validates an explicit receipt destination but also applies the rule when omitted', async () => {
    const f = await fixture(),
      order = await f.order('PENDING'),
      before = await f.digest();
    const items = [{ itemId: order.items[0].id, qtyReceivedNow: 1 }];
    const receive = (locationId?: string) =>
      po.receive(
        order.id,
        { items, locationId },
        f.member.userId,
        f.organizationId,
        f.member,
      );
    await expect(receive(f.main.id)).rejects.toMatchObject({
      status: 404,
      message: 'Location not found',
    });
    const outcome = await receive().then(
      () => ({ status: 200 }),
      (e) => ({ status: e.status, message: e.message }),
    );
    expect({ outcome, unchanged: before === (await f.digest()) }).toEqual({
      outcome: { status: 404, message: 'Location not found' },
      unchanged: true,
    });
  });
  it('requires the same principal grant for financing without a site', async () => {
    const f = await fixture();
    const customer = await db.customer.create({
      data: {
        organizationId: f.organizationId,
        name: 'Verifier',
        documentType: 'CC',
        documentNumber: '123123',
      },
    });
    const dto = {
      customerId: customer.id,
      requestKey: randomUUID(),
      issuedAt: '2026-11-01',
      reason: 'Synthetic financing',
      items: [{ productId: f.product.id, quantity: 1 }],
    };
    const initiate = (locationId?: string) =>
      loans.initiateFromPos(
        { ...dto, locationId },
        f.organizationId,
        f.cashier,
      );
    await f.grant(f.warehouse.id);
    await expect(initiate(f.warehouse.id)).rejects.toMatchObject({
      status: 400,
    });
    await expect(initiate(f.main.id)).rejects.toMatchObject({
      status: 404,
      message: 'Location not found',
    });
    const result = await initiate().then(
      () => ({ status: 201 }),
      (e) => ({ status: e.status, message: e.message }),
    );
    const row = await db.productStock.findUniqueOrThrow({
      where: {
        productId_locationId: {
          productId: f.product.id,
          locationId: f.main.id,
        },
      },
    });
    expect({ result, reserve: row.reservedStock }).toEqual({
      result: { status: 404, message: 'Location not found' },
      reserve: 0,
    });
  });
  it('credits an authorized warehouse receipt and leaves low-stock reading the entire org', async () => {
    const f = await fixture(0, 3),
      order = await f.order('PENDING');
    const receive = () =>
      po.receive(
        order.id,
        {
          items: [{ itemId: order.items[0].id, qtyReceivedNow: 1 }],
          locationId: f.warehouse.id,
        },
        f.member.userId,
        f.organizationId,
        f.member,
      );
    await expect(receive()).rejects.toMatchObject({ status: 404 });
    await f.grant(f.warehouse.id, f.member.userId);
    await expect(receive()).resolves.toMatchObject({ status: 'RECEIVED' });
    expect(await f.balance()).toMatchObject({
      [f.main.id]: 0,
      [f.east.id]: 3,
      [f.warehouse.id]: 1,
    });
    expect(await products.getLowStockProducts(f.organizationId)).toMatchObject([
      { id: f.product.id, stock: 4 },
    ]);
    await expect(
      reports.getInventorySnapshot(f.organizationId),
    ).resolves.toMatchObject({
      current: { stockQuantity: 4, stockValue: '400.00' },
    });
    await expect(
      alerts.scanOrganization(f.organizationId),
    ).resolves.toMatchObject({ opened: 1 });
    await expect(
      db.productStockAlert.findFirst({ where: { productId: f.product.id } }),
    ).resolves.toMatchObject({ stockAtOpen: 4 });
    const exported = await exportsService.getInventoryMovements(
      f.organizationId,
      {},
    );
    expect(exported.data).toMatchObject([
      { type: 'PURCHASE', quantity: 1, product: { stock: 4 } },
    ]);
    expect(exported.data[0]).not.toHaveProperty('locationId');
  });

  it('applies an aggregate edit only at the principal and rejects an edit that needs the other site', async () => {
    const f = await fixture();
    const update = (stock: number) =>
      products.update(
        f.product.id,
        { stock },
        f.admin.userId,
        f.organizationId,
      );
    await expect(update(6)).resolves.toMatchObject({ stock: 6 });
    expect(await f.balance()).toMatchObject({ [f.main.id]: 3, [f.east.id]: 3 });
    const before = await f.digest();
    await expect(update(1)).rejects.toMatchObject({
      status: 409,
      message:
        'La sede principal no puede absorber el ajuste de stock: quedaría por debajo de lo reservado o sin existencias',
    });
    expect(await f.digest()).toBe(before);
  });
});
