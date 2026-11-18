import { NotFoundException } from '@nestjs/common';
import { PurchaseOrdersService } from '../purchase-orders.service';
import { PurchaseOrderDocumentsService } from './purchase-order-documents.service';
import { SettingsService } from '../../settings/settings.service';
import {
  setupTwoOrgFixture,
  type TwoOrgFixture,
} from '../../testing/two-org-fixture';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (
  b: Uint8Array,
) => Promise<{ text: string }>;

describe('Purchase order documents — Integration', () => {
  let prisma: TwoOrgFixture['prisma'];
  let fixture: TwoOrgFixture;
  let orders: PurchaseOrdersService;
  let documents: PurchaseOrderDocumentsService;
  let supplierAId: string;
  let lateOrderId: string;
  let onTimeOrderId: string;
  let draftOrderId: string;
  let foreignOrderId: string;

  beforeAll(async () => {
    fixture = await setupTwoOrgFixture('po-documents-int');
    prisma = fixture.prisma;
    orders = new PurchaseOrdersService(prisma as never, {} as never);
    documents = new PurchaseOrderDocumentsService(
      prisma as never,
      new SettingsService(prisma as never, {} as never),
      orders,
    );

    const stamp = Date.now();
    const [supplierA, supplierB] = await Promise.all(
      [fixture.orgAId, fixture.orgBId].map((organizationId, index) =>
        prisma.supplier.create({
          data: {
            name: index === 0 ? 'Proveedor original' : 'Proveedor ajeno',
            documentNumber: `PO-DOC-${index}-${stamp}`,
            organizationId,
          },
        }),
      ),
    );
    supplierAId = supplierA.id;
    const [categoryA, categoryB] = await Promise.all(
      [fixture.orgAId, fixture.orgBId].map((organizationId) =>
        prisma.category.create({
          data: { name: `PO Doc Cat ${stamp}`, organizationId },
        }),
      ),
    );
    const [productA, productB] = await Promise.all(
      [
        [fixture.orgAId, categoryA.id],
        [fixture.orgBId, categoryB.id],
      ].map(([organizationId, categoryId], index) =>
        prisma.product.create({
          data: {
            name: 'Café de origen',
            sku: `PO-DOC-PROD-${index}-${stamp}`,
            costPrice: 100,
            salePrice: 200,
            categoryId,
            organizationId,
          },
        }),
      ),
    );

    const order = (
      organizationId: string,
      supplierId: string,
      productId: string,
      createdById: string,
      orderNumber: number,
      extra: Record<string, unknown>,
    ) =>
      prisma.purchaseOrder.create({
        data: {
          orderNumber,
          supplierId,
          createdById,
          status: 'PENDING',
          confirmedAt: new Date(),
          subtotal: 500,
          taxAmount: 0,
          total: 500,
          organizationId,
          ...extra,
          items: {
            create: {
              productId,
              qtyOrdered: 5,
              unitCost: 100,
              subtotal: 500,
              organizationId,
            },
          },
        },
      });

    const [late, onTime, draft, foreign] = await Promise.all([
      order(fixture.orgAId, supplierA.id, productA.id, fixture.userAId, 1, {
        expectedDeliveryDate: new Date('2020-01-10T00:00:00.000Z'),
      }),
      order(fixture.orgAId, supplierA.id, productA.id, fixture.userAId, 2, {
        expectedDeliveryDate: new Date('2999-01-10T00:00:00.000Z'),
      }),
      order(fixture.orgAId, supplierA.id, productA.id, fixture.userAId, 3, {
        status: 'DRAFT',
        confirmedAt: null,
      }),
      order(fixture.orgBId, supplierB.id, productB.id, fixture.userBId, 1, {
        expectedDeliveryDate: new Date('2020-01-10T00:00:00.000Z'),
      }),
    ]);
    lateOrderId = late.id;
    onTimeOrderId = onTime.id;
    draftOrderId = draft.id;
    foreignOrderId = foreign.id;
  });

  afterAll(() =>
    fixture.teardown(async () => {
      const organizationId = { in: [fixture.orgAId, fixture.orgBId] };
      await prisma.inventoryMovement.deleteMany({ where: { organizationId } });
      await prisma.purchaseOrderItem.deleteMany({ where: { organizationId } });
      await prisma.purchaseOrder.deleteMany({ where: { organizationId } });
      await prisma.product.deleteMany({ where: { organizationId } });
      await prisma.category.deleteMany({ where: { organizationId } });
      await prisma.supplier.deleteMany({ where: { organizationId } });
    }),
  );

  it('filters and flags overdue orders against the stored calendar day, inside the organization', async () => {
    const overdue = await orders.findAll(fixture.orgAId, { status: 'OVERDUE' });
    expect(overdue.data.map((order) => order.id)).toEqual([lateOrderId]);
    expect(overdue.meta.total).toBe(1);

    const all = await orders.findAll(fixture.orgAId, {});
    const flags = Object.fromEntries(
      all.data.map((order) => [order.id, order.overdue]),
    );
    expect(flags).toEqual({
      [lateOrderId]: true,
      [onTimeOrderId]: false,
      [draftOrderId]: false,
    });
  });

  it('confirm stores the expected delivery date as the same calendar day', async () => {
    await orders.confirm(draftOrderId, fixture.orgAId, {
      expectedDeliveryDate: '2026-11-25',
    });

    const stored = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: draftOrderId },
    });
    expect(stored.status).toBe('PENDING');
    expect(stored.expectedDeliveryDate?.toISOString()).toBe(
      '2026-11-25T00:00:00.000Z',
    );
  });

  it('cannot send an order of another organization and leaves it untouched', async () => {
    await expect(
      documents.send(foreignOrderId, fixture.orgAId),
    ).rejects.toBeInstanceOf(NotFoundException);

    const foreign = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: foreignOrderId },
    });
    expect(foreign.sentAt).toBeNull();
    expect(foreign.documentSnapshot).toBeNull();
  });

  it('cannot download an order of another organization', async () => {
    await expect(
      documents.generatePdf(foreignOrderId, fixture.orgAId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('freezes the document at the first send; later changes do not alter it', async () => {
    await prisma.organization.update({
      where: { id: fixture.orgAId },
      data: {
        settings: { purchaseOrderTemplate: { paymentTerms: 'Contado' } },
      },
    });

    const sent = await documents.send(lateOrderId, fixture.orgAId);
    const first = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: lateOrderId },
    });
    expect(sent.id).toBe(lateOrderId);
    expect(first.sentAt).toBeInstanceOf(Date);
    expect(first.sentVia).toBe('PDF');

    await prisma.supplier.update({
      where: { id: supplierAId },
      data: { name: 'Proveedor renombrado' },
    });
    await prisma.organization.update({
      where: { id: fixture.orgAId },
      data: {
        settings: {
          purchaseOrderTemplate: { paymentTerms: 'Crédito a 60 días' },
        },
      },
    });

    await documents.send(lateOrderId, fixture.orgAId);
    const second = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: lateOrderId },
    });
    expect(second.sentAt?.toISOString()).toBe(first.sentAt?.toISOString());
    expect(second.documentSnapshot).toEqual(first.documentSnapshot);

    const { buffer } = await documents.generatePdf(lateOrderId, fixture.orgAId);
    const text = (await pdfParse(new Uint8Array(buffer))).text;
    expect(text).toContain('Proveedor original');
    expect(text).toContain('Contado');
    expect(text).not.toContain('Proveedor renombrado');
    expect(text).not.toContain('Crédito a 60 días');
  });

  it('receiving a sent order still moves stock and keeps the send', async () => {
    const before = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: lateOrderId },
      include: { items: { include: { product: true } } },
    });
    const [item] = before.items;

    await orders.receive(
      lateOrderId,
      { items: [{ itemId: item.id, qtyReceivedNow: 2 }] },
      fixture.userAId,
      fixture.orgAId,
    );

    const after = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: lateOrderId },
      include: { items: { include: { product: true } } },
    });
    expect(after.status).toBe('PARTIAL_RECEIVED');
    expect(after.sentAt?.toISOString()).toBe(before.sentAt?.toISOString());
    expect(after.items[0].product.stock).toBe(item.product.stock + 2);
    const movement = await prisma.inventoryMovement.findFirst({
      where: { productId: item.productId, organizationId: fixture.orgAId },
    });
    expect(movement).toMatchObject({
      type: 'PURCHASE',
      quantity: 2,
      reason: `OC-${before.orderNumber}`,
    });
  });
});
