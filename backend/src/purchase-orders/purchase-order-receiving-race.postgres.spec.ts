import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Prisma, PrismaClient, ProductType } from '@prisma/client';
import { PurchaseOrdersService } from './purchase-orders.service';

const databaseUrl = process.env.T20_TEST_DATABASE_URL;

function deferred() {
  let release!: () => void;
  const wait = new Promise<void>((done) => {
    release = done;
  });
  return { wait, release };
}

function settle<T>(work: Promise<T>) {
  return work.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

(databaseUrl ? describe : describe.skip)(
  'Purchase order receiving races',
  () => {
    const label = `t20-${randomUUID()}`;
    let prisma: PrismaClient;
    let peer: PrismaClient;
    let peerPid: number;
    let organizationId: string;
    let userId: string;
    let supplierId: string;
    let categoryId: string;
    let orderNumber = 0;

    beforeAll(async () => {
      const url = new URL(databaseUrl!);
      if (
        url.protocol !== 'postgresql:' ||
        url.hostname !== '127.0.0.1' ||
        !url.port ||
        url.port === '5432' ||
        url.search !== '?schema=public' ||
        !/^\/meperpos_stock_rehearsal_t20_[a-z0-9_]+$/.test(url.pathname)
      ) {
        throw new Error(
          'Expected an explicit disposable T20 PostgreSQL database',
        );
      }
      prisma = new PrismaClient({ datasourceUrl: url.href });
      url.searchParams.set('connection_limit', '1');
      peer = new PrismaClient({ datasourceUrl: url.href });
      // The peer uses one connection, so pg_blocking_pids observes the actual
      // competing statement even for a non-transactional service call.
      const [connection] = await peer.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      peerPid = connection.pid;
      const org = await prisma.organization.create({
        data: { name: label, slug: label },
      });
      organizationId = org.id;
      const user = await prisma.user.create({
        data: {
          email: `${label}@example.test`,
          password: 'not-a-login-credential',
          name: label,
        },
      });
      userId = user.id;
      const supplier = await prisma.supplier.create({
        data: {
          name: label,
          documentNumber: label,
          organizationId,
        },
      });
      supplierId = supplier.id;
      const category = await prisma.category.create({
        data: { name: label, organizationId },
      });
      categoryId = category.id;
    });

    afterAll(async () => {
      if (!prisma) return;
      try {
        if (organizationId) {
          await prisma.inventoryMovement.deleteMany({
            where: { organizationId },
          });
          await prisma.purchaseOrderItem.deleteMany({
            where: { organizationId },
          });
          await prisma.purchaseOrder.deleteMany({ where: { organizationId } });
          await prisma.product.deleteMany({ where: { organizationId } });
          await prisma.category.deleteMany({ where: { organizationId } });
          await prisma.supplier.deleteMany({ where: { organizationId } });
          await prisma.organization.delete({ where: { id: organizationId } });
        }
        if (userId) await prisma.user.delete({ where: { id: userId } });
      } finally {
        await Promise.all([peer?.$disconnect(), prisma.$disconnect()]);
      }
    });

    async function orderWith(types: ProductType[]) {
      const products = await Promise.all(
        types.map((type) =>
          prisma.product.create({
            data: {
              organizationId,
              type,
              categoryId,
              sku: randomUUID(),
              name: label,
              stock: 0,
              costPrice: 100,
              salePrice: 200,
              tracksStock: type === 'PRODUCT',
            },
          }),
        ),
      );
      return prisma.purchaseOrder.create({
        data: {
          organizationId,
          supplierId,
          createdById: userId,
          orderNumber: ++orderNumber,
          status: 'PENDING',
          confirmedAt: new Date(),
          items: {
            create: products.map(({ id }) => ({
              organizationId,
              productId: id,
              qtyOrdered: 5,
              unitCost: 100,
              subtotal: 500,
            })),
          },
        },
        include: { items: true },
      });
    }

    async function compete<A, B>(
      at: { model: 'purchaseOrderItem' | 'purchaseOrder'; method: 'update' },
      firstCall: (service: PurchaseOrdersService) => Promise<A>,
      secondCall: (service: PurchaseOrdersService) => Promise<B>,
    ) {
      const reached = deferred();
      const proceed = deferred();
      let firstPid = 0;
      const client = {
        purchaseOrder: prisma.purchaseOrder,
        $transaction: (run: (tx: Prisma.TransactionClient) => Promise<A>) =>
          prisma.$transaction(
            async (tx) => {
              const scoped = new Proxy(tx, {
                get(target, model) {
                  const delegate = Reflect.get(target, model);
                  if (model !== at.model)
                    return typeof delegate === 'function'
                      ? delegate.bind(target)
                      : delegate;
                  return new Proxy(delegate, {
                    get(targetDelegate, method) {
                      const original = Reflect.get(targetDelegate, method);
                      if (method !== at.method)
                        return typeof original === 'function'
                          ? original.bind(targetDelegate)
                          : original;
                      return async (...args: unknown[]) => {
                        const [connection] = await tx.$queryRaw<
                          { pid: number }[]
                        >`SELECT pg_backend_pid() AS pid`;
                        firstPid = connection.pid;
                        reached.release();
                        await proceed.wait;
                        return Reflect.apply(original, targetDelegate, args);
                      };
                    },
                  });
                },
              });
              return run(scoped);
            },
            { timeout: 12000 },
          ),
      };
      const first = settle(
        firstCall(new PurchaseOrdersService(client as never, {} as never)),
      );
      let second: ReturnType<typeof settle<B>> | undefined;
      try {
        await Promise.race([
          reached.wait,
          first.then((outcome) => {
            throw new Error(
              `First receipt never reached its gated write: ${JSON.stringify(outcome)}`,
            );
          }),
        ]);
        let finished = false;
        second = settle(
          secondCall(new PurchaseOrdersService(peer as never, {} as never)),
        ).finally(() => {
          finished = true;
        });
        const deadline = Date.now() + 4000;
        while (!finished) {
          const [row] = await prisma.$queryRaw<{ blocked: boolean }[]>`
          SELECT ${firstPid}::int = ANY(pg_blocking_pids(${peerPid}::int)) AS blocked
        `;
          if (row.blocked) break;
          if (Date.now() >= deadline)
            throw new Error(
              'Peer neither completed nor waited on the gated receipt',
            );
          await delay(10);
        }
        proceed.release();
        return await Promise.all([first, second] as const);
      } finally {
        proceed.release();
        await Promise.all([first, second]);
      }
    }

    const receive = (
      service: PurchaseOrdersService,
      orderId: string,
      itemId: string,
      qty: number,
    ) =>
      service.receive(
        orderId,
        { items: [{ itemId, qtyReceivedNow: qty }] },
        userId,
        organizationId,
      );

    async function readOrder(id: string) {
      return prisma.purchaseOrder.findUniqueOrThrow({
        where: { id },
        include: { items: { include: { product: true } } },
      });
    }

    it('rejects the competing untracked receipt rather than exceeding the ordered quantity', async () => {
      const order = await orderWith(['SERVICE']);
      const [item] = order.items;
      const [first, second] = await compete(
        { model: 'purchaseOrderItem', method: 'update' },
        (service) => receive(service, order.id, item.id, 3),
        (service) => receive(service, order.id, item.id, 3),
      );
      expect(first).toMatchObject({ ok: true });
      expect(second).toMatchObject({
        ok: false,
        error: {
          status: 400,
          message: `Cantidad recibida excede lo pendiente para el ítem ${item.id}`,
        },
      });
      expect(await readOrder(order.id)).toMatchObject({
        status: 'PARTIAL_RECEIVED',
        receivedAt: null,
        items: [{ qtyReceived: 3, product: { stock: 0 } }],
      });
      expect(
        await prisma.inventoryMovement.count({
          where: { productId: item.productId, organizationId },
        }),
      ).toBe(0);
    }, 16000);

    it('marks the order fully received after two concurrent receipts on distinct lines', async () => {
      const order = await orderWith(['PRODUCT', 'PRODUCT']);
      const [a, b] = order.items;
      const results = await compete(
        { model: 'purchaseOrder', method: 'update' },
        (service) => receive(service, order.id, a.id, 5),
        (service) => receive(service, order.id, b.id, 5),
      );
      expect(results.map((result) => result.ok)).toEqual([true, true]);
      expect(await readOrder(order.id)).toMatchObject({
        status: 'RECEIVED',
        receivedAt: expect.any(Date),
        items: [
          { qtyReceived: 5, product: { stock: 5 } },
          { qtyReceived: 5, product: { stock: 5 } },
        ],
      });
      expect(
        await prisma.inventoryMovement.count({
          where: {
            productId: { in: [a.productId, b.productId] },
            organizationId,
            type: 'PURCHASE',
          },
        }),
      ).toBe(2);
    }, 16000);

    it('rejects a cancellation that started before the final receipt committed', async () => {
      const order = await orderWith(['PRODUCT']);
      const [item] = order.items;
      const [first, second] = await compete(
        { model: 'purchaseOrder', method: 'update' },
        (service) => receive(service, order.id, item.id, 5),
        (service) =>
          service.cancel(
            order.id,
            { reason: 'Synthetic cancellation' },
            organizationId,
          ),
      );
      expect(first).toMatchObject({ ok: true });
      expect(second).toMatchObject({
        ok: false,
        error: {
          status: 400,
          message: 'Solo se pueden cancelar órdenes en borrador o pendientes',
        },
      });
      expect(await readOrder(order.id)).toMatchObject({
        status: 'RECEIVED',
        cancelledAt: null,
        cancelReason: null,
        receivedAt: expect.any(Date),
        items: [{ qtyReceived: 5, product: { stock: 5 } }],
      });
      expect(
        await prisma.inventoryMovement.count({
          where: { productId: item.productId, organizationId },
        }),
      ).toBe(1);
    }, 16000);

    it('leaves stock untouched when cancellation wins after the receipt reads a pending order', async () => {
      const order = await orderWith(['PRODUCT']);
      const [item] = order.items;
      const before = (await readOrder(order.id)).items;
      const reached = deferred();
      const proceed = deferred();
      const client = {
        purchaseOrder: {
          findFirst: async (args: Prisma.PurchaseOrderFindFirstArgs) => {
            const pending = await prisma.purchaseOrder.findFirst(args);
            reached.release();
            await proceed.wait;
            return pending;
          },
        },
        $transaction: prisma.$transaction.bind(prisma),
      };
      const receiving = settle(
        receive(
          new PurchaseOrdersService(client as never, {} as never),
          order.id,
          item.id,
          5,
        ),
      );
      try {
        await Promise.race([
          reached.wait,
          receiving.then(() => {
            throw new Error('Receipt did not reach the pending-order read');
          }),
        ]);
        const cancelReason = 'Synthetic cancellation';
        await expect(
          new PurchaseOrdersService(peer as never, {} as never).cancel(
            order.id,
            { reason: cancelReason },
            organizationId,
          ),
        ).resolves.toMatchObject({
          status: 'CANCELLED',
          cancelReason,
        });
        proceed.release();
        await expect(receiving).resolves.toMatchObject({
          ok: false,
          error: {
            status: 400,
            message:
              'Solo se pueden recibir órdenes pendientes o parcialmente recibidas',
          },
        });
        expect(await readOrder(order.id)).toMatchObject({
          status: 'CANCELLED',
          cancelReason,
          receivedAt: null,
          cancelledAt: expect.any(Date),
          items: before,
        });
        expect(
          await prisma.inventoryMovement.count({
            where: { productId: item.productId, organizationId },
          }),
        ).toBe(0);
        expect(
          await prisma.auditLog.count({
            where: { resourceId: item.productId, organizationId },
          }),
        ).toBe(0);
      } finally {
        proceed.release();
        await receiving;
      }
    }, 16000);

    it('returns the existing conflict when an authorized receipt loses its serializable snapshot', async () => {
      const order = await orderWith(['PRODUCT', 'PRODUCT']);
      const [a, b] = order.items;
      const site = await prisma.location.create({
        data: { organizationId, name: 'Principal', isDefault: true },
      });
      await prisma.organizationUser.create({
        data: { organizationId, userId, role: 'ADMIN' },
      });
      const [first, second] = await compete(
        { model: 'purchaseOrder', method: 'update' },
        (service) => receive(service, order.id, a.id, 5),
        (service) =>
          service.receive(
            order.id,
            {
              items: [{ itemId: b.id, qtyReceivedNow: 5 }],
              locationId: site.id,
            },
            userId,
            organizationId,
            {
              organizationId,
              userId,
              role: 'ADMIN',
              email: `${label}@example.test`,
              tokenVersion: 0,
              isSuperAdmin: false,
            },
          ),
      );
      expect(first).toMatchObject({ ok: true });
      expect(second).toMatchObject({
        ok: false,
        error: {
          status: 409,
          message: 'Recepción concurrente; revise la orden y vuelva a intentar',
        },
      });
      const after = await readOrder(order.id);
      expect(after).toMatchObject({
        status: 'PARTIAL_RECEIVED',
        receivedAt: null,
      });
      const items = new Map(after.items.map((item) => [item.id, item]));
      expect(items.get(a.id)).toMatchObject({
        qtyReceived: 5,
        product: { stock: 5 },
      });
      expect(items.get(b.id)).toMatchObject({
        qtyReceived: 0,
        product: { stock: 0, version: 0 },
      });
      expect(
        await prisma.inventoryMovement.findMany({
          where: {
            productId: { in: [a.productId, b.productId] },
            organizationId,
          },
          select: { productId: true, locationId: true, quantity: true },
        }),
      ).toEqual([{ productId: a.productId, locationId: null, quantity: 5 }]);
      expect(
        await prisma.productStock.count({ where: { organizationId } }),
      ).toBe(0);
    }, 16000);
  },
);
