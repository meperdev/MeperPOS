import { Prisma } from '@prisma/client';
import { ExportsService } from './exports.service';
import { ExportQueryDto } from './dto/export.dto';
import * as csv from '@fast-csv/format';

jest.mock('@fast-csv/format', () => ({
  write: jest.fn(() => ({ pipe: jest.fn() })),
}));

// Capture the rows handed to the XLSX worksheet so the neutralization rule can
// be asserted on the exact cell values that reach a workbook.
jest.mock('exceljs', () => {
  const addRow = jest.fn();
  return {
    __addRow: addRow,
    Workbook: jest.fn().mockImplementation(() => ({
      addWorksheet: jest.fn().mockReturnValue({ addRow }),
      xlsx: { write: jest.fn().mockResolvedValue(undefined) },
    })),
  };
});

describe('ExportsService', () => {
  let service: ExportsService;

  const prismaMock = {
    inventoryMovement: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    sale: {
      findMany: jest.fn(),
    },
    product: {
      findMany: jest.fn(),
    },
    customer: {
      findMany: jest.fn(),
    },
    expense: {
      findMany: jest.fn(),
    },
  };
  const reportsMock = { getEconomicExport: jest.fn() };

  const ORG_ID = 'org-1';

  const exceljsMock = jest.requireMock<{ __addRow: jest.Mock }>('exceljs');

  const buildResMock = () => ({
    setHeader: jest.fn(),
    end: jest.fn(),
    write: jest.fn(),
    flushHeaders: jest.fn(),
    pipe: jest.fn(),
    send: jest.fn(),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ExportsService(prismaMock as never, reportsMock as never);
  });

  it('getInventoryMovements filters by organizationId', async () => {
    prismaMock.inventoryMovement.findMany.mockResolvedValue([]);
    prismaMock.inventoryMovement.count.mockResolvedValue(0);

    await service.getInventoryMovements(ORG_ID, {});

    expect(prismaMock.inventoryMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG_ID }),
      }),
    );
    expect(prismaMock.inventoryMovement.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG_ID }),
      }),
    );
  });

  it('exports expense group and label columns', async () => {
    prismaMock.expense.findMany.mockResolvedValue([
      {
        date: '2026-08-15',
        label: { name: 'Arriendo', group: { name: 'Gastos del local' } },
        description: 'Office',
        total: new Prisma.Decimal(100),
        status: 'PAID',
      },
    ]);
    await service.exportExpenses(
      ORG_ID,
      { format: 'csv', type: 'expenses' } as ExportQueryDto,
      buildResMock(),
    );
    expect(csv.write).toHaveBeenCalledWith(
      expect.arrayContaining([
        ['Date', 'Group', 'Label', 'Description', 'Total', 'Status'],
        expect.arrayContaining([
          'Gastos del local',
          'Arriendo',
          'Office',
          '100.00',
          'PAID',
        ]),
      ]),
      { headers: false },
    );
  });

  it('exportSales filters by organizationId', async () => {
    prismaMock.sale.findMany.mockResolvedValue([]);
    const res = {
      setHeader: jest.fn(),
      end: jest.fn(),
      write: jest.fn(),
      flushHeaders: jest.fn(),
      pipe: jest.fn(),
      send: jest.fn(),
    };

    await service.exportSales(
      ORG_ID,
      { format: 'pdf', type: 'sales' } as ExportQueryDto,
      res,
    );

    expect(prismaMock.sale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG_ID }),
      }),
    );
  });

  it('exportProducts filters by organizationId', async () => {
    prismaMock.product.findMany.mockResolvedValue([]);
    const res = {
      setHeader: jest.fn(),
      end: jest.fn(),
      write: jest.fn(),
      flushHeaders: jest.fn(),
      pipe: jest.fn(),
      send: jest.fn(),
    };

    await service.exportProducts(
      ORG_ID,
      { format: 'pdf', type: 'products' } as ExportQueryDto,
      res,
    );

    expect(prismaMock.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: ORG_ID,
          active: true,
        }),
      }),
    );
  });

  // `exportToCSV`/`exportToExcel` pair one header row with one row per
  // product, and `getColumnWidths('products')` supplies one width per header.
  // A data row with a different cell count than the headers shifts every
  // following value under the wrong header and pushes the last one out, so the
  // count and the order are the contract. Product owns a `category` relation
  // and has no `label`, and `getProductsData` selects `category.name`.
  it('keeps the products export aligned: one cell per header, in header order', async () => {
    prismaMock.product.findMany.mockResolvedValue([
      {
        name: 'Coca Cola 1.5L',
        sku: 'SKU-1',
        category: { name: 'Bebidas' },
        salePrice: new Prisma.Decimal('2500.00'),
        costPrice: new Prisma.Decimal('1800.00'),
        stock: 12,
        minStock: 4,
      },
    ]);

    await service.exportProducts(
      ORG_ID,
      { format: 'csv', type: 'products' } as ExportQueryDto,
      buildResMock(),
    );
    await service.exportProducts(
      ORG_ID,
      { format: 'excel', type: 'products' } as ExportQueryDto,
      buildResMock(),
    );

    const [headers, csvRow] = csvRows();
    const xlsxHeaders = xlsxRow(0);
    const xlsxDataRow = xlsxRow();

    expect(headers).toEqual([
      'Name',
      'SKU',
      'Category',
      'Price',
      'Cost',
      'Stock',
      'Min Stock',
    ]);
    expect(xlsxHeaders).toEqual(headers);

    const expectedRow = [
      'Coca Cola 1.5L',
      'SKU-1',
      'Bebidas',
      '2500.00',
      '1800.00',
      12,
      4,
    ];

    expect(csvRow).toHaveLength(headers.length);
    expect(csvRow).toEqual(expectedRow);
    expect(xlsxDataRow).toHaveLength(xlsxHeaders.length);
    expect(xlsxDataRow).toEqual(expectedRow);
  });

  it('exportCustomers filters by organizationId', async () => {
    prismaMock.customer.findMany.mockResolvedValue([]);
    const res = {
      setHeader: jest.fn(),
      end: jest.fn(),
      write: jest.fn(),
      flushHeaders: jest.fn(),
      pipe: jest.fn(),
      send: jest.fn(),
    };

    await service.exportCustomers(
      ORG_ID,
      { format: 'pdf', type: 'customers' } as ExportQueryDto,
      res,
    );

    expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: ORG_ID,
          active: true,
        }),
      }),
    );
  });

  it('exportCustomers writes 8 customer headers and rows with referencia/placaMoto (null renders N/A)', async () => {
    prismaMock.customer.findMany.mockResolvedValue([
      {
        name: 'Juan Pérez',
        documentType: 'CC',
        documentNumber: '1234567890',
        email: null,
        phone: null,
        segment: 'OCCASIONAL',
        referencia: null,
        placaMoto: null,
      },
    ]);

    await service.exportCustomers(
      ORG_ID,
      { format: 'csv', type: 'customers' } as ExportQueryDto,
      buildResMock(),
    );

    expect(csv.write).toHaveBeenCalledWith(
      [
        [
          'Name',
          'Document Type',
          'Document #',
          'Email',
          'Phone',
          'Segment',
          'Referencia',
          'Placa de la moto',
        ],
        [
          'Juan Pérez',
          'CC',
          '1234567890',
          'N/A',
          'N/A',
          'OCCASIONAL',
          'N/A',
          'N/A',
        ],
      ],
      { headers: false },
    );
  });

  it('exportCustomers renders real referencia/placaMoto values, not N/A', async () => {
    prismaMock.customer.findMany.mockResolvedValue([
      {
        name: 'Laura Gómez',
        documentType: 'CC',
        documentNumber: '555666777',
        email: 'laura@example.com',
        phone: '3001234567',
        segment: 'VIP',
        referencia: 'Ref-01',
        placaMoto: 'ABC-123',
      },
    ]);

    await service.exportCustomers(
      ORG_ID,
      { format: 'csv', type: 'customers' } as ExportQueryDto,
      buildResMock(),
    );

    expect(csv.write).toHaveBeenCalledWith(
      [
        expect.arrayContaining(['Name', 'Referencia', 'Placa de la moto']),
        [
          'Laura Gómez',
          'CC',
          '555666777',
          'laura@example.com',
          '3001234567',
          'VIP',
          'Ref-01',
          'ABC-123',
        ],
      ],
      { headers: false },
    );
  });

  it('exportInventory filters by organizationId', async () => {
    prismaMock.inventoryMovement.findMany.mockResolvedValue([]);
    const res = {
      setHeader: jest.fn(),
      end: jest.fn(),
      write: jest.fn(),
      flushHeaders: jest.fn(),
      pipe: jest.fn(),
      send: jest.fn(),
    };

    await service.exportInventory(
      ORG_ID,
      { format: 'pdf', type: 'inventory' } as ExportQueryDto,
      res,
    );

    expect(prismaMock.inventoryMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG_ID }),
      }),
    );
  });

  it('exportExpenses filters by organizationId, active and the expense date range', async () => {
    prismaMock.expense.findMany.mockResolvedValue([]);
    const expectedEnd = new Date('2026-08-31');
    expectedEnd.setHours(23, 59, 59, 999);

    await service.exportExpenses(
      ORG_ID,
      {
        format: 'pdf',
        type: 'expenses',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
      } as ExportQueryDto,
      buildResMock(),
    );

    expect(prismaMock.expense.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: ORG_ID,
          active: true,
          date: {
            gte: new Date('2026-08-01'),
            lte: expectedEnd,
          },
        },
        orderBy: { date: 'desc' },
        include: {
          label: { select: { name: true, group: { select: { name: true } } } },
        },
      }),
    );
  });

  it('exportExpenses writes CSV headers and rows with date, group, label, description, total and status', async () => {
    const expenseDate = new Date('2026-08-15T00:00:00.000Z');
    prismaMock.expense.findMany.mockResolvedValue([
      {
        date: expenseDate,
        label: { name: 'Arriendo', group: { name: 'Gastos del local' } },
        description: 'Arriendo agosto',
        total: new Prisma.Decimal(500000),
        status: 'PAID',
      },
    ]);

    await service.exportExpenses(
      ORG_ID,
      { format: 'csv', type: 'expenses' } as ExportQueryDto,
      buildResMock(),
    );

    expect(csv.write).toHaveBeenCalledWith(
      [
        ['Date', 'Group', 'Label', 'Description', 'Total', 'Status'],
        [
          expenseDate.toLocaleDateString(),
          'Gastos del local',
          'Arriendo',
          'Arriendo agosto',
          '500000.00',
          'PAID',
        ],
      ],
      { headers: false },
    );
  });

  it('exportExpenses exports an empty result with headers only', async () => {
    prismaMock.expense.findMany.mockResolvedValue([]);

    await service.exportExpenses(
      ORG_ID,
      { format: 'csv', type: 'expenses' } as ExportQueryDto,
      buildResMock(),
    );

    expect(csv.write).toHaveBeenCalledWith(
      [['Date', 'Group', 'Label', 'Description', 'Total', 'Status']],
      { headers: false },
    );
  });

  it('exports the Reports financial contract without converting decimal strings to numbers', async () => {
    reportsMock.getEconomicExport.mockResolvedValue({
      financial: {
        current: {
          netIncome: '100.10',
          grossProfit: '40.05',
          netProfit: '30.05',
        },
      },
      cash: {
        collections: { total: '120.10' },
        expensePayments: { total: '10.00' },
      },
      inventory: {
        current: {
          stockValue: '50.00',
          retailValue: '80.00',
          potentialProfit: '30.00',
        },
      },
    });

    await service.exportEconomic(
      ORG_ID,
      {
        format: 'csv',
        type: 'economic',
        startDate: '2026-03-01',
        endDate: '2026-03-31',
      } as ExportQueryDto,
      buildResMock(),
    );

    expect(reportsMock.getEconomicExport).toHaveBeenCalledWith(
      ORG_ID,
      '2026-03-01',
      '2026-03-31',
    );
    expect(csv.write).toHaveBeenCalledWith(
      expect.arrayContaining([
        ['financial', 'netIncome', '100.10'],
        ['inventory', 'potentialProfit', '30.00'],
      ]),
      { headers: false },
    );
  });

  it('asks for the product type when listing inventory movements', async () => {
    prismaMock.inventoryMovement.findMany.mockResolvedValue([]);

    await service.exportInventory(
      ORG_ID,
      { format: 'pdf', type: 'inventory' } as ExportQueryDto,
      buildResMock(),
    );

    expect(prismaMock.inventoryMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          product: { select: { name: true, sku: true, type: true } },
        }),
      }),
    );
  });

  it('labels each exported movement with the product type', async () => {
    prismaMock.inventoryMovement.findMany.mockResolvedValue([
      {
        createdAt: new Date('2026-05-02T10:00:00.000Z'),
        type: 'PURCHASE',
        quantity: 5,
        previousStock: 0,
        newStock: 5,
        product: { name: 'MANTENIMIENTO', sku: 'SERV 4', type: 'SERVICE' },
        user: { name: 'User' },
      },
    ]);

    await service.exportInventory(
      ORG_ID,
      { format: 'csv', type: 'inventory' } as ExportQueryDto,
      buildResMock(),
    );

    // Columns: Date, Product, Product Type, Type, Quantity, Previous Stock, New Stock, User.
    // csv.write is called with [headers, ...dataRows], so index 1 is the first data row.
    const writtenRows = (csv.write as jest.Mock).mock
      .calls[0][0] as unknown[][];
    expect(writtenRows[1][2]).toBe('SERVICE');
  });

  // CWE-1236: a cell whose text starts with =, +, -, @, TAB or CR is executed
  // as a formula by Excel/Sheets/LibreOffice. The neutralized cell must render
  // the original text in a spreadsheet, so the prefix is a single quote.
  const DANGEROUS_PREFIXES: Array<[string, string]> = [
    ['=', '=SUM(A1)'],
    ['+', '+SUM(A1)'],
    ['-', '-SUM(A1)'],
    ['@', '@SUM(A1)'],
    ['TAB', '\tSUM(A1)'],
    ['CR', '\rSUM(A1)'],
  ];

  const buildProduct = (name: string) => ({
    name,
    sku: 'SKU-1',
    category: { name: 'Bebidas' },
    salePrice: new Prisma.Decimal('10.00'),
    costPrice: new Prisma.Decimal('5.00'),
    stock: 3,
    minStock: 1,
  });

  const csvRows = () =>
    (csv.write as jest.Mock).mock.calls[0][0] as unknown[][];

  // addRow is called once with the header row and once with each data row;
  // each mock.calls entry is the call's argument list, so [index][0] is that
  // row (0 = headers, 1 = first data row).
  const xlsxRow = (index = 1) =>
    exceljsMock.__addRow.mock.calls[index][0] as unknown[];

  it.each(DANGEROUS_PREFIXES)(
    'neutralizes a CSV cell value beginning with %s',
    async (_label, payload) => {
      prismaMock.product.findMany.mockResolvedValue([buildProduct(payload)]);

      await service.exportProducts(
        ORG_ID,
        { format: 'csv', type: 'products' } as ExportQueryDto,
        buildResMock(),
      );

      expect(csvRows()[1][0]).toBe(`'${payload}`);
    },
  );

  it.each(DANGEROUS_PREFIXES)(
    'neutralizes an XLSX cell value beginning with %s',
    async (_label, payload) => {
      prismaMock.product.findMany.mockResolvedValue([buildProduct(payload)]);

      await service.exportProducts(
        ORG_ID,
        { format: 'excel', type: 'products' } as ExportQueryDto,
        buildResMock(),
      );

      // addRow is called once with the header row and once with the data row.
      expect(xlsxRow()[0]).toBe(`'${payload}`);
    },
  );

  it('keeps benign strings, numbers, nulls and decimals byte-identical in CSV and XLSX', async () => {
    prismaMock.product.findMany.mockResolvedValue([
      {
        name: 'Coca Cola 1.5L',
        sku: null,
        category: { name: 'Bebidas' },
        salePrice: new Prisma.Decimal('1.5'),
        costPrice: new Prisma.Decimal('0.9'),
        stock: 12,
        minStock: 0,
      },
    ]);

    const expectedRow = [
      'Coca Cola 1.5L',
      null,
      'Bebidas',
      '1.50',
      '0.90',
      12,
      0,
    ];

    await service.exportProducts(
      ORG_ID,
      { format: 'csv', type: 'products' } as ExportQueryDto,
      buildResMock(),
    );
    expect(csvRows()[1]).toEqual(expectedRow);

    await service.exportProducts(
      ORG_ID,
      { format: 'excel', type: 'products' } as ExportQueryDto,
      buildResMock(),
    );
    expect(xlsxRow()).toEqual(expectedRow);
  });

  it('does not double-prefix an already neutralized value', async () => {
    prismaMock.product.findMany.mockResolvedValue([buildProduct("'=SUM(A1)")]);

    await service.exportProducts(
      ORG_ID,
      { format: 'csv', type: 'products' } as ExportQueryDto,
      buildResMock(),
    );

    expect(csvRows()[1][0]).toBe("'=SUM(A1)");
  });

  it('neutralizes dangerous text in the expense row while leaving money and dates alone', async () => {
    const expenseDate = new Date('2026-08-15T00:00:00.000Z');
    prismaMock.expense.findMany.mockResolvedValue([
      {
        date: expenseDate,
        label: { name: '=LABEL', group: { name: '@GROUP' } },
        description: '+DESC',
        total: new Prisma.Decimal(500000),
        status: '-PAID',
      },
    ]);

    await service.exportExpenses(
      ORG_ID,
      { format: 'csv', type: 'expenses' } as ExportQueryDto,
      buildResMock(),
    );

    expect(csvRows()[1]).toEqual([
      expenseDate.toLocaleDateString(),
      "'@GROUP",
      "'=LABEL",
      "'+DESC",
      '500000.00',
      "'-PAID",
    ]);
  });

  it('neutralizes the inventory text columns while leaving numeric stock cells alone', async () => {
    prismaMock.inventoryMovement.findMany.mockResolvedValue([
      {
        createdAt: new Date('2026-05-02T10:00:00.000Z'),
        type: '=TYPE',
        quantity: 5,
        previousStock: 0,
        newStock: 5,
        product: { name: '@Producto', sku: 'SERV 4', type: '+SERVICE' },
        user: { name: '-User' },
      },
    ]);

    await service.exportInventory(
      ORG_ID,
      { format: 'csv', type: 'inventory' } as ExportQueryDto,
      buildResMock(),
    );

    const row = csvRows()[1];
    expect(row[1]).toBe("'@Producto");
    expect(row[2]).toBe("'+SERVICE");
    expect(row[3]).toBe("'=TYPE");
    expect(row[4]).toBe(5);
    expect(row[7]).toBe("'-User");
  });
});
