import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { OrgRole, PrismaClient } from '@prisma/client';
import { ProductsService } from './products/products.service';
import { SalesService } from './sales/sales.service';
import { SequenceService } from './common/sequences/sequence.service';
import { CacheService } from './common/services/cache.service';
import { SettingsService } from './settings/settings.service';
import { ReceiptsService } from './receipts/receipts.service';
import { PurchaseOrdersService } from './purchase-orders/purchase-orders.service';

const url = process.env.MULTI_VERIFY_URL;
(url ? describe : describe.skip)(
  'Independent compatibility and stale PO requests',
  () => {
    const db = new PrismaClient({ datasourceUrl: url });
    const seq = new SequenceService();
    const pos = new SalesService(
      db as never,
      new CacheService(),
      new SettingsService(db as never, {} as never),
      seq,
      new ReceiptsService(),
    );
    const orders = new PurchaseOrdersService(db as never, seq);
    const inventory = new ProductsService(
      db as never,
      {} as never,
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
    async function setup(fixed?: string) {
      const tag = fixed ?? randomUUID();
      const id = (entity: string) => `${tag}-${entity}`;
      const organizationId = (
        await db.organization.create({
          data: { id: id('org'), name: tag, slug: tag },
        })
      ).id;
      const user = await db.user.create({
        data: {
          id: id('user'),
          name: tag,
          email: `${tag}@example.test`,
          password: 'not-a-credential',
          organizationUsers: {
            create: { organizationId, role: OrgRole.MEMBER },
          },
        },
      });
      const actor = {
        userId: user.id,
        email: user.email,
        role: OrgRole.MEMBER,
        organizationId,
        tokenVersion: user.tokenVersion,
        isSuperAdmin: false,
      };
      const category = await db.category.create({
        data: {
          id: id('cat'),
          name: tag,
          organizationId,
          createdAt: new Date(0),
          updatedAt: new Date(0),
        },
      });
      const product = await db.product.create({
        data: {
          id: id('product'),
          name: tag,
          sku: tag,
          categoryId: category.id,
          organizationId,
          costPrice: 100,
          salePrice: 1000,
          taxRate: 0,
          stock: 5,
          tracksStock: false,
          createdAt: new Date(0),
          updatedAt: new Date(0),
        },
      });
      // The product insert opened the organization's principal site. An
      // operational membership starts with that baseline grant (T3h), so the
      // legacy no-site requests below stay authorized.
      const principal = await db.location.findFirstOrThrow({
        where: { organizationId, isDefault: true },
        select: { id: true },
      });
      await db.membershipLocation.createMany({
        data: [{ userId: user.id, organizationId, locationId: principal.id }],
        skipDuplicates: true,
      });
      await db.organizationSequence.create({
        data: { organizationId, type: 'SALE', year: new Date().getFullYear() },
      });
      const supplier = await db.supplier.create({
        data: { name: tag, documentNumber: tag, organizationId },
      });
      const order = (status: 'DRAFT' | 'PENDING') =>
        db.purchaseOrder.create({
          data: {
            organizationId,
            supplierId: supplier.id,
            createdById: user.id,
            orderNumber: 1,
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
        tag,
        actor,
        userId: user.id,
        organizationId,
        productId: product.id,
        order,
      };
    }
    const outcome = <T>(p: Promise<T>) =>
      p.then(
        (value) => ({ value }),
        (e) => ({ status: e.status, message: e.message }),
      );
    async function holdRead<T>(
      operation: (service: PurchaseOrdersService) => Promise<T>,
      intervening: () => Promise<unknown>,
    ) {
      let signal!: () => void, release!: () => void;
      const captured = new Promise<void>((r) => {
        signal = r;
      });
      const continueRead = new Promise<void>((r) => {
        release = r;
      });
      const held = new PurchaseOrdersService(
        {
          purchaseOrder: {
            update: db.purchaseOrder.update.bind(db.purchaseOrder),
            findFirst: async (
              args: Parameters<typeof db.purchaseOrder.findFirst>[0],
            ) => {
              const stale = await db.purchaseOrder.findFirst(args);
              signal();
              await continueRead;
              return stale;
            },
          },
          $transaction: db.$transaction.bind(db),
        } as never,
        seq,
      );
      const result = outcome(operation(held));
      await captured;
      try {
        await intervening();
      } finally {
        release();
      }
      return result;
    }
    it('keeps legacy aggregate catalog bytes and accepts legacy sale + receipt request shape', async () => {
      const f = await setup(`verify-diff-${process.env.COMPAT_TAG ?? '1'}`);
      const list = await inventory.findAll(f.organizationId);
      const search = await inventory.searchProducts(f.tag, 5, f.organizationId);
      const quick = await inventory.quickSearch(f.tag, f.organizationId);
      const order = await f.order('PENDING');
      writeFileSync(
        process.env.COMPAT_OUT!,
        JSON.stringify({ list, search, quick }),
      );
      const sale = await pos.create(
        {
          items: [{ productId: f.productId, quantity: 1 }],
          payments: [{ method: 'CASH', amount: 1000 }],
        },
        f.userId,
        f.organizationId,
        f.actor,
      );
      const receipt = await orders.receive(
        order.id,
        { items: [{ itemId: order.items[0].id, qtyReceivedNow: 1 }] },
        f.userId,
        f.organizationId,
      );
      expect(sale).toMatchObject({ status: 'COMPLETED' });
      expect(receipt).toMatchObject({ status: 'RECEIVED' });
    });
    it('rejects a stale receive after cancel won and preserves PO and stock', async () => {
      const f = await setup(),
        order = await f.order('PENDING');
      const result = await holdRead(
        (svc) =>
          svc.receive(
            order.id,
            { items: [{ itemId: order.items[0].id, qtyReceivedNow: 1 }] },
            f.userId,
            f.organizationId,
          ),
        () =>
          orders.cancel(
            order.id,
            { reason: 'Cancelled by verifier' },
            f.organizationId,
          ),
      );
      const saved = await db.purchaseOrder.findUniqueOrThrow({
        where: { id: order.id },
        include: { items: true },
      });
      const product = await db.product.findUniqueOrThrow({
        where: { id: f.productId },
      });
      expect({
        result,
        status: saved.status,
        received: saved.items[0].qtyReceived,
        stock: product.stock,
      }).toEqual({
        result: {
          status: 400,
          message:
            'Solo se pueden recibir órdenes pendientes o parcialmente recibidas',
        },
        status: 'CANCELLED',
        received: 0,
        stock: 5,
      });
    });
    it('does not allow a stale metadata edit after confirmation won', async () => {
      const f = await setup(),
        order = await f.order('DRAFT');
      const result = await holdRead(
        (svc) =>
          svc.update(order.id, { notes: 'Stale edit' }, f.organizationId),
        () => orders.confirm(order.id, f.organizationId),
      );
      const saved = await db.purchaseOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect({ result, status: saved.status, notes: saved.notes }).toEqual({
        result: {
          status: 400,
          message: 'Solo se pueden editar órdenes en borrador',
        },
        status: 'PENDING',
        notes: null,
      });
    });
  },
);
