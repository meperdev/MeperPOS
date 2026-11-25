import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { PurchaseOrdersService } from './purchase-orders.service';

/**
 * T3d — a purchase receipt moves the destination site balance.
 *
 * `ProductStock` is the per-site ledger and `Product.stock` is the organization
 * aggregate its delta trigger keeps equal to the sum of the site rows. A receipt
 * of tracked items credits the destination of the batch: the explicit authorized
 * site when the request carries one, the organization default site otherwise.
 * Untracked items never touch a balance.
 *
 * These cases drive the real service against real PostgreSQL: the destination
 * delta, another site staying untouched, a refused receipt leaving every balance
 * as it was, and the untouched product version guard rolling the site write back.
 * The suite is bound to an explicitly provided disposable database and creates
 * its own uniquely named rows; it never migrates, resets or deletes anything it
 * did not create:
 *
 *   T3D_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/meperpos_stock_rehearsal_t3d_po?schema=public \
 *     npx jest --runInBand src/purchase-orders/purchase-order-receiving-site.postgres.spec.ts
 */
const databaseUrl = process.env.T3D_TEST_DATABASE_URL;

interface Tenant {
  organizationId: string;
  userId: string;
  supplierId: string;
  categoryId: string;
  defaultSiteId: string;
}

function settle<T>(work: Promise<T>) {
  return work.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

(databaseUrl ? describe : describe.skip)(
  'Purchase order receipt at a site (real PostgreSQL)',
  () => {
    const label = `t3d-${randomUUID()}`;
    let prisma: PrismaClient;
    let service: PurchaseOrdersService;
    const organizations: string[] = [];
    const users: string[] = [];
    const orderNumbers = new Map<string, number>();

    beforeAll(() => {
      const url = new URL(databaseUrl!);
      if (
        url.protocol !== 'postgresql:' ||
        url.hostname !== '127.0.0.1' ||
        !url.port ||
        url.port === '5432' ||
        url.search !== '?schema=public' ||
        !/^\/meperpos_stock_rehearsal_t3d_[a-z0-9_]+$/.test(url.pathname)
      ) {
        throw new Error(
          'Expected an explicit disposable T3d PostgreSQL database',
        );
      }
      prisma = new PrismaClient({ datasourceUrl: url.href });
      service = new PurchaseOrdersService(prisma as never, {} as never);
    });

    afterAll(async () => {
      if (!prisma) return;
      try {
        for (const organizationId of organizations) {
          await prisma.inventoryMovement.deleteMany({
            where: { organizationId },
          });
          await prisma.auditLog.deleteMany({ where: { organizationId } });
          await prisma.purchaseOrderItem.deleteMany({
            where: { organizationId },
          });
          await prisma.purchaseOrder.deleteMany({ where: { organizationId } });
          await prisma.productStock.deleteMany({ where: { organizationId } });
          await prisma.product.deleteMany({ where: { organizationId } });
          await prisma.category.deleteMany({ where: { organizationId } });
          await prisma.supplier.deleteMany({ where: { organizationId } });
          await prisma.organization.delete({ where: { id: organizationId } });
        }
        if (users.length > 0) {
          await prisma.user.deleteMany({ where: { id: { in: users } } });
        }
      } finally {
        await prisma.$disconnect();
      }
    });

    /** A fresh tenant: an administrator member, its default site and catalogs. */
    async function createTenant(): Promise<Tenant> {
      const unique = `${label}-${randomUUID()}`;
      const organization = await prisma.organization.create({
        data: { name: unique, slug: unique },
      });
      organizations.push(organization.id);
      const user = await prisma.user.create({
        data: {
          email: `${unique}@example.test`,
          password: 'not-a-login-credential',
          name: unique,
        },
      });
      users.push(user.id);
      await prisma.organizationUser.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          role: 'ADMIN',
        },
      });
      const site = await prisma.location.create({
        data: {
          organizationId: organization.id,
          name: 'Sede principal',
          isDefault: true,
        },
      });
      const category = await prisma.category.create({
        data: { name: unique, organizationId: organization.id },
      });
      const supplier = await prisma.supplier.create({
        data: {
          name: unique,
          documentNumber: unique,
          organizationId: organization.id,
        },
      });
      return {
        organizationId: organization.id,
        userId: user.id,
        supplierId: supplier.id,
        categoryId: category.id,
        defaultSiteId: site.id,
      };
    }

    /** A tracked product; its insert opens the default-site row. */
    function product(tenant: Tenant, stock = 3) {
      return prisma.product.create({
        data: {
          organizationId: tenant.organizationId,
          categoryId: tenant.categoryId,
          type: 'PRODUCT',
          tracksStock: true,
          sku: randomUUID(),
          name: `${label} product`,
          stock,
          costPrice: 100,
          salePrice: 200,
        },
      });
    }

    async function order(
      tenant: Tenant,
      productId: string,
      options: { type?: 'PRODUCT' | 'SERVICE'; qtyOrdered?: number } = {},
    ) {
      const qtyOrdered = options.qtyOrdered ?? 5;
      const orderNumber = (orderNumbers.get(tenant.organizationId) ?? 0) + 1;
      orderNumbers.set(tenant.organizationId, orderNumber);
      return prisma.purchaseOrder.create({
        data: {
          organizationId: tenant.organizationId,
          supplierId: tenant.supplierId,
          createdById: tenant.userId,
          orderNumber,
          status: 'PENDING',
          confirmedAt: new Date(),
          items: {
            create: {
              organizationId: tenant.organizationId,
              productId,
              qtyOrdered,
              unitCost: 100,
              subtotal: qtyOrdered * 100,
            },
          },
        },
        include: { items: true },
      });
    }

    const actorFor = (tenant: Tenant) => ({
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      email: `${label}@example.test`,
      role: 'ADMIN' as const,
      tokenVersion: 0,
      isSuperAdmin: false,
    });

    /**
     * A member whose whole assignment is one site: the principal-site grant the
     * membership baseline installs is removed, which is what an administrator
     * replacing the set leaves behind.
     */
    async function restrictedMember(tenant: Tenant, locationId: string) {
      const unique = `${label}-member-${randomUUID()}`;
      const user = await prisma.user.create({
        data: {
          email: `${unique}@example.test`,
          password: 'not-a-login-credential',
          name: unique,
        },
      });
      users.push(user.id);
      await prisma.organizationUser.create({
        data: {
          organizationId: tenant.organizationId,
          userId: user.id,
          role: 'MEMBER',
        },
      });
      await prisma.membershipLocation.deleteMany({
        where: { userId: user.id },
      });
      await prisma.membershipLocation.create({
        data: {
          userId: user.id,
          organizationId: tenant.organizationId,
          locationId,
        },
      });
      return {
        userId: user.id,
        email: user.email,
        organizationId: tenant.organizationId,
        role: 'MEMBER' as const,
        tokenVersion: 0,
        isSuperAdmin: false,
      };
    }

    const siteLedger = (productId: string) =>
      prisma.productStock.findMany({
        where: { productId },
        orderBy: { locationId: 'asc' },
        select: {
          locationId: true,
          organizationId: true,
          stock: true,
          reservedStock: true,
        },
      });

    const aggregate = async (productId: string) => {
      const row = await prisma.product.findUniqueOrThrow({
        where: { id: productId },
        select: { stock: true, reservedStock: true, version: true },
      });
      return row;
    };

    async function expectAggregateIsSumOfSites(
      productId: string,
    ): Promise<number> {
      const rows = await siteLedger(productId);
      const sum = rows.reduce((total, row) => total + row.stock, 0);
      expect(await aggregate(productId)).toMatchObject({ stock: sum });
      return sum;
    }

    const readItem = async (orderId: string, itemId: string) => {
      const stored = await prisma.purchaseOrderItem.findUniqueOrThrow({
        where: { id: itemId },
      });
      expect(stored.purchaseOrderId).toBe(orderId);
      return stored;
    };

    it('credits the authorized destination site and keeps the aggregate equal to the sum of its rows', async () => {
      const tenant = await createTenant();
      const tracked = await product(tenant);
      const purchaseOrder = await order(tenant, tracked.id);
      const [item] = purchaseOrder.items;

      await service.receive(
        purchaseOrder.id,
        {
          items: [{ itemId: item.id, qtyReceivedNow: 5 }],
          locationId: tenant.defaultSiteId,
        },
        tenant.userId,
        tenant.organizationId,
        actorFor(tenant),
      );

      expect(await siteLedger(tracked.id)).toEqual([
        {
          locationId: tenant.defaultSiteId,
          organizationId: tenant.organizationId,
          stock: 8,
          reservedStock: 0,
        },
      ]);
      expect(await expectAggregateIsSumOfSites(tracked.id)).toBe(8);
      expect(await aggregate(tracked.id)).toMatchObject({
        stock: 8,
        reservedStock: 0,
        version: 1,
      });
      expect(
        await prisma.inventoryMovement.findFirstOrThrow({
          where: {
            productId: tracked.id,
            organizationId: tenant.organizationId,
          },
        }),
      ).toMatchObject({
        type: 'PURCHASE',
        quantity: 5,
        previousStock: 3,
        newStock: 8,
        locationId: tenant.defaultSiteId,
      });
      expect(
        await prisma.purchaseOrder.findUniqueOrThrow({
          where: { id: purchaseOrder.id },
          include: { items: true },
        }),
      ).toMatchObject({
        status: 'RECEIVED',
        receivedAt: expect.any(Date),
        items: [{ qtyReceived: 5 }],
      });
    });

    it('lands a receipt with no destination at the default site and leaves another site untouched', async () => {
      const tenant = await createTenant();
      const warehouse = await prisma.location.create({
        data: {
          organizationId: tenant.organizationId,
          name: 'Bodega',
        },
      });
      const tracked = await product(tenant);
      // A second site already carries part of this product's balance; the
      // insert moves the aggregate through the same trigger the receipt uses.
      await prisma.productStock.create({
        data: {
          productId: tracked.id,
          locationId: warehouse.id,
          organizationId: tenant.organizationId,
          stock: 4,
          reservedStock: 0,
        },
      });
      expect(await aggregate(tracked.id)).toMatchObject({ stock: 7 });
      const purchaseOrder = await order(tenant, tracked.id);
      const [item] = purchaseOrder.items;

      await service.receive(
        purchaseOrder.id,
        { items: [{ itemId: item.id, qtyReceivedNow: 5 }] },
        tenant.userId,
        tenant.organizationId,
      );

      const ledger = await siteLedger(tracked.id);
      expect(ledger).toHaveLength(2);
      expect(ledger).toEqual(
        expect.arrayContaining([
          {
            locationId: tenant.defaultSiteId,
            organizationId: tenant.organizationId,
            stock: 8,
            reservedStock: 0,
          },
          {
            locationId: warehouse.id,
            organizationId: tenant.organizationId,
            stock: 4,
            reservedStock: 0,
          },
        ]),
      );
      expect(await expectAggregateIsSumOfSites(tracked.id)).toBe(12);
      expect(
        await prisma.inventoryMovement.findFirstOrThrow({
          where: {
            productId: tracked.id,
            organizationId: tenant.organizationId,
          },
        }),
      ).toMatchObject({ quantity: 5, locationId: tenant.defaultSiteId });
    });

    it('receives into any explicitly authorized site, of either type, in a multi-site organization', async () => {
      const tenant = await createTenant();
      const warehouse = await prisma.location.create({
        data: {
          organizationId: tenant.organizationId,
          name: `${label} bodega`,
          type: 'WAREHOUSE',
        },
      });
      const tracked = await product(tenant);
      const purchaseOrder = await order(tenant, tracked.id);
      const [item] = purchaseOrder.items;

      // T3g: the sole-principal gate is gone. A receipt is not a sale, so its
      // destination may be a warehouse as much as a store; the only rule left
      // is that the actor must be authorized for it.
      await service.receive(
        purchaseOrder.id,
        {
          items: [{ itemId: item.id, qtyReceivedNow: 5 }],
          locationId: warehouse.id,
        },
        tenant.userId,
        tenant.organizationId,
        actorFor(tenant),
      );

      expect(await siteLedger(tracked.id)).toContainEqual({
        locationId: warehouse.id,
        organizationId: tenant.organizationId,
        stock: 5,
        reservedStock: 0,
      });
      expect(await siteLedger(tracked.id)).toContainEqual({
        locationId: tenant.defaultSiteId,
        organizationId: tenant.organizationId,
        stock: 3,
        reservedStock: 0,
      });
      expect(await expectAggregateIsSumOfSites(tracked.id)).toBe(8);
      expect(
        await prisma.inventoryMovement.findFirstOrThrow({
          where: {
            productId: tracked.id,
            organizationId: tenant.organizationId,
          },
        }),
      ).toMatchObject({
        type: 'PURCHASE',
        quantity: 5,
        locationId: warehouse.id,
      });
      expect(
        (
          await prisma.purchaseOrder.findUniqueOrThrow({
            where: { id: purchaseOrder.id },
          })
        ).status,
      ).toBe('RECEIVED');
    });

    it('refuses a destination from another organization and leaves every balance as it was', async () => {
      const tenant = await createTenant();
      const tracked = await product(tenant);
      const purchaseOrder = await order(tenant, tracked.id);
      const [item] = purchaseOrder.items;
      const before = {
        ledger: await siteLedger(tracked.id),
        aggregate: await aggregate(tracked.id),
      };
      // An administrator reaches every site of their own organization, so the
      // remaining boundary is the tenant: another organization's site is not a
      // destination.
      const other = await createTenant();
      const foreign = await prisma.location.findFirstOrThrow({
        where: { organizationId: other.organizationId },
        select: { id: true },
      });

      await expect(
        service.receive(
          purchaseOrder.id,
          {
            items: [{ itemId: item.id, qtyReceivedNow: 5 }],
            locationId: foreign.id,
          },
          tenant.userId,
          tenant.organizationId,
          actorFor(tenant),
        ),
      ).rejects.toMatchObject({
        status: 404,
        message: 'Location not found',
      });

      expect({
        ledger: await siteLedger(tracked.id),
        aggregate: await aggregate(tracked.id),
      }).toEqual(before);
      expect(
        await prisma.inventoryMovement.count({
          where: {
            productId: tracked.id,
            organizationId: tenant.organizationId,
          },
        }),
      ).toBe(0);
      expect(
        (
          await prisma.purchaseOrder.findUniqueOrThrow({
            where: { id: purchaseOrder.id },
          })
        ).status,
      ).toBe('PENDING');
    });

    it('refuses an over-quantity receipt and leaves the site row and aggregate untouched', async () => {
      const tenant = await createTenant();
      const tracked = await product(tenant);
      const purchaseOrder = await order(tenant, tracked.id, { qtyOrdered: 5 });
      const [item] = purchaseOrder.items;
      const before = {
        ledger: await siteLedger(tracked.id),
        aggregate: await aggregate(tracked.id),
      };

      await expect(
        service.receive(
          purchaseOrder.id,
          { items: [{ itemId: item.id, qtyReceivedNow: 6 }] },
          tenant.userId,
          tenant.organizationId,
        ),
      ).rejects.toMatchObject({
        status: 400,
        message: `Cantidad recibida excede lo pendiente para el ítem ${item.id}`,
      });

      expect({
        ledger: await siteLedger(tracked.id),
        aggregate: await aggregate(tracked.id),
      }).toEqual(before);
      expect(
        await prisma.inventoryMovement.count({
          where: {
            productId: tracked.id,
            organizationId: tenant.organizationId,
          },
        }),
      ).toBe(0);
    });

    it('does not credit a site for an untracked line', async () => {
      const tenant = await createTenant();
      const untracked = await prisma.product.create({
        data: {
          organizationId: tenant.organizationId,
          categoryId: tenant.categoryId,
          type: 'PRODUCT',
          tracksStock: false,
          sku: randomUUID(),
          name: `${label} untracked`,
          stock: 0,
          costPrice: 100,
          salePrice: 200,
        },
      });
      const purchaseOrder = await order(tenant, untracked.id);
      const [item] = purchaseOrder.items;
      const before = await siteLedger(untracked.id);

      await service.receive(
        purchaseOrder.id,
        { items: [{ itemId: item.id, qtyReceivedNow: 5 }] },
        tenant.userId,
        tenant.organizationId,
      );

      expect(await siteLedger(untracked.id)).toEqual(before);
      expect(await aggregate(untracked.id)).toMatchObject({
        stock: 0,
        version: 0,
      });
      expect(
        await prisma.inventoryMovement.count({
          where: {
            productId: untracked.id,
            organizationId: tenant.organizationId,
          },
        }),
      ).toBe(0);
      expect(await readItem(purchaseOrder.id, item.id)).toMatchObject({
        qtyReceived: 5,
      });
    });

    it('keeps the product race error and rolls the destination row back when the version guard loses', async () => {
      const tenant = await createTenant();
      const tracked = await product(tenant);
      const purchaseOrder = await order(tenant, tracked.id);
      const [item] = purchaseOrder.items;
      const before = {
        ledger: await siteLedger(tracked.id),
        aggregate: await aggregate(tracked.id),
      };

      let release!: () => void;
      const proceed = new Promise<void>((done) => {
        release = done;
      });
      let reached!: () => void;
      const read = new Promise<void>((done) => {
        reached = done;
      });
      // Lets a competing edit bump the product version after the receipt read it,
      // which is exactly the race the version compare-and-swap refuses.
      const racing = new PurchaseOrdersService(
        {
          purchaseOrder: prisma.purchaseOrder,
          $transaction: (
            run: (tx: Prisma.TransactionClient) => Promise<unknown>,
          ) =>
            prisma.$transaction(async (tx) => {
              const scoped = new Proxy(tx, {
                get(target, model) {
                  const delegate = Reflect.get(target, model);
                  if (model !== 'product') {
                    return typeof delegate === 'function'
                      ? delegate.bind(target)
                      : delegate;
                  }
                  return new Proxy(delegate, {
                    get(targetDelegate, method) {
                      const original = Reflect.get(targetDelegate, method);
                      if (method !== 'findFirst') {
                        return typeof original === 'function'
                          ? original.bind(targetDelegate)
                          : original;
                      }
                      return async (...args: unknown[]) => {
                        const value = await Reflect.apply(
                          original,
                          targetDelegate,
                          args,
                        );
                        reached();
                        await proceed;
                        return value;
                      };
                    },
                  });
                },
              });
              return run(scoped);
            }),
        } as never,
        {} as never,
      );

      const receiving = settle(
        racing.receive(
          purchaseOrder.id,
          { items: [{ itemId: item.id, qtyReceivedNow: 5 }] },
          tenant.userId,
          tenant.organizationId,
        ),
      );
      await read;
      await prisma.product.update({
        where: { id: tracked.id },
        data: { version: { increment: 1 } },
      });
      release();

      await expect(receiving).resolves.toMatchObject({
        ok: false,
        error: {
          status: 409,
          message: 'Modificación concurrente detectada sobre el producto',
        },
      });
      expect({
        ledger: await siteLedger(tracked.id),
        aggregate: await aggregate(tracked.id),
      }).toEqual({
        ledger: before.ledger,
        aggregate: { ...before.aggregate, version: 1 },
      });
      expect(
        await prisma.inventoryMovement.count({
          where: {
            productId: tracked.id,
            organizationId: tenant.organizationId,
          },
        }),
      ).toBe(0);
      expect(
        (
          await prisma.purchaseOrderItem.findUniqueOrThrow({
            where: { id: item.id },
          })
        ).qtyReceived,
      ).toBe(0);
    });

    it('authorizes the implicit destination before receiving', async () => {
      const tenant = await createTenant();
      const warehouse = await prisma.location.create({
        data: { organizationId: tenant.organizationId, name: 'Bodega' },
      });
      const tracked = await product(tenant);
      const purchaseOrder = await order(tenant, tracked.id);
      const [item] = purchaseOrder.items;
      // Assigned to the warehouse only: the default site is not his.
      const member = await restrictedMember(tenant, warehouse.id);
      const snapshot = async () => ({
        ledger: await siteLedger(tracked.id),
        aggregate: await aggregate(tracked.id),
        order: await prisma.purchaseOrder.findUniqueOrThrow({
          where: { id: purchaseOrder.id },
          select: { status: true, receivedAt: true },
        }),
        movements: await prisma.inventoryMovement.count({
          where: { organizationId: tenant.organizationId },
        }),
      });
      const before = await snapshot();

      const refused = await settle(
        service.receive(
          purchaseOrder.id,
          { items: [{ itemId: item.id, qtyReceivedNow: 5 }] },
          member.userId,
          tenant.organizationId,
          member,
        ),
      );
      expect(refused).toMatchObject({
        ok: false,
        error: { status: 404, message: 'Location not found' },
      });
      await expect(snapshot()).resolves.toEqual(before);

      // Once an administrator assigns the principal site, the legacy no-site
      // receipt lands at the organization default exactly as before.
      await prisma.membershipLocation.create({
        data: {
          userId: member.userId,
          organizationId: tenant.organizationId,
          locationId: tenant.defaultSiteId,
        },
      });
      await expect(
        service.receive(
          purchaseOrder.id,
          { items: [{ itemId: item.id, qtyReceivedNow: 5 }] },
          member.userId,
          tenant.organizationId,
          member,
        ),
      ).resolves.toMatchObject({ status: 'RECEIVED' });
      await expect(siteLedger(tracked.id)).resolves.toEqual([
        {
          locationId: tenant.defaultSiteId,
          organizationId: tenant.organizationId,
          stock: 8,
          reservedStock: 0,
        },
      ]);
      await expectAggregateIsSumOfSites(tracked.id);
    });
  },
);
