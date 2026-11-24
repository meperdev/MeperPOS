import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { PurchaseOrdersService } from './purchase-orders.service';

const databaseUrl = process.env.T21_TEST_DATABASE_URL;

function deferred() {
  let release!: () => void;
  const wait = new Promise<void>((done) => { release = done; });
  return { wait, release };
}

function settle<T>(work: Promise<T>) {
  return work.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

/**
 * Draft edits and confirmation write values another request may invalidate
 * (status, items, supplier), so each one claims the order row first and reads
 * those values again under the claim. These cases run the real service against
 * PostgreSQL: the request that read a draft is held before its write, the
 * competing request commits, and only then does the held request proceed.
 */
(databaseUrl ? describe : describe.skip)('Purchase order draft races', () => {
  const label = `t21-${randomUUID()}`;
  let prisma: PrismaClient;
  let peer: PrismaClient;
  let organizationId: string;
  let userId: string;
  let supplierId: string;
  let categoryId: string;
  let orderNumber = 0;

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (
      url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' ||
      !url.port || url.port === '5432' || url.search !== '?schema=public' ||
      !/^\/meperpos_stock_rehearsal_t21_[a-z0-9_]+$/.test(url.pathname)
    ) {
      throw new Error('Expected an explicit disposable T21 PostgreSQL database');
    }
    prisma = new PrismaClient({ datasourceUrl: url.href });
    peer = new PrismaClient({ datasourceUrl: url.href });
    const org = await prisma.organization.create({ data: { name: label, slug: label } });
    organizationId = org.id;
    const user = await prisma.user.create({ data: {
      email: `${label}@example.test`, password: 'not-a-login-credential', name: label,
    } });
    userId = user.id;
    const supplier = await prisma.supplier.create({ data: {
      name: label, documentNumber: label, organizationId,
    } });
    supplierId = supplier.id;
    const category = await prisma.category.create({ data: { name: label, organizationId } });
    categoryId = category.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    try {
      if (organizationId) {
        await prisma.purchaseOrderItem.deleteMany({ where: { organizationId } });
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

  const service = () => new PurchaseOrdersService(prisma as never, {} as never);

  /** A draft like the API creates: one 5-unit line at cost 100, 19% tax. */
  async function draftOrder() {
    const product = await prisma.product.create({ data: {
      organizationId, type: 'PRODUCT', categoryId, sku: randomUUID(), name: label,
      stock: 0, costPrice: 100, salePrice: 200, tracksStock: true, taxRate: 19,
    } });
    const order = await prisma.purchaseOrder.create({
      data: {
        organizationId, supplierId, createdById: userId, orderNumber: ++orderNumber,
        status: 'DRAFT', notes: 'Notas originales',
        subtotal: 500, taxAmount: 95, total: 595,
        items: { create: [{
          organizationId, productId: product.id, qtyOrdered: 5, unitCost: 100,
          taxRate: 19, subtotal: 500, taxAmount: 95,
        }] },
      },
      include: { items: true },
    });
    return order;
  }

  function readOrder(id: string) {
    return prisma.purchaseOrder.findUniqueOrThrow({
      where: { id }, include: { items: true },
    });
  }

  /**
   * Holds the request after its pre-write read of the order, so the competing
   * request commits while this one still carries the state it read. Its own
   * transaction is the real one.
   */
  function holdAfterOrderRead() {
    const reached = deferred();
    const proceed = deferred();
    const client = {
      product: prisma.product,
      supplier: prisma.supplier,
      purchaseOrder: {
        findFirst: async (args: Prisma.PurchaseOrderFindFirstArgs) => {
          const stale = await prisma.purchaseOrder.findFirst(args);
          reached.release();
          await proceed.wait;
          return stale;
        },
      },
      $transaction: prisma.$transaction.bind(prisma),
    };
    return {
      reached: reached.wait,
      release: () => proceed.release(),
      service: new PurchaseOrdersService(client as never, {} as never),
    };
  }

  const confirmError = {
    ok: false, error: {
      status: 400, message: 'Solo se pueden confirmar órdenes en borrador',
    },
  } as const;
  const editError = {
    ok: false, error: {
      status: 400, message: 'Solo se pueden editar órdenes en borrador',
    },
  } as const;

  it('rejects the confirmation whose order was cancelled while it waited', async () => {
    const order = await draftOrder();
    const held = holdAfterOrderRead();
    const confirming = settle(held.service.confirm(order.id, organizationId, {
      expectedDeliveryDate: '2026-12-01',
    }));
    try {
      await Promise.race([held.reached, confirming.then(() => {
        throw new Error('Confirmation did not reach its pre-write read');
      })]);
      const cancelReason = 'Synthetic cancellation';
      await expect(new PurchaseOrdersService(peer as never, {} as never)
        .cancel(order.id, { reason: cancelReason }, organizationId)).resolves.toMatchObject({
        status: 'CANCELLED', cancelReason,
      });
      held.release();
      expect(await confirming).toMatchObject(confirmError);
      expect(await readOrder(order.id)).toMatchObject({
        status: 'CANCELLED', cancelReason, confirmedAt: null,
        expectedDeliveryDate: null, notes: 'Notas originales',
        items: order.items,
      });
      expect(await prisma.purchaseOrderItem.count({ where: { organizationId } })).toBe(1);
    } finally {
      held.release();
      await confirming;
    }
  }, 16000);

  it('rejects the item replacement whose order was confirmed while it waited', async () => {
    const order = await draftOrder();
    const [item] = order.items;
    const held = holdAfterOrderRead();
    const editing = settle(held.service.update(order.id, {
      items: [{ productId: item.productId, qtyOrdered: 2, unitCost: 150 }],
      notes: 'Reemplazo',
    }, organizationId));
    try {
      await Promise.race([held.reached, editing.then(() => {
        throw new Error('Draft edit did not reach its pre-write read');
      })]);
      await expect(new PurchaseOrdersService(peer as never, {} as never)
        .confirm(order.id, organizationId, { expectedDeliveryDate: '2026-12-02' }))
        .resolves.toMatchObject({ status: 'PENDING' });
      held.release();
      expect(await editing).toMatchObject(editError);
      const after = await readOrder(order.id);
      expect(after).toMatchObject({
        status: 'PENDING', notes: 'Notas originales', confirmedAt: expect.any(Date),
        expectedDeliveryDate: new Date('2026-12-02T00:00:00.000Z'),
        items: order.items,
      });
      expect(Number(after.subtotal)).toBe(500);
      expect(Number(after.total)).toBe(595);
      expect(await prisma.purchaseOrderItem.count({ where: { organizationId } })).toBe(1);
    } finally {
      held.release();
      await editing;
    }
  }, 16000);

  it('rejects the metadata-only edit whose order was confirmed while it waited', async () => {
    const order = await draftOrder();
    const held = holdAfterOrderRead();
    const editing = settle(held.service.update(order.id, {
      notes: 'Reemplazo de metadatos',
    }, organizationId));
    try {
      await Promise.race([held.reached, editing.then(() => {
        throw new Error('Draft edit did not reach its pre-write read');
      })]);
      await expect(new PurchaseOrdersService(peer as never, {} as never)
        .confirm(order.id, organizationId, { expectedDeliveryDate: '2026-12-03' }))
        .resolves.toMatchObject({ status: 'PENDING' });
      held.release();
      expect(await editing).toMatchObject(editError);
      const after = await readOrder(order.id);
      expect(after).toMatchObject({
        status: 'PENDING', notes: 'Notas originales', confirmedAt: expect.any(Date),
        expectedDeliveryDate: new Date('2026-12-03T00:00:00.000Z'),
        items: order.items,
      });
    } finally {
      held.release();
      await editing;
    }
  }, 16000);

  it('keeps the single-request edit, confirmation and their stored values', async () => {
    const order = await draftOrder();

    const confirmed = await service().confirm(order.id, organizationId, {
      expectedDeliveryDate: '2026-12-04',
    });
    expect(confirmed).toMatchObject({
      status: 'PENDING', confirmedAt: expect.any(Date),
      expectedDeliveryDate: new Date('2026-12-04T00:00:00.000Z'),
    });

    const editable = await draftOrder();
    const [editableItem] = editable.items;
    await service().update(editable.id, {
      items: [{ productId: editableItem.productId, qtyOrdered: 2, unitCost: 150 }],
      notes: 'Pedido ajustado',
    }, organizationId);
    const replaced = await readOrder(editable.id);
    const [replacedItem] = replaced.items;
    expect(replaced).toMatchObject({
      status: 'DRAFT', confirmedAt: null, notes: 'Pedido ajustado', supplierId,
    });
    expect(replacedItem).toMatchObject({
      productId: editableItem.productId, qtyOrdered: 2,
    });
    expect(Number(replacedItem.unitCost)).toBe(150);
    expect(Number(replacedItem.subtotal)).toBe(300);
    expect(Number(replacedItem.taxAmount)).toBe(57);
    expect(Number(replaced.subtotal)).toBe(300);
    expect(Number(replaced.taxAmount)).toBe(57);
    expect(Number(replaced.total)).toBe(357);

    await service().update(editable.id, { notes: 'Solo metadatos' }, organizationId);
    expect(await readOrder(editable.id)).toMatchObject({
      status: 'DRAFT', confirmedAt: null, notes: 'Solo metadatos', supplierId,
      items: replaced.items,
    });
  }, 16000);

  it('answers 404 for a draft edit or confirmation outside the tenant', async () => {
    const order = await draftOrder();
    const foreignOrganizationId = randomUUID();
    const notFound = {
      status: 404, message: 'Orden de compra no encontrada',
    } as const;

    await expect(service().confirm(order.id, foreignOrganizationId))
      .rejects.toMatchObject(notFound);
    await expect(service().update(order.id, { notes: 'Ajeno' }, foreignOrganizationId))
      .rejects.toMatchObject(notFound);

    expect(await readOrder(order.id)).toMatchObject({
      status: 'DRAFT', confirmedAt: null, notes: 'Notas originales',
      items: order.items,
    });
  }, 16000);
});
