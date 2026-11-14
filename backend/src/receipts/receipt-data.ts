/**
 * ReceiptData contract for receipt rendering.
 *
 * `buildReceiptData` maps a Prisma sale (with customer/user/items/payments)
 * plus the hydrated settings view into the display-ready data the receipt
 * renderer consumes. Every monetary value comes from the sale row; the
 * renderer never derives totals.
 */

export interface ReceiptSaleItemInput {
  product: { name: string } | null;
  quantity: number;
  unitPrice: unknown;
  taxRate: unknown;
  discountAmount?: unknown;
  total: unknown;
}

export interface ReceiptSalePaymentInput {
  method: string;
  amount: unknown;
}

export interface ReceiptSaleCustomerInput {
  name: string;
  documentType?: string | null;
  documentNumber?: string | null;
}

/** Structural input shape: the Prisma sale returned by SalesService.findOne. */
export interface ReceiptSale {
  saleNumber: number;
  createdAt: Date | string;
  status?: string | null;
  cancelReason?: string | null;
  cancelledAt?: Date | string | null;
  customer: ReceiptSaleCustomerInput | null;
  user?: { name: string } | null;
  financed?: boolean;
  items?: ReceiptSaleItemInput[];
  payments?: ReceiptSalePaymentInput[];
  subtotal: unknown;
  taxAmount: unknown;
  discountAmount: unknown;
  total: unknown;
  change: unknown;
}

/** Structural input shape: the SettingsView returned by SettingsService.find. */
export interface ReceiptSettings {
  organization: {
    name?: string | null;
    logoUrl?: string | null;
    taxId?: string | null;
    phone?: string | null;
    address?: string | null;
  };
  invoicing: { printHeader?: string | null; printFooter?: string | null };
  receipt: { prefix?: string | null };
}

export interface ReceiptDataItem {
  name: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
}

export interface ReceiptDataPayment {
  method: string;
  amount: number;
}

export interface ReceiptData {
  saleNumber: number;
  receiptNumber: string;
  createdAt: Date | string;
  status: string;
  cancelReason: string | null;
  cancelledAt: Date | string | null;
  companyName: string;
  companyTaxId: string | null;
  companyPhone: string | null;
  companyAddress: string | null;
  header: string;
  footer: string;
  logoUrl: string | null | undefined;
  customerName: string | null;
  customerDocument: string | null;
  financed: boolean;
  sellerName: string | null;
  items: ReceiptDataItem[];
  payments: ReceiptDataPayment[];
  subtotal: number;
  taxAmount: number;
  taxRates: number[];
  discount: number;
  total: number;
  change: number | null;
}

export function buildReceiptData(
  sale: ReceiptSale,
  settings: ReceiptSettings,
): ReceiptData {
  const items = (sale.items ?? []).map((item) => ({
    name: item.product?.name || 'Producto eliminado',
    quantity: item.quantity,
    unitPrice: Number(item.unitPrice),
    discount: Number(item.discountAmount ?? 0) || 0,
    total: Number(item.total),
  }));

  return {
    saleNumber: sale.saleNumber,
    receiptNumber: settings.receipt.prefix
      ? `${settings.receipt.prefix}-${sale.saleNumber}`
      : String(sale.saleNumber),
    createdAt: sale.createdAt,
    status: sale.status ?? 'COMPLETED',
    cancelReason: sale.cancelReason ?? null,
    cancelledAt: sale.cancelledAt ?? null,
    companyName: settings.organization.name || 'Mi Negocio',
    companyTaxId: settings.organization.taxId || null,
    companyPhone: settings.organization.phone || null,
    companyAddress: settings.organization.address || null,
    header: settings.invoicing.printHeader || '',
    footer: settings.invoicing.printFooter || '',
    logoUrl: settings.organization.logoUrl,
    customerName: sale.customer ? sale.customer.name : null,
    customerDocument: formatDocument(sale.customer),
    financed: Boolean(sale.financed),
    sellerName: sale.user?.name || null,
    items,
    payments: (sale.payments ?? []).map((payment) => ({
      method: payment.method,
      amount: Number(payment.amount),
    })),
    subtotal: Number(sale.subtotal),
    taxAmount: Number(sale.taxAmount),
    taxRates: getTaxRates(sale),
    discount: Number(sale.discountAmount),
    total: Number(sale.total),
    change:
      sale.change !== null && sale.change !== undefined
        ? Number(sale.change)
        : null,
  };
}

function formatDocument(
  customer: ReceiptSaleCustomerInput | null,
): string | null {
  if (!customer?.documentNumber) return null;
  const type = customer.documentType?.trim();
  return type ? `${type} ${customer.documentNumber}` : customer.documentNumber;
}

function getTaxRates(sale: ReceiptSale): number[] {
  const rates = new Set<number>();
  for (const item of sale.items ?? []) {
    rates.add(Number(item.taxRate) || 0);
  }
  return [...rates].sort((a, b) => a - b);
}
