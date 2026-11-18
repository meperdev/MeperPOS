import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PurchaseOrderDocumentsService } from './purchase-order-documents.service';
import { buildPurchaseOrderSnapshot } from './purchase-order-document';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (
  b: Uint8Array,
) => Promise<{ text: string }>;

describe('PurchaseOrderDocumentsService', () => {
  const prismaMock = {
    purchaseOrder: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const settingsMock = { find: jest.fn() };
  const purchaseOrdersMock = { findOne: jest.fn() };
  let service: PurchaseOrderDocumentsService;

  const settings = (name: string, paymentTerms: string) => ({
    organization: {
      name,
      logoUrl: null,
      taxId: '901000111-1',
      phone: null,
      address: 'Calle 1 # 2-3',
    },
    purchaseOrder: {
      deliveryAddress: '',
      paymentTerms,
      terms: '',
      footer: '',
    },
  });

  const order = (overrides: Record<string, unknown> = {}) => ({
    id: 'po-1',
    orderNumber: 12,
    status: 'PENDING',
    notes: null,
    createdAt: new Date('2026-11-17T14:00:00.000Z'),
    confirmedAt: new Date('2026-11-17T15:00:00.000Z'),
    expectedDeliveryDate: null,
    cancelledAt: null,
    sentAt: null,
    sentVia: null,
    documentSnapshot: null,
    subtotal: '100',
    taxAmount: '19',
    total: '119',
    supplier: {
      name: 'Distribuidora Andina',
      documentNumber: '900111222-3',
      contactName: null,
      phone: null,
      email: null,
      address: null,
    },
    createdBy: { name: 'Santiago' },
    items: [
      {
        id: 'poi-1',
        qtyOrdered: 1,
        unitCost: '100',
        taxRate: '19',
        subtotal: '100',
        taxAmount: '19',
        product: { name: 'Café', sku: 'CAF' },
      },
    ],
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PurchaseOrderDocumentsService(
      prismaMock as never,
      settingsMock as never,
      purchaseOrdersMock as never,
    );
    purchaseOrdersMock.findOne.mockResolvedValue({ id: 'po-1' });
  });

  describe('send', () => {
    it.each(['DRAFT', 'CANCELLED'])(
      'refuses to send a %s order',
      async (status) => {
        prismaMock.purchaseOrder.findFirst.mockResolvedValue(order({ status }));

        await expect(service.send('po-1', 'org-1')).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(prismaMock.purchaseOrder.updateMany).not.toHaveBeenCalled();
      },
    );

    it('answers 404 for an order of another organization', async () => {
      prismaMock.purchaseOrder.findFirst.mockResolvedValue(null);

      await expect(service.send('po-1', 'org-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prismaMock.purchaseOrder.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'po-1', organizationId: 'org-1' },
        }),
      );
    });

    it('records the first send: instant, channel and snapshot, guarded by sentAt null', async () => {
      prismaMock.purchaseOrder.findFirst.mockResolvedValue(order());
      settingsMock.find.mockResolvedValue(settings('Tienda Meper', 'Contado'));
      prismaMock.purchaseOrder.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.send('po-1', 'org-1');

      expect(settingsMock.find).toHaveBeenCalledWith('org-1');
      expect(prismaMock.purchaseOrder.updateMany).toHaveBeenCalledWith({
        where: { id: 'po-1', organizationId: 'org-1', sentAt: null },
        data: {
          sentAt: expect.any(Date),
          sentVia: 'PDF',
          documentSnapshot: buildPurchaseOrderSnapshot(
            order(),
            settings('Tienda Meper', 'Contado'),
          ),
        },
      });
      expect(purchaseOrdersMock.findOne).toHaveBeenCalledWith('po-1', 'org-1');
      expect(result).toEqual({ id: 'po-1' });
    });

    it('re-sending keeps the first send untouched', async () => {
      prismaMock.purchaseOrder.findFirst.mockResolvedValue(
        order({
          sentAt: new Date('2026-11-17T16:00:00.000Z'),
          sentVia: 'PDF',
          documentSnapshot: {},
        }),
      );

      await service.send('po-1', 'org-1');

      expect(prismaMock.purchaseOrder.updateMany).not.toHaveBeenCalled();
      expect(settingsMock.find).not.toHaveBeenCalled();
    });

    it.each(['PARTIAL_RECEIVED', 'RECEIVED'])(
      'can send a %s order',
      async (status) => {
        prismaMock.purchaseOrder.findFirst.mockResolvedValue(order({ status }));
        settingsMock.find.mockResolvedValue(settings('Tienda', 'Contado'));
        prismaMock.purchaseOrder.updateMany.mockResolvedValue({ count: 1 });

        await service.send('po-1', 'org-1');

        expect(prismaMock.purchaseOrder.updateMany).toHaveBeenCalled();
      },
    );
  });

  describe('generatePdf', () => {
    it('refuses a draft: it is not a document yet', async () => {
      prismaMock.purchaseOrder.findFirst.mockResolvedValue(
        order({ status: 'DRAFT' }),
      );

      await expect(service.generatePdf('po-1', 'org-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('renders a sent order from its snapshot, not from current settings', async () => {
      const snapshot = buildPurchaseOrderSnapshot(
        order(),
        settings('Nombre al enviar', 'Contado'),
      );
      prismaMock.purchaseOrder.findFirst.mockResolvedValue(
        order({
          sentAt: new Date('2026-11-17T16:00:00.000Z'),
          documentSnapshot: JSON.parse(JSON.stringify(snapshot)),
        }),
      );
      settingsMock.find.mockResolvedValue(
        settings('Nombre cambiado', 'Crédito a 60 días'),
      );

      const { buffer, filename } = await service.generatePdf('po-1', 'org-1');
      const text = (await pdfParse(new Uint8Array(buffer))).text;

      expect(filename).toBe('orden_compra_OC-12.pdf');
      expect(text).toContain('Nombre al enviar');
      expect(text).toContain('Contado');
      expect(text).not.toContain('Nombre cambiado');
      expect(settingsMock.find).not.toHaveBeenCalled();
    });

    it('renders an unsent order from current settings without recording a send', async () => {
      prismaMock.purchaseOrder.findFirst.mockResolvedValue(order());
      settingsMock.find.mockResolvedValue(settings('Tienda actual', 'Contado'));

      const { buffer } = await service.generatePdf('po-1', 'org-1');
      const text = (await pdfParse(new Uint8Array(buffer))).text;

      expect(text).toContain('Tienda actual');
      expect(prismaMock.purchaseOrder.updateMany).not.toHaveBeenCalled();
    });
  });
});
