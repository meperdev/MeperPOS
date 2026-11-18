import { jsPDF } from 'jspdf';
import { formatDateInBogota } from '../../common/utils/bogota-date';
import type { ReceiptLogo } from '../../receipts/receipt-logo';
import type {
  PurchaseOrderDocumentData,
  PurchaseOrderDocumentItem,
} from './purchase-order-document';

/**
 * Renders the purchase order document on letter paper with jsPDF.
 *
 * Unlike the 80 mm sale receipt, this is a formal document a supplier receives
 * by mail or chat: business header, supplier and delivery blocks, an item table
 * that repeats its header on every page, the stored totals, notes, terms and a
 * footer with page numbers. Every amount comes from `PurchaseOrderDocumentData`.
 */

type Color = [number, number, number];

const PAGE_WIDTH = 215.9;
const PAGE_HEIGHT = 279.4;
const MARGIN = 16;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const RIGHT = PAGE_WIDTH - MARGIN;
/** Content stops here; the footer and the page number live below. */
const CONTENT_BOTTOM = PAGE_HEIGHT - 24;
const LOGO_MAX_WIDTH = 38;
const LOGO_MAX_HEIGHT = 18;
const PT_TO_MM = 0.352778;
const LINE_FACTOR = 1.25;

const INK: Color = [20, 20, 20];
const MUTED: Color = [100, 100, 100];
const RULE: Color = [190, 190, 190];
const FILL: Color = [242, 242, 242];
const DANGER: Color = [170, 30, 30];

interface Column {
  key: 'index' | 'name' | 'quantity' | 'unitCost' | 'taxRate' | 'subtotal';
  label: string;
  width: number;
  align: 'left' | 'right';
}

const NUMERIC_WIDTHS = {
  index: 8,
  quantity: 16,
  unitCost: 30,
  taxRate: 14,
  subtotal: 32,
};
const COLUMNS: Column[] = [
  { key: 'index', label: '#', width: NUMERIC_WIDTHS.index, align: 'left' },
  {
    key: 'name',
    label: 'Producto',
    width:
      CONTENT_WIDTH -
      Object.values(NUMERIC_WIDTHS).reduce((sum, width) => sum + width, 0),
    align: 'left',
  },
  {
    key: 'quantity',
    label: 'Cant.',
    width: NUMERIC_WIDTHS.quantity,
    align: 'right',
  },
  {
    key: 'unitCost',
    label: 'Costo unit.',
    width: NUMERIC_WIDTHS.unitCost,
    align: 'right',
  },
  {
    key: 'taxRate',
    label: 'IVA',
    width: NUMERIC_WIDTHS.taxRate,
    align: 'right',
  },
  {
    key: 'subtotal',
    label: 'Subtotal',
    width: NUMERIC_WIDTHS.subtotal,
    align: 'right',
  },
];
const CELL_PADDING = 2;

export function renderPurchaseOrderPdf(
  data: PurchaseOrderDocumentData,
  logo?: ReceiptLogo,
): Buffer {
  return new PurchaseOrderPdf(data, logo).render();
}

