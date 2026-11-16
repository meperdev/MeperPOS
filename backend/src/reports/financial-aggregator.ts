import { Prisma } from '@prisma/client';

type DecimalValue = Prisma.Decimal;

export interface FinancialSaleItem {
  productId: string;
  productName: string;
  categoryName: string;
  quantity: number;
  subtotal: DecimalValue;
  discountAmount: DecimalValue;
  costPriceSnapshot: DecimalValue | null;
}

export interface FinancialSale {
  subtotal: DecimalValue;
  discountAmount: DecimalValue;
  taxAmount: DecimalValue;
  items: FinancialSaleItem[];
}

export interface FinancialExpense {
  total: DecimalValue;
  purchaseOrderId: string | null;
}

interface ProductMargin {
  productId: string;
  productName: string;
  categoryName: string;
  quantity: number;
  netRevenue: string;
  cogs: string;
  grossProfit: string;
  marginPercentage: number | null;
}

export interface FinancialReport {
  netIncome: string;
  /** Net revenue of the items that carry a cost snapshot, i.e. the part of
   * `netIncome` the margin breakdown can actually measure. */
  attributableRevenue: string;
  tax: string;
  cogs: string;
  grossProfit: string;
  grossMarginPercentage: number | null;
  operatingExpenses: string;
  netProfit: string;
  netMarginPercentage: number | null;
  products: ProductMargin[];
  dataQuality: {
    snapshotBackedItems: number;
    excludedItems: number;
    excludedQuantity: number;
  };
}

export interface FinancialDelta {
  absolute: string;
  percentage: number | null;
}

const ZERO = new Prisma.Decimal(0);

function money(value: DecimalValue): string {
  return value.toFixed(2);
}

function percentage(value: DecimalValue, denominator: DecimalValue): number | null {
  if (denominator.isZero()) return null;
  return value.div(denominator).mul(100).toNumber();
}

export function aggregateFinancialSales(
  sales: FinancialSale[],
  expenses: FinancialExpense[] = [],
): FinancialReport {
  let netIncome = ZERO;
  let tax = ZERO;
  let attributableRevenue = ZERO;
  let cogs = ZERO;
  let operatingExpenses = ZERO;
  let snapshotBackedItems = 0;
  let excludedItems = 0;
  let excludedQuantity = 0;
  const products = new Map<string, {
    productId: string;
    productName: string;
    categoryName: string;
    quantity: number;
    netRevenue: DecimalValue;
    cogs: DecimalValue;
  }>();

  for (const sale of sales) {
    const saleNetIncome = sale.subtotal.sub(sale.discountAmount);
    netIncome = netIncome.add(saleNetIncome);
    tax = tax.add(sale.taxAmount);
    const itemSubtotal = sale.items.reduce(
      (sum, item) => sum.add(item.subtotal),
      ZERO,
    );

    for (const item of sale.items) {
      if (item.costPriceSnapshot === null) {
        excludedItems += 1;
        excludedQuantity += item.quantity;
        continue;
      }

      const snapshot = item.costPriceSnapshot;
      snapshotBackedItems += 1;
      const allocatedDiscount = itemSubtotal.isZero()
        ? ZERO
        : sale.discountAmount.mul(item.subtotal).div(itemSubtotal);
      const itemNetRevenue = item.subtotal.sub(allocatedDiscount);
      const itemCogs = snapshot.mul(item.quantity);
      attributableRevenue = attributableRevenue.add(itemNetRevenue);
      cogs = cogs.add(itemCogs);

      const existing = products.get(item.productId) ?? {
        productId: item.productId,
        productName: item.productName,
        categoryName: item.categoryName,
        quantity: 0,
        netRevenue: ZERO,
        cogs: ZERO,
      };
      existing.quantity += item.quantity;
      existing.netRevenue = existing.netRevenue.add(itemNetRevenue);
      existing.cogs = existing.cogs.add(itemCogs);
      products.set(item.productId, existing);
    }
  }

  for (const expense of expenses) {
    if (!expense.purchaseOrderId) {
      operatingExpenses = operatingExpenses.add(expense.total);
    }
  }

  const grossProfit = attributableRevenue.sub(cogs);
  const netProfit = grossProfit.sub(operatingExpenses);

  return {
    netIncome: money(netIncome),
    attributableRevenue: money(attributableRevenue),
    tax: money(tax),
    cogs: money(cogs),
    grossProfit: money(grossProfit),
    grossMarginPercentage: percentage(grossProfit, attributableRevenue),
    operatingExpenses: money(operatingExpenses),
    netProfit: money(netProfit),
    netMarginPercentage: percentage(netProfit, attributableRevenue),
    products: Array.from(products.values()).map((product) => {
      const productGrossProfit = product.netRevenue.sub(product.cogs);
      return {
        productId: product.productId,
        productName: product.productName,
        categoryName: product.categoryName,
        quantity: product.quantity,
        netRevenue: money(product.netRevenue),
        cogs: money(product.cogs),
        grossProfit: money(productGrossProfit),
        marginPercentage: percentage(productGrossProfit, product.netRevenue),
      };
    }),
    dataQuality: { snapshotBackedItems, excludedItems, excludedQuantity },
  };
}

export function serializeFinancialReport<T>(value: T): T {
  if (value instanceof Prisma.Decimal) {
    return money(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => serializeFinancialReport(entry)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        serializeFinancialReport(entry),
      ]),
    ) as T;
  }
  return value;
}

export function compareFinancialReports(
  current: FinancialReport,
  previous: FinancialReport,
): Record<string, FinancialDelta> {
  const fields = [
    'netIncome',
    'cogs',
    'grossProfit',
    'operatingExpenses',
    'netProfit',
  ] as const;

  return Object.fromEntries(
    fields.map((field) => {
      const currentValue = new Prisma.Decimal(current[field]);
      const previousValue = new Prisma.Decimal(previous[field]);
      const absolute = currentValue.sub(previousValue);
      // Growth is measured against the size of the previous value, never its
      // sign: dividing by a negative baseline would invert every delta. Without
      // a baseline (previous = 0) there is no percentage to report, and only two
      // zero periods compare as 0% (S5.3).
      const baseline = previousValue.abs();
      return [
        field,
        {
          absolute: money(absolute),
          percentage: baseline.isZero()
            ? currentValue.isZero()
              ? 0
              : null
            : absolute.div(baseline).mul(100).toNumber(),
        },
      ];
    }),
  );
}
