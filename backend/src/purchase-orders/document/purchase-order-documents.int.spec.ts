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

  it('cannot download or repeat an order of another organization', async () => {
    await expect(
      documents.generatePdf(foreignOrderId, fixture.orgAId),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      orders.duplicate(foreignOrderId, {}, fixture.userAId, fixture.orgAId),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(
      await prisma.purchaseOrder.count({
        where: { organizationId: fixture.orgAId },
      }),
    ).toBe(3);
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
    // A request with no destination lands at the organization default site.
    const principal = await prisma.location.findFirstOrThrow({
      where: { organizationId: fixture.orgAId, isDefault: true },
      select: { id: true },
    });

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
      locationId: principal.id,
    });
  });

  it('finishes a sent order at an authorized destination without changing its frozen PDF', async () => {
    const { orgAId: organizationId, userAId: userId } = fixture;
    const actor = {
      organizationId,
      userId,
      email: 'receipt@example.test',
      role: 'MEMBER' as const,
      tokenVersion: 0,
      isSuperAdmin: false,
    };
    await prisma.organizationUser.create({
      data: { organizationId, userId, role: actor.role },
    });
    // T3a: each fixture product already opened its own tenant's default-site
    // row, so both sites exist and the receipt only accepts the sole principal
    // site of the receiving tenant.
    const principal = await prisma.location.findFirstOrThrow({
      where: { organizationId, isDefault: true },
      select: { id: true },
    });
    const foreign = await prisma.location.findFirstOrThrow({
      where: { organizationId: fixture.orgBId, isDefault: true },
      select: { id: true },
    });
    const snapshot = async () => ({
      order: await prisma.purchaseOrder.findUniqueOrThrow({
        where: { id: lateOrderId },
        include: { items: { include: { product: true } } },
      }),
      movements: await prisma.inventoryMovement.count({
        where: { organizationId },
      }),
      audits: await prisma.auditLog.count({ where: { organizationId } }),
      siteBalances: await prisma.productStock.count({
        where: { organizationId },
      }),
      siteLedger: await prisma.productStock.findMany({
        where: { organizationId },
        orderBy: { productId: 'asc' },
        select: {
          productId: true,
          locationId: true,
          organizationId: true,
          stock: true,
          reservedStock: true,
        },
      }),
    });
    const before = await snapshot();
    const [item] = before.order.items;
    const qty = item.qtyOrdered - item.qtyReceived;
    const receive = (locationId: string) =>
      orders.receive(
        lateOrderId,
        { items: [{ itemId: item.id, qtyReceivedNow: qty }], locationId },
        userId,
        organizationId,
        actor,
      );
    for (const site of [principal.id, foreign.id]) {
      await expect(receive(site)).rejects.toMatchObject({
        status: 404,
        message: 'Location not found',
      });
      expect(await snapshot()).toEqual(before);
    }
    const grant = { organizationId, userId, locationId: principal.id };
    await prisma.membershipLocation.create({ data: grant });
    const warehouse = await prisma.location.create({
      data: { organizationId, name: 'Second site' },
    });
    await expect(receive(principal.id)).rejects.toMatchObject({
      status: 409,
      message:
        'El stock global solo permite recibir compras en la única sede principal',
    });
    expect(await snapshot()).toEqual(before);
    await prisma.location.delete({ where: { id: warehouse.id } });

    const readPdf = async () => {
      const { buffer } = await documents.generatePdf(
        lateOrderId,
        organizationId,
      );
      return (await pdfParse(new Uint8Array(buffer))).text;
    };
    const originalDocument = await readPdf();
    await expect(receive(principal.id)).resolves.toMatchObject({
      status: 'RECEIVED',
    });
    const after = await snapshot();
    expect(after.order).toMatchObject({
      status: 'RECEIVED',
      receivedAt: expect.any(Date),
      sentAt: before.order.sentAt,
      sentVia: before.order.sentVia,
      documentSnapshot: before.order.documentSnapshot,
    });
    expect(after.order.items[0]).toMatchObject({
      qtyReceived: item.qtyOrdered,
      product: {
        stock: item.product.stock + qty,
        reservedStock: item.product.reservedStock,
      },
    });
    expect(after.movements).toBe(before.movements + 1);
    expect(after.siteBalances).toBe(before.siteBalances);
    // The receipt credits the destination site row; the organization aggregate
    // follows through the ledger's delta trigger and stays the sum of the sites.
    const destinationBefore = before.siteLedger.find(
      (row) => row.locationId === principal.id,
    )!;
    expect(after.siteLedger).toEqual([
      {
        productId: item.productId,
        locationId: principal.id,
        organizationId,
        stock: destinationBefore.stock + qty,
        reservedStock: 0,
      },
    ]);
    expect(
      await prisma.inventoryMovement.findFirstOrThrow({
        where: {
          productId: item.productId,
          organizationId,
          locationId: principal.id,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ).toMatchObject({
      type: 'PURCHASE',
      quantity: qty,
      reason: `OC-${before.order.orderNumber}`,
    });
    expect(await readPdf()).toBe(originalDocument);
  });

  it('takes the expected delivery date at the first send and freezes it there', async () => {
    await documents.send(onTimeOrderId, fixture.orgAId, {
      expectedDeliveryDate: '2026-12-01',
    });

    const stored = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: onTimeOrderId },
    });
    expect(stored.sentAt).toBeInstanceOf(Date);
    expect(stored.expectedDeliveryDate?.toISOString()).toBe(
      '2026-12-01T00:00:00.000Z',
    );

    const { buffer } = await documents.generatePdf(
      onTimeOrderId,
      fixture.orgAId,
    );
    const text = (await pdfParse(new Uint8Array(buffer))).text;
    expect(text).toContain('01/12/2026');
  });

  it('a re-send with another date leaves the stored one alone', async () => {
    await documents.send(onTimeOrderId, fixture.orgAId, {
      expectedDeliveryDate: '2027-01-15',
    });

    const stored = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: onTimeOrderId },
    });
    expect(stored.expectedDeliveryDate?.toISOString()).toBe(
      '2026-12-01T00:00:00.000Z',
    );
  });

  it('a send with no date keeps the one set at confirm', async () => {
    await documents.send(draftOrderId, fixture.orgAId);

    const stored = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: draftOrderId },
    });
    expect(stored.sentAt).toBeInstanceOf(Date);
    expect(stored.expectedDeliveryDate?.toISOString()).toBe(
      '2026-11-25T00:00:00.000Z',
    );
  });
});
