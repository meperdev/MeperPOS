import * as fs from 'fs';
import * as path from 'path';
import { ReceiptsService } from './receipts.service';
import { ConfigService } from '@nestjs/config';
import { buildReceiptData } from './receipt-data';

// pdf-parse's package entry has a debug side effect when imported without a
// parent module; import the lib entry directly (same extraction behavior).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (
  b: Uint8Array,
) => Promise<{ text: string; numpages: number }>;

const FIXTURES_DIR = path.join(
  __dirname,
  '..',
  '..',
  'test',
  'fixtures',
  'receipts',
);

const baselines: { expected: Record<string, string> } = JSON.parse(
  fs.readFileSync(path.join(FIXTURES_DIR, 'baselines.json'), 'utf-8'),
);
const inputs: Record<string, { sale: unknown; settings: unknown }> = JSON.parse(
  fs.readFileSync(path.join(FIXTURES_DIR, 'fixture-inputs.json'), 'utf-8'),
);

function normalizeExtracted(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

describe('ReceiptData contract (buildReceiptData)', () => {
  const baseSale = {
    saleNumber: 42,
    createdAt: '2026-06-15T14:30:00.000Z',
    customer: { name: 'Ana María Torres' },
    items: [
      {
        product: { name: 'Café de Origen' },
        quantity: 2,
        unitPrice: '1500',
        taxRate: '19',
        total: '3000',
      },
    ],
    payments: [{ method: 'CASH', amount: '5000' }],
    subtotal: '3000',
    taxAmount: '570',
    discountAmount: '0',
    total: '3570',
    change: '1430',
  };

  const baseSettings = {
    organization: { name: 'Tienda Test', logoUrl: null },
    invoicing: { printHeader: 'Header text', printFooter: 'Footer text' },
    receipt: { prefix: 'REC' },
  };

  it('builds receiptNumber from the settings prefix and sale number', () => {
    const data = buildReceiptData(baseSale as never, baseSettings as never);
    expect(data.receiptNumber).toBe('REC-42');
    expect(data.saleNumber).toBe(42);
  });

  it('falls back to the plain sale number when no prefix is configured', () => {
    const data = buildReceiptData(
      baseSale as never,
      {
        ...baseSettings,
        receipt: { prefix: null },
      } as never,
    );
    expect(data.receiptNumber).toBe('42');
  });

  it('maps company name, header, footer and logoUrl from settings', () => {
    const data = buildReceiptData(
      baseSale as never,
      {
        ...baseSettings,
        organization: { name: 'Mi Org', logoUrl: 'data:image/png;base64,AAA' },
      } as never,
    );
    expect(data.companyName).toBe('Mi Org');
    expect(data.header).toBe('Header text');
    expect(data.footer).toBe('Footer text');
    expect(data.logoUrl).toBe('data:image/png;base64,AAA');
  });

  it('falls back to the default company name when the organization name is empty', () => {
    const data = buildReceiptData(
      baseSale as never,
      {
        ...baseSettings,
        organization: { name: '', logoUrl: null },
      } as never,
    );
    expect(data.companyName).toBe('Mi Negocio');
  });

  it('maps customerName and falls back to null when the sale has no customer', () => {
    const withCustomer = buildReceiptData(
      baseSale as never,
      baseSettings as never,
    );
    expect(withCustomer.customerName).toBe('Ana María Torres');

    const withoutCustomer = buildReceiptData(
      { ...baseSale, customer: null } as never,
      baseSettings as never,
    );
    expect(withoutCustomer.customerName).toBeNull();
  });

  it('maps items with the display-name fallback for deleted products', () => {
    const data = buildReceiptData(baseSale as never, baseSettings as never);
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toEqual({
      name: 'Café de Origen',
      quantity: 2,
      unitPrice: 1500,
      discount: 0,
      total: 3000,
    });

    const deleted = buildReceiptData(
      {
        ...baseSale,
        items: [{ ...baseSale.items[0], product: null }],
      } as never,
      baseSettings as never,
    );
    expect(deleted.items[0].name).toBe('Producto eliminado');
  });

  it('maps customer document, seller, status and distinct tax rates', () => {
    const data = buildReceiptData(
      {
        ...baseSale,
        status: 'CANCELLED',
        cancelReason: 'Error de cobro',
        user: { name: 'Vendedor Uno' },
        customer: {
          name: 'Ana María Torres',
          documentType: 'CC',
          documentNumber: '13.870.131-6',
        },
        items: [
          { ...baseSale.items[0], taxRate: '19', discountAmount: '100' },
          { ...baseSale.items[0], taxRate: '5', discountAmount: '0' },
        ],
      } as never,
      baseSettings as never,
    );

    expect(data.customerDocument).toBe('CC 13.870.131-6');
    expect(data.sellerName).toBe('Vendedor Uno');
    expect(data.status).toBe('CANCELLED');
    expect(data.cancelReason).toBe('Error de cobro');
    expect(data.taxRates).toEqual([5, 19]);
    expect(data.items[0].discount).toBe(100);
  });

  it('defaults the status to COMPLETED and the document to null', () => {
    const data = buildReceiptData(baseSale as never, baseSettings as never);

    expect(data.status).toBe('COMPLETED');
    expect(data.sellerName).toBeNull();
    expect(data.customerDocument).toBeNull();
  });

  it('maps payments to method and numeric amount', () => {
    const data = buildReceiptData(
      {
        ...baseSale,
        payments: [
          { method: 'CASH', amount: '20000' },
          { method: 'CARD', amount: '18280' },
        ],
      } as never,
      baseSettings as never,
    );
    expect(data.payments).toEqual([
      { method: 'CASH', amount: 20000 },
      { method: 'CARD', amount: 18280 },
    ]);
  });

  it('converts monetary fields to numbers and keeps zero amounts as zero', () => {
    const data = buildReceiptData(
      {
        ...baseSale,
        discountAmount: '500',
        taxAmount: '0',
        change: null,
      } as never,
      baseSettings as never,
    );
    expect(data.subtotal).toBe(3000);
    expect(data.taxAmount).toBe(0);
    expect(data.discount).toBe(500);
    expect(data.total).toBe(3570);
    expect(data.change).toBeNull();
  });

  it('collects distinct item tax rates and defaults to an empty list', () => {
    const withItems = buildReceiptData(
      {
        ...baseSale,
        items: [
          { ...baseSale.items[0], taxRate: '19' },
          { ...baseSale.items[0], taxRate: '5' },
          { ...baseSale.items[0], taxRate: '19' },
        ],
      } as never,
      baseSettings as never,
    );
    expect(withItems.taxRates).toEqual([5, 19]);

    const noItems = buildReceiptData(
      { ...baseSale, items: [] } as never,
      baseSettings as never,
    );
    expect(noItems.taxRates).toEqual([]);
  });
});

describe('receipt logo embedding', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    [
      'svg',
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/></svg>',
      ),
    ],
    [
      'gif',
      Buffer.from(
        'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        'base64',
      ),
    ],
    [
      'webp',
      Buffer.from(
        'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA',
        'base64',
      ),
    ],
  ] as const)(
    'embeds actual rasterized local %s bytes into the PDF',
    async (extension, bytes) => {
      const stat = {
        size: bytes.length,
        dev: 1,
        ino: 1,
        isFile: () => true,
        isDirectory: () => true,
        isSymbolicLink: () => false,
      };
      jest.spyOn(fs.promises, 'lstat').mockResolvedValue(stat as never);
      jest
        .spyOn(fs.promises, 'realpath')
        .mockImplementation((path) => Promise.resolve(String(path)));
      const close = jest.fn().mockResolvedValue(undefined);
      const open = jest.spyOn(fs.promises, 'open').mockResolvedValue({
        stat: () => Promise.resolve(stat),
        read: (
          buffer: Buffer,
          offset: number,
          length: number,
          position: number,
        ) =>
          Promise.resolve({
            bytesRead: bytes.copy(buffer, offset, position, position + length),
            buffer,
          }),
        close,
      } as never);
      const service = new ReceiptsService(
        new ConfigService({ LOCAL_UPLOAD_PATH: '/receipt-fixtures' }),
      );
      const fixture = Object.values(inputs)[0];
      const basename = `12345678-1234-4123-8123-123456789abc.${extension}`;
      const pdf = await service.generateSaleReceiptPdf(
        fixture.sale as never,
        {
          ...(fixture.settings as object),
          organization: { name: 'Test', logoUrl: `/uploads/logos/${basename}` },
        } as never,
      );
      expect(open).toHaveBeenCalledWith(
        `/receipt-fixtures/logos/${basename}`,
        expect.any(Number),
      );
      expect(close).toHaveBeenCalledTimes(1);
      expect(pdf.toString('latin1')).toContain('/Subtype /Image');
      expect(pdf.toString('latin1')).toContain('/Width');
    },
  );

  it.each(['webp', 'gif', 'svg'])(
    'embeds transformed Cloudinary %s originals as PNG images',
    async (extension) => {
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4XmNgYGD4DwABBAEA43qFxAAAAABJRU5ErkJggg==',
        'base64',
      );
      const fetchMock = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(png));
      const service = new ReceiptsService(
        new ConfigService({ CLOUDINARY_CLOUD_NAME: 'receipt-test' }),
      );
      const fixture = Object.values(inputs)[0];
      const pdf = await service.generateSaleReceiptPdf(
        fixture.sale as never,
        {
          ...(fixture.settings as object),
          organization: {
            name: 'Test',
            logoUrl: `https://res.cloudinary.com/receipt-test/image/upload/v1/logos/test.${extension}`,
          },
        } as never,
      );
      expect(fetchMock).toHaveBeenCalledWith(
        'https://res.cloudinary.com/receipt-test/image/upload/c_limit,f_png,h_300,w_600/v1/logos/test.png',
        expect.any(Object),
      );
      expect(pdf.toString('latin1')).toContain('/Subtype /Image');
    },
  );

  it.each([
    [
      'png',
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4XmNgYGD4DwABBAEA43qFxAAAAABJRU5ErkJggg==',
    ],
    // One-pixel grayscale JPEG: quantization, frame, Huffman tables and scan.
    [
      'jpeg',
      '/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AP//Z',
    ],
  ])(
    'embeds remote and data URL %s bytes as PDF images',
    async (format, base64) => {
      const fixture = Object.values(inputs)[0];
      const bytes = Buffer.from(base64, 'base64');
      const fetchMock = jest
        .spyOn(globalThis, 'fetch')
        .mockImplementation(() => Promise.resolve(new Response(bytes)));
      const service = new ReceiptsService(
        new ConfigService({ CLOUDINARY_CLOUD_NAME: 'receipt-test' }),
      );
      for (const logoUrl of [
        `https://res.cloudinary.com/receipt-test/image/upload/v1/logos/test.${format}`,
        `data:image/${format};base64,${base64}`,
      ]) {
        const pdf = await service.generateSaleReceiptPdf(
          fixture.sale as never,
          {
            ...(fixture.settings as object),
            organization: { name: 'Test', logoUrl },
          } as never,
        );
        expect(pdf.toString('latin1')).toContain('/Subtype /Image');
      }
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    null,
    '/etc/passwd',
    'data:image/png;base64,AAA',
    'https://res.cloudinary.com/receipt-test/image/upload/v1/logos/broken.png',
  ])(
    'keeps the no-logo content when logo %s cannot be decoded',
    async (logoUrl) => {
      const fixture = Object.values(inputs)[0];
      const service = new ReceiptsService(
        new ConfigService({ CLOUDINARY_CLOUD_NAME: 'receipt-test' }),
      );
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('broken'));
      const pdf = await service.generateSaleReceiptPdf(
        fixture.sale as never,
        {
          ...(fixture.settings as object),
          organization: { name: 'Tienda S3 Fixtures', logoUrl },
        } as never,
      );
      expect(pdf.toString('latin1')).not.toContain('/Subtype /Image');
      expect(
        normalizeExtracted((await pdfParse(new Uint8Array(pdf))).text),
      ).toBe(Object.values(baselines.expected)[0]);
    },
  );
});