class PurchaseOrderPdf {
  private readonly doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'letter',
  });
  private y = MARGIN;

  constructor(
    private readonly data: PurchaseOrderDocumentData,
    private readonly logo?: ReceiptLogo,
  ) {}

  render(): Buffer {
    this.renderHeader();
    this.renderCancellation();
    this.renderParties();
    this.renderItems();
    this.renderTotals();
    this.renderParagraphSection('Notas', this.data.notes);
    this.renderParagraphSection(
      'Términos y condiciones',
      this.data.template.terms,
    );
    this.renderPreparedBy();
    this.renderPageFooters();
    return Buffer.from(this.doc.output('arraybuffer'));
  }

  // ---- sections ----

  private renderHeader(): void {
    const { business } = this.data;
    let textX = MARGIN;
    let logoBottom = MARGIN;

    if (this.logo) {
      const scale = Math.min(
        LOGO_MAX_WIDTH / this.logo.width,
        LOGO_MAX_HEIGHT / this.logo.height,
      );
      const width = this.logo.width * scale;
      const height = this.logo.height * scale;
      this.doc.addImage(
        this.logo.bytes,
        this.logo.format,
        MARGIN,
        MARGIN,
        width,
        height,
      );
      textX = MARGIN + width + 5;
      logoBottom = MARGIN + height;
    }

    const businessWidth = PAGE_WIDTH / 2 - textX;
    let left = MARGIN + 4;
    left = this.writeLines(
      business.name || 'Mi negocio',
      textX,
      left,
      businessWidth,
      {
        size: 13,
        bold: true,
      },
    );
    const details = [
      business.taxId ? `NIT ${business.taxId}` : null,
      business.phone ? `Tel. ${business.phone}` : null,
      business.address,
    ].filter((line): line is string => Boolean(line));
    for (const line of details) {
      left = this.writeLines(line, textX, left, businessWidth, {
        size: 9,
        color: MUTED,
      });
    }

    let right = MARGIN + 5;
    right = this.writeRight('Orden de compra', right, { size: 16, bold: true });
    right = this.writeRight(this.data.documentNumber, right + 1, {
      size: 12,
      bold: true,
    });
    right = this.writeRight(
      `Fecha de emisión: ${formatInstantDay(this.data.issuedAt)}`,
      right + 1,
      { size: 9, color: MUTED },
    );
    if (this.data.expectedDeliveryDate) {
      right = this.writeRight(
        `Entrega esperada: ${formatCalendarDay(this.data.expectedDeliveryDate)}`,
        right,
        { size: 9, color: MUTED },
      );
    }

    this.y = Math.max(left, right, logoBottom) + 3;
    this.rule();
    this.y += 5;
  }

  private renderCancellation(): void {
    if (this.data.status !== 'CANCELLED') return;
    const when = this.data.cancelledAt
      ? ` el ${formatInstantDay(this.data.cancelledAt)}`
      : '';
    this.y = this.writeLines(
      `ORDEN CANCELADA${when}`,
      MARGIN,
      this.y + 1,
      CONTENT_WIDTH,
      { size: 11, bold: true, color: DANGER },
    );
    this.y += 4;
  }

  private renderParties(): void {
    const { supplier, template } = this.data;
    const gap = 6;
    const boxWidth = (CONTENT_WIDTH - gap) / 2;
    const top = this.y;

    const supplierLines: Array<[string, TextStyle]> = [
      [supplier.name, { size: 10, bold: true }],
      [`NIT ${supplier.documentNumber}`, { size: 9 }],
      ...optionalLine('Contacto', supplier.contactName),
      ...optionalLine('Tel.', supplier.phone),
      ...optionalLine('Correo', supplier.email),
      ...optionalLine('Dirección', supplier.address),
    ];
    const deliveryLines: Array<[string, TextStyle]> = [
      ...labelledBlock('Entregar en', template.deliveryAddress),
      ...labelledBlock('Condiciones de pago', template.paymentTerms),
    ];

    const leftBottom = this.renderBox(
      'Proveedor',
      supplierLines,
      MARGIN,
      top,
      boxWidth,
    );
    const rightBottom = this.renderBox(
      'Entrega y pago',
      deliveryLines.length > 0
        ? deliveryLines
        : [['Sin especificar', { size: 9, color: MUTED }]],
      MARGIN + boxWidth + gap,
      top,
      boxWidth,
    );
    const bottom = Math.max(leftBottom, rightBottom);

    this.doc.setDrawColor(...RULE);
    this.doc.setLineWidth(0.2);
    this.doc.roundedRect(MARGIN, top, boxWidth, bottom - top, 1.5, 1.5);
    this.doc.roundedRect(
      MARGIN + boxWidth + gap,
      top,
      boxWidth,
      bottom - top,
      1.5,
      1.5,
    );
    this.y = bottom + 7;
  }

  private renderBox(
    title: string,
    lines: Array<[string, TextStyle]>,
    x: number,
    top: number,
    width: number,
  ): number {
    const inner = width - 8;
    let y = this.writeLines(title.toUpperCase(), x + 4, top + 5, inner, {
      size: 7.5,
      bold: true,
      color: MUTED,
    });
    y += 1;
    for (const [text, style] of lines) {
      y = this.writeLines(text, x + 4, y, inner, style);
    }
    return y + 2;
  }

  private renderItems(): void {
    this.renderTableHeader();
    this.data.items.forEach((item, index) => {
      const cells = this.cellLines(item, index);
      const lineHeight = lineHeightOf(9);
      const nameHeight =
        cells.name.length * lineHeight + (item.sku ? lineHeightOf(7.5) : 0);
      const rowHeight = Math.max(nameHeight, lineHeight) + CELL_PADDING * 2;

      if (this.y + rowHeight > CONTENT_BOTTOM) {
        this.newPage();
        this.renderTableHeader();
      }

      let x = MARGIN;
      for (const column of COLUMNS) {
        const textTop = this.y + CELL_PADDING + 9 * PT_TO_MM;
        this.style({ size: 9 });
        if (column.key === 'name') {
          this.doc.text(cells.name, x + CELL_PADDING, textTop, {
            lineHeightFactor: LINE_FACTOR,
          });
          if (item.sku) {
            this.style({ size: 7.5, color: MUTED });
            this.doc.text(
              `SKU ${item.sku}`,
              x + CELL_PADDING,
              textTop + cells.name.length * lineHeight,
            );
          }
        } else {
          const value = cells[column.key];
          const textX =
            column.align === 'right'
              ? x + column.width - CELL_PADDING
              : x + CELL_PADDING;
          this.doc.text(value, textX, textTop, { align: column.align });
        }
        x += column.width;
      }

      this.y += rowHeight;
      this.doc.setDrawColor(...RULE);
      this.doc.setLineWidth(0.1);
      this.doc.line(MARGIN, this.y, RIGHT, this.y);
    });
    this.y += 4;
  }

  private renderTableHeader(): void {
    const height = 7;
    this.doc.setFillColor(...FILL);
    this.doc.rect(MARGIN, this.y, CONTENT_WIDTH, height, 'F');
    let x = MARGIN;
    this.style({ size: 8, bold: true, color: MUTED });
    for (const column of COLUMNS) {
      const textX =
        column.align === 'right'
          ? x + column.width - CELL_PADDING
          : x + CELL_PADDING;
      this.doc.text(column.label, textX, this.y + 4.7, { align: column.align });
      x += column.width;
    }
    this.y += height;
  }

  private cellLines(
    item: PurchaseOrderDocumentItem,
    index: number,
  ): Record<Exclude<Column['key'], 'name'>, string> & { name: string[] } {
    const nameColumn = COLUMNS.find((column) => column.key === 'name')!;
    this.style({ size: 9 });
    return {
      index: String(index + 1),
      name: this.doc.splitTextToSize(
        clean(item.name),
        nameColumn.width - CELL_PADDING * 2,
      ) as string[],
      quantity: String(item.quantity),
      unitCost: formatMoney(item.unitCost),
      taxRate: `${Number(item.taxRate.toFixed(2))}%`,
      subtotal: formatMoney(item.subtotal),
    };
  }

  private renderTotals(): void {
    const rows: Array<[string, string, boolean]> = [
      ['Subtotal', formatMoney(this.data.subtotal), false],
      ['IVA', formatMoney(this.data.taxAmount), false],
      ['Total', formatMoney(this.data.total), true],
    ];
    const height = rows.length * 6 + 4;
    if (this.y + height > CONTENT_BOTTOM) this.newPage();

    const labelX = RIGHT - 62;
    for (const [label, value, strong] of rows) {
      const size = strong ? 11 : 9.5;
      this.style({ size, bold: strong, color: strong ? INK : MUTED });
      this.doc.text(label, labelX, this.y + 4);
      this.style({ size, bold: strong });
      this.doc.text(value, RIGHT - CELL_PADDING, this.y + 4, {
        align: 'right',
      });
      this.y += 6;
      if (label === 'IVA') {
        this.doc.setDrawColor(...RULE);
        this.doc.setLineWidth(0.2);
        this.doc.line(labelX, this.y, RIGHT, this.y);
      }
    }
    this.y += 6;
  }

  private renderParagraphSection(title: string, body: string | null): void {
    const text = body?.trim();
    if (!text) return;
    if (this.y + 12 > CONTENT_BOTTOM) this.newPage();
    this.y = this.writeLines(
      title.toUpperCase(),
      MARGIN,
      this.y,
      CONTENT_WIDTH,
      {
        size: 7.5,
        bold: true,
        color: MUTED,
      },
    );
    this.y = this.writeLines(
      text,
      MARGIN,
      this.y + 0.5,
      CONTENT_WIDTH,
      { size: 9 },
      true,
    );
    this.y += 5;
  }

  private renderPreparedBy(): void {
    if (!this.data.preparedBy) return;
    if (this.y + lineHeightOf(9) > CONTENT_BOTTOM) this.newPage();
    this.y = this.writeLines(
      `Elaborado por: ${this.data.preparedBy}`,
      MARGIN,
      this.y,
      CONTENT_WIDTH,
      { size: 9, color: MUTED },
    );
  }

  private renderPageFooters(): void {
    const pages = this.doc.getNumberOfPages();
    const footer = clean(this.data.template.footer ?? '');
    for (let page = 1; page <= pages; page++) {
      this.doc.setPage(page);
      this.doc.setDrawColor(...RULE);
      this.doc.setLineWidth(0.2);
      this.doc.line(MARGIN, PAGE_HEIGHT - 18, RIGHT, PAGE_HEIGHT - 18);
      if (footer) {
        this.style({ size: 8, color: MUTED });
        const lines = (
          this.doc.splitTextToSize(footer, CONTENT_WIDTH - 40) as string[]
        ).slice(0, 2);
        this.doc.text(lines, MARGIN, PAGE_HEIGHT - 13, {
          lineHeightFactor: LINE_FACTOR,
        });
      }
      this.style({ size: 8, color: MUTED });
      this.doc.text(`Página ${page} de ${pages}`, RIGHT, PAGE_HEIGHT - 13, {
        align: 'right',
      });
    }
  }

  // ---- primitives ----

  private newPage(): void {
    this.doc.addPage('letter', 'portrait');
    this.y = MARGIN;
    this.style({ size: 9, bold: true });
    this.doc.text(
      `${this.data.documentNumber} · continuación`,
      MARGIN,
      this.y + 3,
    );
    this.y += 6;
    this.rule();
    this.y += 4;
  }

  private rule(): void {
    this.doc.setDrawColor(...RULE);
    this.doc.setLineWidth(0.3);
    this.doc.line(MARGIN, this.y, RIGHT, this.y);
  }

  private style({ size, bold = false, color = INK }: TextStyle): void {
    this.doc.setFont('helvetica', bold ? 'bold' : 'normal');
    this.doc.setFontSize(size);
    this.doc.setTextColor(...color);
  }

  /**
   * Writes wrapped text starting with its first baseline below `top` and
   * returns the y below the last line. With `breakPages`, a long paragraph
   * continues on a new page instead of running into the footer.
   */
  private writeLines(
    text: string,
    x: number,
    top: number,
    width: number,
    style: TextStyle,
    breakPages = false,
  ): number {
    this.style(style);
    const lines = this.doc.splitTextToSize(clean(text), width) as string[];
    const lineHeight = lineHeightOf(style.size);
    let y = top;
    for (const line of lines) {
      if (breakPages && y + lineHeight > CONTENT_BOTTOM) {
        this.newPage();
        y = this.y;
        this.style(style);
      }
      this.doc.text(line, x, y + style.size * PT_TO_MM);
      y += lineHeight;
    }
    return y;
  }

  private writeRight(text: string, top: number, style: TextStyle): number {
    this.style(style);
    this.doc.text(clean(text), RIGHT, top + style.size * PT_TO_MM, {
      align: 'right',
    });
    return top + lineHeightOf(style.size);
  }
}

