import { jsPDF } from 'jspdf';
import type { DailyReport } from './daily-report.service';
import { formatDateInBogota } from '../common/utils/bogota-date';

const bogotaTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Bogota',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function formatBogotaInstant(value: Date): string {
  return `${formatDateInBogota(value)} ${bogotaTime.format(value)}.${String(value.getUTCMilliseconds()).padStart(3, '0')}`;
}

/** Write each wrapped line independently so even a single long value can span pages. */
export function renderDailyReportPdf(report: DailyReport): Buffer {
  const doc = new jsPDF();
  doc.setFontSize(10);
  const margin = 14;
  const width = doc.internal.pageSize.getWidth() - margin * 2;
  const bottom = doc.internal.pageSize.getHeight() - margin;
  let y = margin;
  const line = (text: string) => {
    // Compose common accented names before handing text to the standard PDF font.
    const lines: string[] = doc.splitTextToSize(text.normalize('NFC'), width);
    for (const part of lines) {
      if (y > bottom) {
        doc.addPage();
        y = margin;
      }
      doc.text(part, margin, y);
      y += 5;
    }
  };
  line(
    `Reporte diario | ${report.date} | Corte: ${formatBogotaInstant(report.cutoff)} | America/Bogota`,
  );
  line('Estado actual al consultar; no es una reconstrucción histórica.');
  line(`Ventas completadas: ${report.salesTotal} COP`);
  for (const sale of report.sales) {
    line(
      `Venta ${sale.saleNumber} | ${formatBogotaInstant(sale.createdAt)} America/Bogota | ${sale.total} COP`,
    );
    line(
      `Cliente: ${sale.customer ? `${sale.customer.name} | ${sale.customer.documentNumber}` : 'Sin cliente'}`,
    );
    for (const item of sale.items)
      line(
        `${item.product.name} | SKU: ${item.product.sku} | Cantidad: ${item.quantity} | Precio: ${item.unitPrice} | Total: ${item.total}`,
      );
  }
  line(`Gastos registrados: ${report.expenseTotal} COP`);
  for (const expense of report.expenses)
    line(
      `${expense.label.name} | ${expense.description ?? ''} | ${expense.total} | ${expense.status}`,
    );
  line('Stock bajo:');
  for (const product of report.lowStock)
    line(
      `${product.name} | SKU: ${product.sku} | Stock: ${product.stock} | Mínimo: ${product.minStock}`,
    );
  line('Órdenes de compra pendientes:');
  for (const order of report.purchaseOrders)
    line(
      `${order.orderNumber} | ${order.supplier.name} | ${order.status} | ${order.total} COP`,
    );
  line('Préstamos vencidos o por vencer:');
  for (const loan of report.loans)
    line(
      `${loan.dueAt?.toISOString().slice(0, 10)} | ${loan.customer ?? loan.supplier ?? 'Contraparte no disponible'} | ${loan.reason} | Saldo: ${loan.balance} COP`,
    );
  return Buffer.from(doc.output('arraybuffer'));
}
