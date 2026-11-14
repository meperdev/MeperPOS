import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { ExportQueryDto, InventoryMovementsQueryDto } from './dto/export.dto';
import * as ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import * as csv from '@fast-csv/format';

@Injectable()
export class ExportsService {
  constructor(
    private prisma: PrismaService,
    private reportsService?: ReportsService,
  ) {}

  async getInventoryMovements(
    organizationId: string | undefined,
    query: InventoryMovementsQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      ...(organizationId ? { organizationId } : {}),
    };

    if (query.productId) {
      where.productId = query.productId;
    }

    if (query.startDate || query.endDate) {
      const createdAt: Record<string, Date> = {};

      if (query.startDate) {
        createdAt.gte = new Date(query.startDate);
      }

      if (query.endDate) {
        const end = new Date(query.endDate);
        end.setHours(23, 59, 59, 999);
        createdAt.lte = end;
      }

      where.createdAt = createdAt;
    }

    const [data, total] = await Promise.all([
      this.prisma.inventoryMovement.findMany({
        where: where as never,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          product: true,
        },
      }),
      this.prisma.inventoryMovement.count({ where: where as never }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async exportSales(
    organizationId: string | undefined,
    query: ExportQueryDto,
    response: any,
  ) {
    const sales = await this.getSalesData(organizationId, query);
    return this.exportData(sales, 'sales', query.format, response);
  }

  async exportProducts(
    organizationId: string | undefined,
    query: ExportQueryDto,
    response: any,
  ) {
    const products = await this.getProductsData(organizationId, query);
    return this.exportData(products, 'products', query.format, response);
  }

  async exportCustomers(
    organizationId: string | undefined,
    query: ExportQueryDto,
    response: any,
  ) {
    const customers = await this.getCustomersData(organizationId, query);
    return this.exportData(customers, 'customers', query.format, response);
  }

  async exportInventory(
    organizationId: string | undefined,
    query: ExportQueryDto,
    response: any,
  ) {
    const movements = await this.getInventoryData(organizationId, query);
    return this.exportData(movements, 'inventory', query.format, response);
  }

  async exportExpenses(
    organizationId: string | undefined,
    query: ExportQueryDto,
    response: any,
  ) {
    const expenses = await this.getExpensesData(organizationId, query);
    return this.exportData(expenses, 'expenses', query.format, response);
  }

  async exportEconomic(
    organizationId: string | undefined,
    query: ExportQueryDto,
    response: any,
  ) {
    if (!this.reportsService) {
      throw new Error('Reports service is required for economic exports');
    }
    const report = await this.reportsService.getEconomicExport(
      organizationId,
      query.startDate,
      query.endDate,
    );
    const rows = [
      ['financial', 'netIncome', report.financial.current.netIncome],
      ['financial', 'grossProfit', report.financial.current.grossProfit],
      ['financial', 'netProfit', report.financial.current.netProfit],
      ['cash', 'collections', report.cash.collections.total],
      ['cash', 'expensePayments', report.cash.expensePayments.total],
      ['inventory', 'stockValue', report.inventory.current.stockValue],
      ['inventory', 'retailValue', report.inventory.current.retailValue],
      [
        'inventory',
        'potentialProfit',
        report.inventory.current.potentialProfit,
      ],
    ];
    return this.exportData(rows, 'economic', query.format, response);
  }

  private async getSalesData(
    organizationId: string | undefined,
    query: ExportQueryDto,
  ) {
    const where: any = { ...(organizationId ? { organizationId } : {}) };
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) {
        const end = new Date(query.endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    return this.prisma.sale.findMany({
      where,
      take: query.limit || undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        items: { include: { product: true } },
        customer: true,
        payments: true,
      },
    });
  }

  private async getProductsData(
    organizationId: string | undefined,
    query: ExportQueryDto,
  ) {
    return this.prisma.product.findMany({
      where: { ...(organizationId ? { organizationId } : {}), active: true },
      take: query.limit || undefined,
      orderBy: { createdAt: 'desc' },
      include: { category: { select: { name: true } } },
    });
  }

  private async getCustomersData(
    organizationId: string | undefined,
    query: ExportQueryDto,
  ) {
    return this.prisma.customer.findMany({
      where: { ...(organizationId ? { organizationId } : {}), active: true },
      take: query.limit || undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  private async getInventoryData(
    organizationId: string | undefined,
    query: ExportQueryDto,
  ) {
    const where: any = { ...(organizationId ? { organizationId } : {}) };
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) {
        const end = new Date(query.endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    return this.prisma.inventoryMovement.findMany({
      where,
      take: query.limit || undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        product: { select: { name: true, sku: true, type: true } },
        user: { select: { name: true } },
      },
    });
  }

  private async getExpensesData(
    organizationId: string | undefined,
    query: ExportQueryDto,
  ) {
    const where: any = {
      ...(organizationId ? { organizationId } : {}),
      active: true,
    };
    if (query.startDate || query.endDate) {
      where.date = {};
      if (query.startDate) where.date.gte = new Date(query.startDate);
      if (query.endDate) {
        const end = new Date(query.endDate);
        end.setHours(23, 59, 59, 999);
        where.date.lte = end;
      }
    }

    return this.prisma.expense.findMany({
      where,
      take: query.limit || undefined,
      orderBy: { date: 'desc' },
      include: {
        label: { select: { name: true, group: { select: { name: true } } } },
      },
    });
  }

  private async exportData(
    data: any[],
    type: string,
    format: string,
    response: any,
  ) {
    switch (format) {
      case 'excel':
        await this.exportToExcel(data, type, response);
        break;
      case 'csv':
        await this.exportToCSV(data, type, response);
        break;
      case 'pdf':
        await this.exportToPDF(data, type, response);
        break;
    }
  }

  private async exportToExcel(data: any[], type: string, response: any) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(type);
    worksheet.addRow(this.getHeaders(type));
    data.forEach((item) => worksheet.addRow(this.getRowData(type, item)));

    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename=${type}_${Date.now()}.xlsx`,
    );
    await workbook.xlsx.write(response);
    response.end();
  }

  private async exportToCSV(data: any[], type: string, response: any) {
    const csvData = [
      this.getHeaders(type),
      ...data.map((item) => this.getRowData(type, item)),
    ];

    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename=${type}_${Date.now()}.csv`,
    );
    response.write('\uFEFF');
    response.flushHeaders();

    csv.write(csvData, { headers: false }).pipe(response);
  }

  private async exportToPDF(data: any[], type: string, response: any) {
    const doc = new jsPDF();

    doc.setFontSize(16);
    doc.text(`${type.charAt(0).toUpperCase() + type.slice(1)} Report`, 14, 20);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 30);

    doc.setFontSize(8);

    let y = 50;
    const margin = 14;

    const headers = this.getHeaders(type);
    const colWidths = this.getColumnWidths(type);

    let x = margin;
    headers.forEach((header: string, index: number) => {
      doc.rect(x, y, colWidths[index], 10, 'S');
      doc.text(header, x + 2, y + 6);
      x += colWidths[index];
    });
    y += 10;

    data.forEach((item) => {
      const rowData = this.getRowData(type, item);
      x = margin;

      if (y > 270) {
        doc.addPage();
        y = 20;
      }

      rowData.forEach((cell: any, index: number) => {
        doc.rect(x, y, colWidths[index], 10, 'S');
        const text = String(cell).substring(0, 20);
        doc.text(text, x + 2, y + 6);
        x += colWidths[index];
      });
      y += 10;
    });

    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename=${type}_${Date.now()}.pdf`,
    );
    response.send(Buffer.from(doc.output('arraybuffer')));
  }

  private getHeaders(type: string): string[] {
    const headers: Record<string, string[]> = {
      sales: [
        'Sale #',
        'Date',
        'Customer',
        'Total',
        'Status',
        'Payment Method',
      ],
      products: [
        'Name',
        'SKU',
        'Category',
        'Price',
        'Cost',
        'Stock',
        'Min Stock',
      ],
      customers: [
        'Name',
        'Document Type',
        'Document #',
        'Email',
        'Phone',
        'Segment',
        'Referencia',
        'Placa de la moto',
      ],
      inventory: [
        'Date',
        'Product',
        'Product Type',
        'Type',
        'Quantity',
        'Previous Stock',
        'New Stock',
        'User',
      ],
      expenses: ['Date', 'Group', 'Label', 'Description', 'Total', 'Status'],
      economic: ['Section', 'Metric', 'Value'],
    };
    return headers[type] || [];
  }

  /**
   * Neutralizes CSV/SpreadsheetML/XLSX formula injection (CWE-1236).
   *
   * Excel, Sheets and LibreOffice interpret a cell whose text begins with
   * `=`, `+`, `-`, `@`, TAB or CR as a formula. Prepending a single quote
   * makes the spreadsheet render the original text. The rule is idempotent
   * (a value that already carries the prefix is untouched) and never coerces
   * non-strings, so numbers, dates, booleans, null/undefined and the
   * `toFixed(2)` money strings keep their current representation.
   */
  private neutralizeFormulaText<T>(value: T): T | string {
    if (typeof value !== 'string') {
      return value;
    }
    if (value.startsWith("'")) {
      return value;
    }
    return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  }

  private getRowData(type: string, item: any): any[] {
    const getters: Record<string, (item: any) => any[]> = {
      sales: (item) => [
        this.neutralizeFormulaText(item.saleNumber),
        this.neutralizeFormulaText(
          new Date(item.createdAt).toLocaleDateString(),
        ),
        this.neutralizeFormulaText(item.customer?.name || 'N/A'),
        Number(item.total).toFixed(2),
        this.neutralizeFormulaText(item.status),
        this.neutralizeFormulaText(
          item.payments?.map((p: { method: string }) => p.method).join(', ') ||
            'N/A',
        ),
      ],
      products: (item) => [
        this.neutralizeFormulaText(item.name),
        this.neutralizeFormulaText(item.sku),
        this.neutralizeFormulaText(item.category?.name || 'N/A'),
        Number(item.salePrice).toFixed(2),
        Number(item.costPrice).toFixed(2),
        item.stock,
        item.minStock,
      ],
      customers: (item) => [
        this.neutralizeFormulaText(item.name),
        this.neutralizeFormulaText(item.documentType),
        this.neutralizeFormulaText(item.documentNumber),
        this.neutralizeFormulaText(item.email || 'N/A'),
        this.neutralizeFormulaText(item.phone || 'N/A'),
        this.neutralizeFormulaText(item.segment),
        this.neutralizeFormulaText(item.referencia || 'N/A'),
        this.neutralizeFormulaText(item.placaMoto || 'N/A'),
      ],
      inventory: (item) => [
        this.neutralizeFormulaText(
          new Date(item.createdAt).toLocaleDateString(),
        ),
        this.neutralizeFormulaText(item.product?.name || 'N/A'),
        this.neutralizeFormulaText(item.product?.type || 'N/A'),
        this.neutralizeFormulaText(item.type),
        item.quantity,
        item.previousStock,
        item.newStock,
        this.neutralizeFormulaText(item.user?.name || 'N/A'),
      ],
      expenses: (item) => [
        this.neutralizeFormulaText(new Date(item.date).toLocaleDateString()),
        this.neutralizeFormulaText(item.label?.group?.name || 'N/A'),
        this.neutralizeFormulaText(item.label?.name || 'N/A'),
        this.neutralizeFormulaText(item.description || 'N/A'),
        Number(item.total).toFixed(2),
        this.neutralizeFormulaText(item.status),
      ],
      economic: (item) =>
        item.map((cell: unknown) => this.neutralizeFormulaText(cell)),
    };
    return getters[type](item);
  }

  private getColumnWidths(type: string): number[] {
    const widths: Record<string, number[]> = {
      sales: [20, 30, 40, 25, 25, 30],
      products: [50, 25, 25, 20, 20, 15, 15],
      customers: [35, 25, 25, 30, 25, 20, 30, 28],
      inventory: [25, 40, 18, 25, 15, 20, 20, 25],
      expenses: [25, 30, 30, 40, 20, 20],
      economic: [30, 40, 30],
    };
    return widths[type] || [];
  }
}
