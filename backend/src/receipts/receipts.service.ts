import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReceiptLogo, resolveReceiptLogo } from './receipt-logo';
import { jsPDF } from 'jspdf';
import { LOCALE, TIMEZONE } from '../common/constants/locale.constants';
import {
  buildReceiptData,
  ReceiptData,
  ReceiptSale,
  ReceiptSettings,
} from './receipt-data';

/**
 * Renders sale receipt PDFs for 80mm thermal paper with jsPDF.
 *
 * The receipt is built as a sequence of measured blocks: the page height is
 * computed from the content (no fixed 300mm sheet with blank space), product
 * names wrap instead of being truncated, and long sales paginate with a
 * continuation header. All amounts come from `ReceiptData`; nothing here
 * re-derives money.
 */
@Injectable()
export class ReceiptsService {
  constructor(@Optional() private readonly config?: ConfigService) {}

  async generateSaleReceiptPdf(
    sale: ReceiptSale,
    settings: ReceiptSettings,
  ): Promise<Buffer> {
    const data = buildReceiptData(sale, settings);
    const logo = await resolveReceiptLogo(
      data.logoUrl,
      this.config?.get<string>('CLOUDINARY_CLOUD_NAME'),
      this.config?.get<string>('LOCAL_UPLOAD_PATH') || './uploads',
    );
    return this.render(data, logo);
  }

