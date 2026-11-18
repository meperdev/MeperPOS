import {
  buildPurchaseOrderDocumentData,
  buildPurchaseOrderSnapshot,
  readPurchaseOrderSnapshot,
} from './purchase-order-document';
import { renderPurchaseOrderPdf } from './purchase-order-pdf';

// pdf-parse's package entry has a debug side effect when imported without a
// parent module; import the lib entry directly (same extraction behavior).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (
  b: Uint8Array,
) => Promise<{ text: string; numpages: number }>;

function buildDocumentOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'po-1',
    orderNumber: 12,
    status: 'PENDING',
    notes: 'Entregar en la mañana',
    createdAt: new Date('2026-11-17T14:00:00.000Z'),
    confirmedAt: new Date('2026-11-17T15:00:00.000Z'),
    expectedDeliveryDate: new Date('2026-11-25T00:00:00.000Z'),
    cancelledAt: null,
    subtotal: '500000',
    taxAmount: '95000',
    total: '595000',
    supplier: {
      name: 'Distribuidora Andina',
      documentNumber: '900111222-3',
      contactName: 'Laura Gómez',
      phone: '3001234567',
      email: 'ventas@andina.co',
      address: 'Cra 10 # 20-30',
    },
    createdBy: { name: 'Santiago' },
    items: [
      {
        id: 'poi-1',
        qtyOrdered: 10,
        unitCost: '50000',
        taxRate: '19',
        subtotal: '500000',
        taxAmount: '95000',
        product: { name: 'Café de origen 500 g', sku: 'CAF-500' },
      },
    ],
    ...overrides,
  };
}

const documentSettings = {
  organization: {
    name: 'Tienda Meper',
    logoUrl: null,
    taxId: '901000111-1',
    phone: '6011234567',
    address: 'Calle 1 # 2-3',
  },
  purchaseOrder: {
    deliveryAddress: '',
    paymentTerms: 'Crédito a 30 días',
    terms: 'Se recibe solo mercancía con factura',
    footer: 'Gracias por su atención',
  },
};

describe('purchase order document', () => {
  it('freezes business, supplier, template, preparer and item names', () => {
    const snapshot = buildPurchaseOrderSnapshot(
      buildDocumentOrder(),
      documentSettings,
    );

    expect(snapshot).toEqual({
      version: 1,
      business: {
        name: 'Tienda Meper',
        taxId: '901000111-1',
        phone: '6011234567',
        address: 'Calle 1 # 2-3',
        logoUrl: null,
      },
      supplier: {
        name: 'Distribuidora Andina',
        documentNumber: '900111222-3',
        contactName: 'Laura Gómez',
        phone: '3001234567',
        email: 'ventas@andina.co',
        address: 'Cra 10 # 20-30',
      },
      // An empty delivery address means the business address.
      template: {
        deliveryAddress: 'Calle 1 # 2-3',
        paymentTerms: 'Crédito a 30 días',
        terms: 'Se recibe solo mercancía con factura',
        footer: 'Gracias por su atención',
      },
      preparedBy: 'Santiago',
      items: { 'poi-1': { name: 'Café de origen 500 g', sku: 'CAF-500' } },
    });
  });

  it('keeps a configured delivery address', () => {
    const snapshot = buildPurchaseOrderSnapshot(buildDocumentOrder(), {
      ...documentSettings,
      purchaseOrder: {
        ...documentSettings.purchaseOrder,
        deliveryAddress: 'Bodega 4, Zona Franca',
      },
    });

    expect(snapshot.template.deliveryAddress).toBe('Bodega 4, Zona Franca');
  });

  it('reads back only a well-formed snapshot', () => {
    const snapshot = buildPurchaseOrderSnapshot(
      buildDocumentOrder(),
      documentSettings,
    );

    expect(
      readPurchaseOrderSnapshot(JSON.parse(JSON.stringify(snapshot))),
    ).toEqual(snapshot);
    expect(readPurchaseOrderSnapshot(null)).toBeNull();
    expect(readPurchaseOrderSnapshot({ version: 2 })).toBeNull();
    expect(readPurchaseOrderSnapshot('x')).toBeNull();
  });

  it('builds the document from the snapshot, with the amounts stored on the order', () => {
    const snapshot = buildPurchaseOrderSnapshot(
      buildDocumentOrder(),
      documentSettings,
    );
    const renamed = buildDocumentOrder({
      supplier: { ...buildDocumentOrder().supplier, name: 'Otro nombre' },
      items: [
        {
          ...buildDocumentOrder().items[0],
          product: { name: 'Nombre nuevo', sku: 'NEW' },
        },
      ],
    });

    const data = buildPurchaseOrderDocumentData(renamed, snapshot);

    expect(data.documentNumber).toBe('OC-12');
    expect(data.supplier.name).toBe('Distribuidora Andina');
    expect(data.items).toEqual([
      {
        name: 'Café de origen 500 g',
        sku: 'CAF-500',
        quantity: 10,
        unitCost: 50000,
        taxRate: 19,
        subtotal: 500000,
      },
    ]);
    expect([data.subtotal, data.taxAmount, data.total]).toEqual([
      500000, 95000, 595000,
    ]);
  });

  it('renders a letter-size PDF with the order, supplier and template', async () => {
    const order = buildDocumentOrder();
    const data = buildPurchaseOrderDocumentData(
      order,
      buildPurchaseOrderSnapshot(order, documentSettings),
    );

    const pdf = renderPurchaseOrderPdf(data);
    const parsed = await pdfParse(new Uint8Array(pdf));
    const text = parsed.text.replace(/\s+/g, ' ');

    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    // Letter paper: 612 x 792 points.
    expect(pdf.toString('latin1')).toMatch(/\/MediaBox \[0 0 612\.? 792\.?\]/);
    for (const fragment of [
      'Tienda Meper',
      'NIT 901000111-1',
      'Orden de compra',
      'OC-12',
      '25/11/2026',
      'Distribuidora Andina',
      '900111222-3',
      'Laura Gómez',
      'ventas@andina.co',
      'Café de origen 500 g',
      'CAF-500',
      '$50.000',
      '$500.000',
      '$95.000',
      '$595.000',
      'Entregar en la mañana',
      'Calle 1 # 2-3',
      'Crédito a 30 días',
      'Se recibe solo mercancía con factura',
      'Gracias por su atención',
      'Elaborado por: Santiago',
    ]) {
      expect(text).toContain(fragment);
    }
  });

  it('paginates a long order and marks a cancelled one', async () => {
    const base = buildDocumentOrder();
    const items = Array.from({ length: 60 }, (_, index) => ({
      ...base.items[0],
      id: `poi-${index}`,
      product: { name: `Producto ${index + 1}`, sku: `SKU-${index + 1}` },
    }));
    const order = buildDocumentOrder({
      items,
      status: 'CANCELLED',
      cancelledAt: new Date('2026-11-18T15:00:00.000Z'),
    });
    const data = buildPurchaseOrderDocumentData(
      order,
      buildPurchaseOrderSnapshot(order, documentSettings),
    );

    const parsed = await pdfParse(new Uint8Array(renderPurchaseOrderPdf(data)));
    const text = parsed.text.replace(/\s+/g, ' ');

    expect(parsed.numpages).toBeGreaterThan(1);
    expect(text).toContain('Producto 60');
    expect(text).toContain(`Página 1 de ${parsed.numpages}`);
    expect(text).toContain('ORDEN CANCELADA');
  });
});