describe('ReceiptsService.generateSaleReceiptPdf (golden PDF equality)', () => {
  const service = new ReceiptsService();

  const fixtureKeys = Object.keys(baselines.expected);

  it('covers all six committed fixtures', () => {
    expect(fixtureKeys).toHaveLength(6);
  });

  describe.each(fixtureKeys)('%s', (fixtureKey) => {
    it('reproduces the committed normalized extraction', async () => {
      const { sale, settings } = inputs[fixtureKey];

      const pdf = await service.generateSaleReceiptPdf(
        sale as never,
        settings as never,
      );

      expect(Buffer.isBuffer(pdf)).toBe(true);
      expect(pdf.subarray(0, 4).toString('ascii')).toBe('%PDF');

      // Normalize native Buffer into this realm's typed array for legacy PDF.js.
      const extracted = await pdfParse(new Uint8Array(pdf));
      expect(normalizeExtracted(extracted.text)).toBe(
        baselines.expected[fixtureKey],
      );
    });
  });
});

describe('receipt formatting and layout', () => {
  const service = new ReceiptsService();

  async function extract(pdf: Buffer) {
    const parsed = await pdfParse(new Uint8Array(pdf));
    return {
      text: normalizeExtracted(parsed.text),
      pages: parsed.numpages,
    };
  }

  function pageHeight(pdf: Buffer): number {
    const match = pdf
      .toString('latin1')
      .match(/\/MediaBox \[0 0 [\d.]+ ([\d.]+)\]/);
    return match ? Number(match[1]) : 0;
  }

  it('prints the organization legal identity and hides a duplicate header', async () => {
    const { sale, settings } = inputs['fixture-1-normal-cash-change'];
    const { text } = await extract(
      await service.generateSaleReceiptPdf(
        sale as never,
        {
          ...(settings as Record<string, unknown>),
          organization: {
            name: 'Cafetería Demo',
            logoUrl: null,
            taxId: '3353745410',
            phone: '364.857.3930',
            address: '94144 Dejah Bridge',
          },
          invoicing: {
            printHeader: 'CAFETERÍA DEMO\nSucursal centro',
            printFooter: '',
          },
        } as never,
      ),
    );

    expect(text).toContain('NIT 3353745410');
    expect(text).toContain('94144 Dejah Bridge');
    expect(text).toContain('Tel. 364.857.3930');
    expect(text).toContain('COMPROBANTE DE VENTA');
    expect(text).toContain('Sucursal centro');
    expect(text.split('CAFETERÍA DEMO')).toHaveLength(2);
  });

  it('names an anonymous sale as consumidor final', async () => {
    const { sale, settings } = inputs['fixture-5-no-customer'];
    const { text } = await extract(
      await service.generateSaleReceiptPdf(sale as never, settings as never),
    );

    expect(text).toContain('Cliente: Consumidor final');
  });

  it('shows the zero-rate IVA line on tax-free sales', async () => {
    const { sale, settings } = inputs['fixture-4-zero-tax-discount'];
    const { text } = await extract(
      await service.generateSaleReceiptPdf(sale as never, settings as never),
    );

    expect(text).toContain('Subtotal$2.500');
    expect(text).toContain('Descuento-$500');
    expect(text).toContain('IVA (0%)$0');
  });

  it('prints exact COP amounts instead of K/M abbreviations', async () => {
    const { sale, settings } = inputs['fixture-5-no-customer'];
    const { text } = await extract(
      await service.generateSaleReceiptPdf(sale as never, settings as never),
    );

    expect(text).toContain('$5.900');
    expect(text).toContain('$1.121');
    expect(text).toContain('$7.021');
    expect(text).not.toContain('$6K');
    expect(text).not.toContain('M ');
  });

  it('prints full product names, the customer document and the seller', async () => {
    const { sale, settings } = inputs['fixture-6-long-header-footer-logo'];
    const { text } = await extract(
      await service.generateSaleReceiptPdf(sale as never, settings as never),
    );

    expect(text).toContain('Mochila Artesanal Tejida a Mano');
    expect(text).toContain('CC S3-2001');
    expect(text).toContain('Atendido por: S3 Fixture Admin');
    expect(text).not.toContain('Mochila Artesa..');
  });

  it('sizes the page to the content instead of a fixed 300mm sheet', async () => {
    const { sale, settings } = inputs['fixture-1-normal-cash-change'];
    const pdf = await service.generateSaleReceiptPdf(
      sale as never,
      settings as never,
    );
    const maxPoints = (300 / 25.4) * 72;

    expect(pageHeight(pdf)).toBeGreaterThan(0);
    expect(pageHeight(pdf)).toBeLessThan(maxPoints);
  });

  it('paginates long sales without dropping items or totals', async () => {
    const { sale, settings } = inputs['fixture-2-multipayment-cash-card'];
    const items = Array.from({ length: 60 }, (_, index) => ({
      product: { name: `Artículo número ${index + 1}` },
      quantity: 1,
      unitPrice: '1000',
      taxRate: '0',
      discountAmount: '0',
      total: '1000',
    }));
    const longSale = {
      ...(sale as Record<string, unknown>),
      items,
      subtotal: '60000',
      taxAmount: '0',
      discountAmount: '0',
      total: '60000',
    };

    const { text, pages } = await extract(
      await service.generateSaleReceiptPdf(
        longSale as never,
        settings as never,
      ),
    );

    expect(pages).toBeGreaterThan(1);
    expect(text).toContain('Artículo número 60');
    expect(text).toContain('TOTAL A PAGAR');
    expect(text).toContain('continuación');
    expect(text).toContain('Página 2 de');
  });

  it('labels financed sales that carry no payment rows', async () => {
    const { sale, settings } = inputs['fixture-2-multipayment-cash-card'];
    const { text } = await extract(
      await service.generateSaleReceiptPdf(
        {
          ...(sale as Record<string, unknown>),
          payments: [],
          financed: true,
        } as never,
        settings as never,
      ),
    );

    expect(text).toContain('Venta financiada (crédito)');
    expect(text).not.toContain('Sin pagos registrados');
  });

  it('stamps cancelled sales with their reason', async () => {
    const { sale, settings } = inputs['fixture-1-normal-cash-change'];
    const { text } = await extract(
      await service.generateSaleReceiptPdf(
        {
          ...(sale as Record<string, unknown>),
          status: 'CANCELLED',
          cancelReason: 'Error de cobro',
          cancelledAt: '2026-06-16T14:30:00.000Z',
        } as never,
        settings as never,
      ),
    );

    expect(text).toContain('ANULADA');
    expect(text).toContain('Motivo: Error de cobro');
    expect(text).toContain('16/6/2026');
  });

  it('lists every payment method with its exact amount', async () => {
    const { sale, settings } = inputs['fixture-2-multipayment-cash-card'];
    const { text } = await extract(
      await service.generateSaleReceiptPdf(sale as never, settings as never),
    );

    expect(text).toContain('Efectivo$20.000');
    expect(text).toContain('Tarjeta$18.280');
    expect(text).not.toContain('Mixto (2 métodos)');
  });
});