  private render(data: ReceiptData, logo?: ReceiptLogo): Buffer {
    const metrics = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: [PAGE_WIDTH, PAGINATED_PAGE_HEIGHT],
    });
    const logoBox = logo ? this.logoBox(logo) : undefined;
    const { blocks, itemsHeader } = this.buildBlocks(
      metrics,
      data,
      logoBox?.reserved ?? 0,
    );
    const contentHeight =
      blocks.reduce((total, block) => total + block.height, 0) + PAGE_MARGIN;
    const paginated = contentHeight > PAGE_BREAK_LIMIT;

    if (!paginated) {
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [PAGE_WIDTH, Math.max(contentHeight + PAGE_MARGIN, 60)],
      });
      this.renderPage(doc, blocks, PAGE_MARGIN, logo, logoBox);
      return Buffer.from(doc.output('arraybuffer'));
    }

    const pages = this.paginate(blocks, itemsHeader);
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: [PAGE_WIDTH, PAGINATED_PAGE_HEIGHT],
    });

    pages.forEach((page, index) => {
      if (index > 0) {
        doc.addPage([PAGE_WIDTH, PAGINATED_PAGE_HEIGHT], 'portrait');
        this.renderContinuationHeader(doc, data);
      }
      this.renderPage(
        doc,
        page,
        index === 0 ? PAGE_MARGIN : CONTINUATION_HEADER_HEIGHT,
        index === 0 ? logo : undefined,
        index === 0 ? logoBox : undefined,
      );

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(...MUTED);
      doc.text(
        `Página ${index + 1} de ${pages.length}`,
        PAGE_WIDTH / 2,
        PAGINATED_PAGE_HEIGHT - 4,
        { align: 'center' },
      );
    });

    return Buffer.from(doc.output('arraybuffer'));
  }

  private buildBlocks(
    metrics: jsPDF,
    data: ReceiptData,
    logoReserved: number,
  ): { blocks: Block[]; itemsHeader: Block } {
    const closingGroup = 'closing' as const;
    const items = this.buildItems(metrics, data);
    return {
      itemsHeader: items.header,
      blocks: [
        this.buildHeader(metrics, data, logoReserved),
        this.buildMeta(metrics, data),
        items.header,
        ...items.items,
        items.footer,
        this.buildTotals(metrics, data, closingGroup),
        this.buildPayments(metrics, data, closingGroup),
        this.buildFooter(metrics, data, closingGroup),
      ],
    };
  }

  private buildHeader(
    metrics: jsPDF,
    data: ReceiptData,
    logoReserved: number,
  ): Block {
    const b = new BlockBuilder(metrics);
    if (logoReserved > 0) b.gap(logoReserved);
    b.paragraph(data.companyName.toUpperCase(), {
      align: 'center',
      size: 11,
      style: 'bold',
      lineHeight: 5,
    });

    for (const line of [
      data.companyTaxId ? `NIT ${data.companyTaxId}` : null,
      data.companyAddress,
      data.companyPhone ? `Tel. ${data.companyPhone}` : null,
    ]) {
      if (line) {
        b.paragraph(line, {
          align: 'center',
          size: 7,
          color: MUTED,
          lineHeight: 3.2,
        });
      }
    }

    const customHeader = this.withoutCompanyNameHeader(
      data.header,
      data.companyName,
    );
    if (customHeader) {
      b.gap(1.5);
      b.paragraph(customHeader, {
        align: 'center',
        size: 7,
        color: MUTED,
        lineHeight: 3.4,
      });
    }

    b.gap(1.5);
    b.paragraph('COMPROBANTE DE VENTA', {
      align: 'center',
      size: 8,
      style: 'bold',
      lineHeight: 4,
    });
    b.gap(2.5);
    b.rule();
    b.gap(4);
    return b.block();
  }

  private buildMeta(metrics: jsPDF, data: ReceiptData): Block {
    const b = new BlockBuilder(metrics);
    const metaBaseline = b.baseline(8);
    b.text(
      `No. ${data.receiptNumber}`,
      PAGE_MARGIN,
      'left',
      8,
      'bold',
      BLACK,
      metaBaseline,
    );
    b.text(
      this.formatDateTime(data.createdAt),
      PAGE_WIDTH - PAGE_MARGIN,
      'right',
      7,
      'normal',
      MUTED,
      metaBaseline - 0.3,
    );
    b.gap(4.8);

    b.paragraph(`Cliente: ${data.customerName || 'Consumidor final'}`, {
      size: 8,
      lineHeight: 3.8,
    });
    if (data.customerDocument) {
      b.paragraph(data.customerDocument, {
        size: 7,
        color: MUTED,
        lineHeight: 3.2,
      });
    }

    if (data.sellerName) {
      b.paragraph(`Atendido por: ${data.sellerName}`, {
        size: 7,
        color: MUTED,
        lineHeight: 3.2,
      });
    }

    if (data.status === 'CANCELLED' || data.status === 'RETURNED_PARTIAL') {
      const label =
        data.status === 'CANCELLED' ? 'ANULADA' : 'DEVOLUCIÓN PARCIAL';
      b.gap(2);
      const top = b.y;
      b.paragraph(label, {
        align: 'center',
        size: 9,
        style: 'bold',
        color: DANGER,
        lineHeight: 5,
      });
      const width = data.status === 'CANCELLED' ? 32 : 48;
      b.box((PAGE_WIDTH - width) / 2, top, width, 6.4, DANGER);
      b.gap(1.4);
      if (data.cancelReason) {
        b.paragraph(`Motivo: ${data.cancelReason}`, {
          align: 'center',
          size: 7,
          color: MUTED,
          lineHeight: 3.2,
        });
      }
      if (data.cancelledAt) {
        b.paragraph(this.formatDateTime(data.cancelledAt), {
          align: 'center',
          size: 7,
          color: MUTED,
          lineHeight: 3.2,
        });
      }
    }

    b.gap(2.5);
    b.rule();
    b.gap(4);
    return b.block();
  }

  private buildItems(
    metrics: jsPDF,
    data: ReceiptData,
  ): { header: Block; items: Block[]; footer: Block } {
    const headerBuilder = new BlockBuilder(metrics);
    headerBuilder.text('DESCRIPCIÓN', PAGE_MARGIN, 'left', 7, 'bold', MUTED);
    headerBuilder.text(
      'VALOR',
      PAGE_WIDTH - PAGE_MARGIN,
      'right',
      7,
      'bold',
      MUTED,
    );
    headerBuilder.gap(3);
    headerBuilder.rule();
    headerBuilder.gap(3.2);
    const header = {
      ...headerBuilder.block(),
      kind: 'items-header' as const,
    };

    const items: Block[] = data.items.map((item) => {
      const b = new BlockBuilder(metrics);
      const nameLines = b.wrap(item.name, 8, 'normal', CONTENT_WIDTH - 20);
      const top = b.y;
      const baseline = top + b.baselineOffset(8);
      nameLines.forEach((line, index) => {
        b.text(
          line,
          PAGE_MARGIN,
          'left',
          8,
          'normal',
          BLACK,
          baseline + index * 3.8,
        );
      });
      b.text(
        this.formatMoney(item.total),
        PAGE_WIDTH - PAGE_MARGIN,
        'right',
        8,
        'bold',
        BLACK,
        baseline,
      );
      b.gap(nameLines.length * 3.8);

      const detail = `${item.quantity} × ${this.formatMoney(item.unitPrice)}`;
      b.paragraph(
        item.discount > 0
          ? `${detail} · Desc. ${this.formatMoney(-item.discount)}`
          : detail,
        { size: 7, color: MUTED, lineHeight: 3.4 },
      );
      b.gap(1.8);
      return { ...b.block(), kind: 'item' as const };
    });

    if (items.length === 0) {
      const b = new BlockBuilder(metrics);
      b.paragraph('Sin productos registrados', {
        size: 8,
        color: MUTED,
        lineHeight: 3.8,
      });
      items.push({ ...b.block(), kind: 'item' as const });
    }

    const footerBuilder = new BlockBuilder(metrics);
    footerBuilder.gap(0.5);
    footerBuilder.rule();
    footerBuilder.gap(4);
    const footer = {
      ...footerBuilder.block(),
      kind: 'items-footer' as const,
    };

    return { header, items, footer };
  }

  private buildTotals(
    metrics: jsPDF,
    data: ReceiptData,
    group: 'closing',
  ): Block {
    const b = new BlockBuilder(metrics);
    b.row('Subtotal', this.formatMoney(data.subtotal));
    if (data.discount > 0) {
      b.row('Descuento', this.formatMoney(-data.discount));
    }
    if (data.items.length > 0) {
      b.row(this.taxLabel(data), this.formatMoney(data.taxAmount));
    }
    b.gap(1.5);
    b.rule(BLACK);
    b.gap(3);
    b.row('TOTAL A PAGAR', this.formatMoney(data.total), {
      size: 10,
      style: 'bold',
      lineHeight: 5.6,
    });
    b.gap(5);
    return b.block(group);
  }

  private buildPayments(
    metrics: jsPDF,
    data: ReceiptData,
    group: 'closing',
  ): Block {
    const b = new BlockBuilder(metrics);
    if (data.payments.length === 0) {
      b.paragraph(
        data.financed ? 'Venta financiada (crédito)' : 'Sin pagos registrados',
        {
          size: 8,
          color: MUTED,
          lineHeight: 4.2,
        },
      );
    } else {
      b.text('PAGOS', PAGE_MARGIN, 'left', 7, 'bold', MUTED);
      b.gap(3.6);

      if (data.payments.length === 1) {
        const payment = data.payments[0];
        if (payment.method === 'CASH') {
          b.row('Efectivo', this.formatMoney(payment.amount));
          if (data.change !== null && data.change > 0) {
            b.row('Cambio', this.formatMoney(data.change));
          }
        } else {
          b.row(
            this.paymentMethodText(payment.method),
            this.formatMoney(payment.amount),
          );
        }
      } else {
        for (const payment of data.payments) {
          b.row(
            this.paymentMethodText(payment.method),
            this.formatMoney(payment.amount),
          );
        }
        if (data.change !== null && data.change > 0) {
          b.row('Cambio', this.formatMoney(data.change));
        }
      }
    }
    b.gap(4);
    return b.block(group);
  }

  private buildFooter(
    metrics: jsPDF,
    data: ReceiptData,
    group: 'closing',
  ): Block {
    const b = new BlockBuilder(metrics);
    b.rule();
    b.gap(3.5);
    b.paragraph(data.footer || 'Gracias por su compra', {
      align: 'center',
      size: 7,
      color: MUTED,
      lineHeight: 3.4,
    });
    b.gap(2);
    return b.block(group);
  }

  private paginate(blocks: Block[], itemsHeader: Block): Block[][] {
    const pages: Block[][] = [];
    let current: Block[] = [];
    let used = PAGE_MARGIN;
    let inItems = false;
    let pageHasItemsHeader = false;

    const closingHeight = blocks
      .filter((block) => block.group === 'closing')
      .reduce((total, block) => total + block.height, 0);
    let closingStarted = false;

    const startPage = () => {
      pages.push(current);
      current = [];
      used = CONTINUATION_HEADER_HEIGHT;
      pageHasItemsHeader = false;
    };

    for (const block of blocks) {
      if (block.kind === 'items-header') inItems = true;
      if (block.kind === 'items-footer') inItems = false;

      if (block.group === 'closing' && !closingStarted) {
        closingStarted = true;
        if (current.length > 0 && used + closingHeight > PAGE_BREAK_LIMIT) {
          startPage();
        }
      } else if (current.length > 0 && used + block.height > PAGE_BREAK_LIMIT) {
        startPage();
      }

      // A page that continues the item list repeats its column header so the
      // columns stay readable after a page break.
      if (block.kind === 'item' && inItems && !pageHasItemsHeader) {
        if (
          current.length > 0 &&
          used + itemsHeader.height + block.height > PAGE_BREAK_LIMIT
        ) {
          startPage();
        }
        current.push(itemsHeader);
        used += itemsHeader.height;
        pageHasItemsHeader = true;
      } else if (block.kind === 'items-header') {
        pageHasItemsHeader = true;
      }

      current.push(block);
      used += block.height;
    }

    if (current.length > 0) pages.push(current);
    return pages;
  }

  private renderPage(
    doc: jsPDF,
    blocks: Block[],
    top: number,
    logo?: ReceiptLogo,
    logoBox?: { width: number; height: number; reserved: number },
  ): void {
    doc.setLineWidth(0.2);
    if (logo && logoBox) {
      try {
        doc.addImage(
          logo.bytes,
          logo.format,
          (PAGE_WIDTH - logoBox.width) / 2,
          top,
          logoBox.width,
          logoBox.height,
          undefined,
          'FAST',
        );
      } catch {
        // Invalid image contents degrade to the unchanged no-logo layout.
      }
    }

    let base = top;
    for (const block of blocks) {
      for (const op of block.ops) {
        if (op.kind === 'text') {
          doc.setFont('helvetica', op.style);
          doc.setFontSize(op.size);
          doc.setTextColor(...op.color);
          doc.text(op.text, op.x, base + op.y, { align: op.align });
        } else if (op.kind === 'line') {
          doc.setDrawColor(...op.color);
          doc.line(op.x1, base + op.y, op.x2, base + op.y);
        } else {
          doc.setDrawColor(...op.color);
          doc.rect(op.x, base + op.y, op.width, op.height);
        }
      }
      base += block.height;
    }
  }

  /** Fits the logo inside the 30x15mm box without stretching it. */
  private logoBox(logo: ReceiptLogo): {
    width: number;
    height: number;
    reserved: number;
  } {
    const scale = Math.min(LOGO_WIDTH / logo.width, LOGO_HEIGHT / logo.height);
    const height = logo.height * scale;
    return { width: logo.width * scale, height, reserved: height + 3 };
  }

  /** Drops a printHeader line that merely repeats the company name. */
  private withoutCompanyNameHeader(
    header: string,
    companyName: string,
  ): string {
    const normalize = (value: string) =>
      value.trim().replace(/\s+/g, ' ').toLocaleLowerCase(LOCALE);
    const company = normalize(companyName);
    const lines = header
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    while (lines.length > 0 && normalize(lines[0]) === company) {
      lines.shift();
    }

    return lines.join('\n');
  }

  private renderContinuationHeader(doc: jsPDF, data: ReceiptData): void {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...BLACK);
    doc.text(`No. ${data.receiptNumber} · continuación`, PAGE_WIDTH / 2, 8, {
      align: 'center',
    });
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.2);
    doc.line(PAGE_MARGIN, 10, PAGE_WIDTH - PAGE_MARGIN, 10);
  }

  private formatDateTime(value: Date | string): string {
    const date = new Date(value);
    const day = date.toLocaleDateString(LOCALE, { timeZone: TIMEZONE });
    const time = date.toLocaleTimeString(LOCALE, {
      timeZone: TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
    });
    return `${day} ${time}`;
  }

  /** Exact COP formatting: no K/M abbreviations and no lost cents. */
  private formatMoney(amount: number): string {
    const rounded = Math.round(Math.abs(amount));
    const grouped = rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${amount < 0 && rounded > 0 ? '-' : ''}$${grouped}`;
  }

  private taxLabel(data: ReceiptData): string {
    if (data.taxRates.length === 1) {
      const rate = Number(data.taxRates[0].toFixed(2));
      return `IVA (${rate}%)`;
    }
    return 'Impuestos';
  }

  private paymentMethodText(method: string): string {
    const methods: Record<string, string> = {
      CASH: 'Efectivo',
      CARD: 'Tarjeta',
      TRANSFER: 'Transferencia',
    };
    return methods[method] || method;
  }
}

const PAGE_WIDTH = 80;
const PAGE_MARGIN = 5;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const PAGE_BREAK_LIMIT = 285;
const PAGINATED_PAGE_HEIGHT = 297;
const CONTINUATION_HEADER_HEIGHT = 14;
const LOGO_WIDTH = 30;
const LOGO_HEIGHT = 15;
const PT_TO_MM = 0.352778;

type Align = 'left' | 'right' | 'center';
type FontStyle = 'normal' | 'bold';
type Color = readonly [number, number, number];

const BLACK: Color = [0, 0, 0];
const MUTED: Color = [90, 90, 90];
const RULE: Color = [150, 150, 150];
const DANGER: Color = [170, 30, 30];

interface TextOp {
  kind: 'text';
  text: string;
  x: number;
  align: Align;
  size: number;
  style: FontStyle;
  color: Color;
  y: number;
}

interface LineOp {
  kind: 'line';
  x1: number;
  x2: number;
  y: number;
  color: Color;
}

interface RectOp {
  kind: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  color: Color;
}

type Op = TextOp | LineOp | RectOp;

interface Block {
  ops: Op[];
  height: number;
  group?: 'closing';
  kind?: 'items-header' | 'item' | 'items-footer';
}

interface ParagraphOptions {
  align?: Align;
  x?: number;
  size?: number;
  style?: FontStyle;
  color?: Color;
  lineHeight?: number;
}

/** Accumulates measured text/line operations for one receipt block. */
class BlockBuilder {
  private readonly ops: Op[] = [];
  private cursor = 0;

  constructor(private readonly metrics: jsPDF) {}

  get y(): number {
    return this.cursor;
  }

  baselineOffset(size: number): number {
    return size * PT_TO_MM * 0.82;
  }

  baseline(size: number): number {
    return this.cursor + this.baselineOffset(size);
  }

  wrap(
    text: string,
    size: number,
    style: FontStyle,
    width = CONTENT_WIDTH,
  ): string[] {
    this.metrics.setFont('helvetica', style);
    this.metrics.setFontSize(size);
    return this.metrics.splitTextToSize(text, width) as string[];
  }

  text(
    text: string,
    x: number,
    align: Align,
    size: number,
    style: FontStyle,
    color: Color,
    baseline = this.baseline(size),
  ): void {
    this.ops.push({
      kind: 'text',
      text,
      x,
      align,
      size,
      style,
      color,
      y: baseline,
    });
  }

  paragraph(text: string, options: ParagraphOptions = {}): void {
    const {
      align = 'left',
      size = 8,
      style = 'normal',
      color = BLACK,
      lineHeight = size * PT_TO_MM * 1.4,
    } = options;
    const x =
      options.x ??
      (align === 'center'
        ? PAGE_WIDTH / 2
        : align === 'right'
          ? PAGE_WIDTH - PAGE_MARGIN
          : PAGE_MARGIN);
    const lines = this.wrap(text, size, style);

    for (const line of lines) {
      this.text(line, x, align, size, style, color);
      this.cursor += lineHeight;
    }
  }

  row(
    label: string,
    value: string,
    options: { size?: number; style?: FontStyle; lineHeight?: number } = {},
  ): void {
    const {
      size = 8,
      style = 'normal',
      lineHeight = size * PT_TO_MM * 1.55,
    } = options;
    const baseline = this.baseline(size);
    this.text(label, PAGE_MARGIN, 'left', size, style, BLACK, baseline);
    this.text(
      value,
      PAGE_WIDTH - PAGE_MARGIN,
      'right',
      size,
      style,
      BLACK,
      baseline,
    );
    this.cursor += lineHeight;
  }

  rule(color: Color = RULE): void {
    this.ops.push({
      kind: 'line',
      x1: PAGE_MARGIN,
      x2: PAGE_WIDTH - PAGE_MARGIN,
      y: this.cursor,
      color,
    });
  }

  box(x: number, y: number, width: number, height: number, color: Color): void {
    this.ops.push({ kind: 'rect', x, y, width, height, color });
  }

  gap(height: number): void {
    this.cursor += height;
  }

  block(group?: 'closing'): Block {
    return { ops: this.ops, height: this.cursor, group };
  }
}