interface TextStyle {
  size: number;
  bold?: boolean;
  color?: Color;
}

function optionalLine(
  label: string,
  value: string | null,
): Array<[string, TextStyle]> {
  return value?.trim() ? [[`${label}: ${value.trim()}`, { size: 9 }]] : [];
}

function labelledBlock(
  label: string,
  value: string,
): Array<[string, TextStyle]> {
  return value.trim()
    ? [
        [label, { size: 8, bold: true, color: MUTED }],
        [value.trim(), { size: 9 }],
      ]
    : [];
}

function lineHeightOf(size: number): number {
  return size * PT_TO_MM * LINE_FACTOR;
}

/** Composes accents for the standard PDF font and drops control characters. */
function clean(text: string): string {
  // eslint-disable-next-line no-control-regex
  const controlCharacters = /[\u0000-\u0008\u000b-\u001f\u007f]/g;
  return text.normalize('NFC').replace(controlCharacters, '');
}

/** Exact COP formatting, as on the sale receipt: no abbreviations, no cents. */
function formatMoney(amount: number): string {
  const rounded = Math.round(Math.abs(amount));
  const grouped = rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${amount < 0 && rounded > 0 ? '-' : ''}$${grouped}`;
}

/** An instant, shown as its calendar day in Bogotá. */
function formatInstantDay(value: Date): string {
  return toDayMonthYear(formatDateInBogota(new Date(value)));
}

/** A `@db.Date` value (midnight UTC), shown as the stored day. */
function formatCalendarDay(value: Date): string {
  return toDayMonthYear(new Date(value).toISOString().slice(0, 10));
}

function toDayMonthYear(isoDay: string): string {
  const [year, month, day] = isoDay.split('-');
  return `${day}/${month}/${year}`;
}
