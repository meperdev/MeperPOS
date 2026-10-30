import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, ProductType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../common/services/cache.service';
import {
  formatDateInBogota,
  parseBogotaEndOfDay,
  parseBogotaStartOfDay,
} from '../common/utils/bogota-date';
import { ExpensesService } from '../expenses/expenses.service';
import { normalizeStock } from '../products/product-type.logic';
import {
  aggregateFinancialSales,
  compareFinancialReports,
  serializeFinancialReport,
} from './financial-aggregator';
import type {
  FinancialDelta,
  FinancialReport,
  FinancialSale,
  FinancialSaleItem,
} from './financial-aggregator';

// ─── Local types ──────────────────────────────────────────────────────────────

type SaleStatusType = 'COMPLETED' | 'CANCELLED' | 'RETURNED_PARTIAL';

interface DateFilter {
  gte?: Date;
  lte?: Date;
}

interface FinancialSaleRecord extends FinancialSale {
  createdAt: Date;
  cancelledAt: Date | null;
  status: string;
  inventoryMovements: Array<{
    type: string;
    quantity: number;
    productId: string;
    createdAt: Date;
  }>;
}

interface SaleWhereInput {
  organizationId: string;
  status?: SaleStatusType;
  createdAt?: DateFilter;
  userId?: {
    in: string[];
  };
}

interface SaleNestedWhere {
  organizationId: string;
  status?: SaleStatusType;
  createdAt?: DateFilter;
}

interface SaleItemWhereInput {
  sale?: SaleNestedWhere;
}

interface CustomerSaleWhereInput {
  organizationId: string;
  createdAt?: DateFilter;
}

interface DaySummary {
  total: number;
  subtotal: number;
  tax: number;
  count: number;
}

interface ComparisonPeriod {
  current: DateFilter;
  previous: DateFilter;
}

export interface UserPerformanceComparison {
  revenuePct: number | null;
  salesPct: number | null;
}

export interface UserPerformanceRow {
  userId: string;
  userName: string;
  salesCount: number;
  revenue: number;
  avgTicket: number;
  uniqueCustomers: number;
  comparison?: UserPerformanceComparison;
}

export interface UserPerformanceReport {
  data: UserPerformanceRow[];
  appliedRange: AppliedRangeMeta;
  comparisonRange?: AppliedRangeMeta;
}

interface UserAggregation {
  salesCount: number;
  revenue: number;
  customerIds: Set<string>;
}

export interface AppliedRangeMeta {
  startDate: string | null;
  endDate: string | null;
  timezone: 'America/Bogota';
}

const DEFAULT_COMPARISON_DAYS = 30;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// ─── Helper ───────────────────────────────────────────────────────────────────

function validateDateRange(startDate?: string, endDate?: string): void {
  const start = parseBogotaStartOfDay(startDate);
  const end = parseBogotaEndOfDay(endDate);

  if (start && end && end < start) {
    throw new BadRequestException(
      'La fecha de fin no puede ser anterior a la fecha de inicio.',
    );
  }
}

function buildAppliedRange(
  startDate?: string,
  endDate?: string,
): AppliedRangeMeta {
  const parsedStartDate = parseBogotaStartOfDay(startDate);
  const parsedEndDate = parseBogotaEndOfDay(endDate);

  return {
    startDate: parsedStartDate ? formatDateInBogota(parsedStartDate) : null,
    endDate: parsedEndDate ? formatDateInBogota(parsedEndDate) : null,
    timezone: 'America/Bogota',
  };
}

function buildFinancialRangeMeta(dateFilter: DateFilter): AppliedRangeMeta {
  return {
    startDate: dateFilter.gte ? formatDateInBogota(dateFilter.gte) : null,
    endDate: dateFilter.lte ? formatDateInBogota(dateFilter.lte) : null,
    timezone: 'America/Bogota',
  };
}

function buildComparisonRangeMeta(
  comparisonPeriod: ComparisonPeriod,
): AppliedRangeMeta {
  return {
    startDate: formatDateInBogota(comparisonPeriod.previous.gte!),
    endDate: formatDateInBogota(comparisonPeriod.previous.lte!),
    timezone: 'America/Bogota',
  };
}

function buildDateFilter(
  startDate?: string,
  endDate?: string,
): DateFilter | undefined {
  if (!startDate && !endDate) return undefined;

  const filter: DateFilter = {};

  const startDateFilter = parseBogotaStartOfDay(startDate);
  if (startDateFilter) {
    filter.gte = startDateFilter;
  }

  const endDateFilter = parseBogotaEndOfDay(endDate);
  if (endDateFilter) {
    filter.lte = endDateFilter;
  }

  return filter;
}

function buildComparisonPeriod(
  startDate?: string,
  endDate?: string,
): ComparisonPeriod {
  const now = new Date();
  const parsedStart = parseBogotaStartOfDay(startDate);
  const parsedEnd = parseBogotaEndOfDay(endDate) ?? now;

  let currentStart =
    parsedStart ??
    new Date(parsedEnd.getTime() - DEFAULT_COMPARISON_DAYS * ONE_DAY_MS + 1);
  let currentEnd = parsedEnd;

  if (currentStart.getTime() > currentEnd.getTime()) {
    const temp = currentStart;
    currentStart = currentEnd;
    currentEnd = temp;
  }

  const durationMs = Math.max(
    ONE_DAY_MS,
    currentEnd.getTime() - currentStart.getTime() + 1,
  );

  const previousEnd = new Date(currentStart.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - durationMs + 1);

  return {
    current: {
      gte: currentStart,
      lte: currentEnd,
    },
    previous: {
      gte: previousStart,
      lte: previousEnd,
    },
  };
}

function buildFinancialComparisonPeriod(
  startDate?: string,
  endDate?: string,
): ComparisonPeriod {
  if (startDate || endDate) {
    return buildComparisonPeriod(startDate, endDate);
  }

  const today = formatDateInBogota(new Date());
  const [year, month] = today.split('-').map(Number);
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonthStart = new Date(Date.UTC(year, month, 1, 5));
  const currentEnd = new Date(nextMonthStart.getTime() - 1);
  const currentStart = parseBogotaStartOfDay(monthStart)!;
  const durationMs = currentEnd.getTime() - currentStart.getTime() + 1;
  const previousEnd = new Date(currentStart.getTime() - 1);

  return {
    current: { gte: currentStart, lte: currentEnd },
    previous: {
      gte: new Date(previousEnd.getTime() - durationMs + 1),
      lte: previousEnd,
    },
  };
}

function calculatePercentageChange(
  currentValue: number,
  previousValue: number,
): number | null {
  if (previousValue === 0) {
    return currentValue === 0 ? 0 : 100;
  }

  return ((currentValue - previousValue) / previousValue) * 100;
}

function normalizeUserIds(userIds?: string[]): string[] | undefined {
  if (!userIds || userIds.length === 0) {
    return undefined;
  }

  const normalized = Array.from(
    new Set(userIds.map((userId) => userId.trim()).filter(Boolean)),
  );

  return normalized.length > 0 ? normalized : undefined;
}

export interface FinancialOverviewResponse {
  current: FinancialReport;
  previous: FinancialReport;
  deltas: Record<string, FinancialDelta>;
  appliedRange: AppliedRangeMeta;
  comparisonRange: AppliedRangeMeta;
}

function aggregateCashPayments(
  payments: Array<{ amount: Prisma.Decimal; method: string }>,
) {
  const byMethod = new Map<string, { total: Prisma.Decimal; count: number }>();
  for (const payment of payments) {
    const current = byMethod.get(payment.method) ?? {
      total: new Prisma.Decimal(0),
      count: 0,
    };
    current.total = current.total.add(payment.amount);
    current.count += 1;
    byMethod.set(payment.method, current);
  }

  return {
    total: Array.from(byMethod.values()).reduce(
      (sum, entry) => sum.add(entry.total),
      new Prisma.Decimal(0),
    ).toFixed(2),
    byPaymentMethod: Array.from(byMethod.entries()).map(([paymentMethod, entry]) => ({
      paymentMethod,
      total: entry.total.toFixed(2),
      count: entry.count,
    })),
  };
}

// Maps payment.groupBy rows (D7 — S5 perf-refactor #98) to the aggregateCashPayments
// shape; group order is the query's explicit `orderBy: { method: 'asc' }` (decision obs #411).
function aggregatePaymentGroups(
  groups: Array<{
    method: string;
    _sum: { amount: Prisma.Decimal | null };
    _count: { method: number };
  }>,
) {
  let total = new Prisma.Decimal(0);
  const byPaymentMethod = groups.map((group) => {
    const amount = group._sum.amount ?? new Prisma.Decimal(0);
    total = total.add(amount);
    return {
      paymentMethod: group.method,
      total: amount.toFixed(2),
      count: group._count.method,
    };
  });

  return { total: total.toFixed(2), byPaymentMethod };
}

function isInDateFilter(date: Date | null | undefined, filter: DateFilter): boolean {
  return Boolean(
    date &&
      (!filter.gte || date >= filter.gte) &&
      (!filter.lte || date <= filter.lte),
  );
}

function signedSale(
  sale: FinancialSaleRecord,
  items: FinancialSaleItem[],
  sign: 1 | -1,
): FinancialSale {
  const itemSubtotal = items.reduce(
    (sum, item) => sum.add(item.subtotal),
    new Prisma.Decimal(0),
  );
  const ratio = sale.subtotal.isZero() ? new Prisma.Decimal(1) : itemSubtotal.div(sale.subtotal);

  return {
    subtotal: sale.subtotal.mul(sign).mul(ratio),
    discountAmount: sale.discountAmount.mul(sign).mul(ratio),
    taxAmount: sale.taxAmount.mul(sign).mul(ratio),
    items: items.map((item) => ({
      ...item,
      quantity: item.quantity * sign,
      subtotal: item.subtotal.mul(sign),
      discountAmount: item.discountAmount.mul(sign),
    })),
  };
}

function expandFinancialSale(sale: FinancialSaleRecord, dateFilter: DateFilter): FinancialSale[] {
  const records: FinancialSale[] = [];

  if (isInDateFilter(sale.createdAt, dateFilter)) {
    records.push(sale);
  }

  if (isInDateFilter(sale.cancelledAt, dateFilter)) {
    records.push(signedSale(sale, sale.items, -1));
  }

  if (sale.status !== 'CANCELLED') {
    const returnedByProduct = new Map<string, number>();
    for (const movement of sale.inventoryMovements) {
      if (movement.type === 'RETURN' && isInDateFilter(movement.createdAt, dateFilter)) {
        returnedByProduct.set(
          movement.productId,
          (returnedByProduct.get(movement.productId) ?? 0) + movement.quantity,
        );
      }
    }

    const returnedItems = sale.items
      .map((item) => {
        const returnedQuantity = returnedByProduct.get(item.productId) ?? 0;
        if (!returnedQuantity || item.quantity === 0) return null;
        const ratio = new Prisma.Decimal(returnedQuantity).div(item.quantity);
        return {
          ...item,
          quantity: returnedQuantity,
          subtotal: item.subtotal.mul(ratio),
          discountAmount: item.discountAmount.mul(ratio),
        };
      })
      .filter((item): item is FinancialSaleItem => item !== null);

    if (returnedItems.length > 0) {
      records.push(signedSale(sale, returnedItems, -1));
    }
  }

  return records;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class ReportsService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
    private expensesService?: ExpensesService,
  ) {}

  async getFinancialOverview(
    organizationId: string | undefined,
    startDate?: string,
    endDate?: string,
  ): Promise<FinancialOverviewResponse> {
    if (!organizationId) {
      throw new BadRequestException('Organization ID is required for reports');
    }
    validateDateRange(startDate, endDate);

    const period = buildFinancialComparisonPeriod(startDate, endDate);
    const cacheKey = `financial:${organizationId}:${period.current.gte?.toISOString()}:${period.current.lte?.toISOString()}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached as FinancialOverviewResponse;

    const [currentSales, previousSales, currentExpenses] = await Promise.all([
      this.findFinancialSales(organizationId, period.current),
      this.findFinancialSales(organizationId, period.previous),
      this.findFinancialExpenses(organizationId, period.current),
    ]);
    const current = serializeFinancialReport(
      aggregateFinancialSales(currentSales, currentExpenses),
    );
    const previous = serializeFinancialReport(
      aggregateFinancialSales(
        previousSales,
        await this.findFinancialExpenses(organizationId, period.previous),
      ),
    );

    const result = {
      current,
      previous,
      deltas: compareFinancialReports(current, previous),
      appliedRange: buildFinancialRangeMeta(period.current),
      comparisonRange: buildComparisonRangeMeta(period),
    };
    this.cache.set(cacheKey, result, 5 * 60 * 1000);
    return result;
  }

  async getCashFlow(
    organizationId: string | undefined,
    startDate?: string,
    endDate?: string,
  ) {
    const orgId = this.requireOrganizationId(organizationId);
    validateDateRange(startDate, endDate);
    const period = buildFinancialComparisonPeriod(startDate, endDate);
    const [paymentGroups, expensePayments, payrollCashOutflows] =
      await Promise.all([
        this.prisma.payment.groupBy({
          by: ['method'],
          where: {
            organizationId: orgId,
            createdAt: period.current,
            sale: { status: 'COMPLETED' },
          },
          _sum: { amount: true },
          _count: { method: true },
          orderBy: { method: 'asc' },
        }),
        this.prisma.expensePayment.findMany({
          where: {
            organizationId: orgId,
            date: period.current,
            // A payroll obligation's generated expense mirrors cash that its
            // PayrollCashOutflow rows already report on the outflows aggregate
            // below. Counting the mirror too would count the same payroll cash
            // twice. Only the payroll-linked expense is skipped; every other
            // expense payment keeps its current (deliberately inactive-blind)
            // behaviour.
            expense: { payrollObligationExpense: { is: null } },
          },
          select: { amount: true, method: true },
        }),
        // Payroll cash is cash even when completion generated no expense at all
        // (S8), so the outflows come from the cash facts themselves, on the day
        // they happened, and are merged into the same aggregate.
        this.prisma.payrollCashOutflow.findMany({
          where: { organizationId: orgId, date: period.current },
          select: { amount: true, method: true },
        }),
      ]);

    return {
      accountingBasis: 'CASH_BY_PAYMENT_DATE',
      collections: aggregatePaymentGroups(paymentGroups),
      expensePayments: aggregateCashPayments([
        ...expensePayments,
        ...payrollCashOutflows,
      ]),
      appliedRange: buildFinancialRangeMeta(period.current),
    };
  }

  async getInventorySnapshot(
    organizationId: string | undefined,
    startDate?: string,
    endDate?: string,
  ) {
    const orgId = this.requireOrganizationId(organizationId);
    validateDateRange(startDate, endDate);
    const period = buildFinancialComparisonPeriod(startDate, endDate);
    const [products, movements] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          organizationId: orgId,
          active: true,
          // A service is sold labour, not merchandise, so it has no place in the
          // inventory valuation. An untracked item has no stock to value either.
          type: ProductType.PRODUCT,
          tracksStock: true,
        },
        select: {
          stock: true,
          costPrice: true,
          salePrice: true,
          type: true,
          tracksStock: true,
        },
      }),
      this.prisma.inventoryMovement.findMany({
        where: {
          organizationId: orgId,
          createdAt: period.current,
          // Historical service sales left phantom movements behind; they belong to
          // the workshop, not to the merchandise ledger. Movements of merchandise
          // nobody counts stay out too.
          product: { type: ProductType.PRODUCT, tracksStock: true },
        },
        select: { type: true, quantity: true },
      }),
    ]);

    const current = products.reduce(
      (totals, product) => {
        // The query already asks only for products. Normalising again here makes the
        // valuation structurally incapable of counting sold labour, whatever a
        // caller feeds it.
        const stockedQuantity = normalizeStock(product, product.stock);
        return {
          stockQuantity: totals.stockQuantity + stockedQuantity,
          stockValue: totals.stockValue.add(
            product.costPrice.mul(stockedQuantity),
          ),
          retailValue: totals.retailValue.add(
            product.salePrice.mul(stockedQuantity),
          ),
        };
      },
      {
        stockQuantity: 0,
        stockValue: new Prisma.Decimal(0),
        retailValue: new Prisma.Decimal(0),
      },
    );
    const movementTotals = movements.reduce(
      (totals, movement) => {
        totals.totalQuantity += movement.quantity;
        totals.byType[movement.type] =
          (totals.byType[movement.type] ?? 0) + movement.quantity;
        return totals;
      },
      { totalQuantity: 0, byType: {} as Record<string, number> },
    );

    return {
      isCurrentSnapshot: true,
      valuationBasis: 'CURRENT_STOCK_AT_CURRENT_COST',
      current: {
        stockQuantity: current.stockQuantity,
        stockValue: current.stockValue.toFixed(2),
        retailValue: current.retailValue.toFixed(2),
        potentialProfit: current.retailValue.sub(current.stockValue).toFixed(2),
      },
      movements: movementTotals,
      appliedRange: buildFinancialRangeMeta(period.current),
    };
  }

  async getEconomicExport(
    organizationId: string | undefined,
    startDate?: string,
    endDate?: string,
  ) {
    const [financial, cash, inventory] = await Promise.all([
      this.getFinancialOverview(organizationId, startDate, endDate),
      this.getCashFlow(organizationId, startDate, endDate),
      this.getInventorySnapshot(organizationId, startDate, endDate),
    ]);

    return { financial, cash, inventory };
  }

  private requireOrganizationId(organizationId: string | undefined): string {
    if (!organizationId) {
      throw new BadRequestException('Organization ID is required for reports');
    }
    return organizationId;
  }

  private async findFinancialSales(organizationId: string, dateFilter: DateFilter) {
    const sales = await this.prisma.sale.findMany({
      where: {
        organizationId,
        OR: [
          { createdAt: dateFilter },
          { cancelledAt: dateFilter },
          { inventoryMovements: { some: { type: 'RETURN', createdAt: dateFilter } } },
        ],
      },
      select: {
        createdAt: true,
        cancelledAt: true,
        status: true,
        subtotal: true,
        discountAmount: true,
        taxAmount: true,
        items: {
          select: {
            productId: true,
            quantity: true,
            subtotal: true,
            discountAmount: true,
            costPriceSnapshot: true,
            product: { select: { name: true, category: { select: { name: true } } } },
          },
        },
        inventoryMovements: {
          where: { type: 'RETURN', createdAt: dateFilter },
          select: { type: true, quantity: true, productId: true, createdAt: true },
        },
      },
    });

    return sales.flatMap((sale) =>
      expandFinancialSale(
        {
          createdAt: sale.createdAt,
          cancelledAt: sale.cancelledAt,
          status: sale.status,
          subtotal: sale.subtotal,
          discountAmount: sale.discountAmount,
          taxAmount: sale.taxAmount,
          items: sale.items.map((item) => ({
            productId: item.productId,
            productName: item.product.name,
            categoryName: item.product.category.name,
            quantity: item.quantity,
            subtotal: item.subtotal,
            discountAmount: item.discountAmount,
            costPriceSnapshot: item.costPriceSnapshot,
          })),
          inventoryMovements: sale.inventoryMovements,
        },
        dateFilter,
      ),
    );
  }

  private async findFinancialExpenses(
    organizationId: string,
    dateFilter: DateFilter,
  ) {
    if (!dateFilter.gte || !dateFilter.lte) return [];
    if (this.expensesService) {
      return this.expensesService.findForReports(
        organizationId,
        dateFilter.gte,
        dateFilter.lte,
      );
    }
    return this.prisma.expense.findMany({
      where: {
        organizationId,
        active: true,
        date: { gte: dateFilter.gte, lte: dateFilter.lte },
      },
      select: { total: true, purchaseOrderId: true },
    });
  }

  async getDashboardKPIs(
    organizationId: string | undefined,
    startDate?: string,
    endDate?: string,
  ) {
    const orgId = this.requireOrganizationId(organizationId);
    validateDateRange(startDate, endDate);

    const cacheKey = `dashboard:${orgId}:${startDate || ''}:${endDate || ''}`;
    const cached = this.cache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const dateFilter = buildDateFilter(startDate, endDate);
    const comparisonPeriod = buildComparisonPeriod(startDate, endDate);
    const baseWhere: SaleWhereInput = {
      organizationId: orgId,
      ...(dateFilter && { createdAt: dateFilter }),
    };
    const salesWhere = { ...baseWhere, status: 'COMPLETED' as const };
    const currentPeriodSalesWhere = {
      organizationId: orgId,
      status: 'COMPLETED' as const,
      createdAt: comparisonPeriod.current,
    };
    const previousPeriodSalesWhere = {
      organizationId: orgId,
      status: 'COMPLETED' as const,
      createdAt: comparisonPeriod.previous,
    };

    const [
      totalSales,
      totalRevenue,
      totalProducts,
      totalCustomers,
      lowStockProducts,
      recentSales,
      currentPeriodSales,
      previousPeriodSales,
      currentPeriodRevenue,
      previousPeriodRevenue,
      currentPeriodCustomers,
      previousPeriodCustomers,
    ] = await Promise.all([
      this.prisma.sale.count({ where: salesWhere }),
      this.prisma.sale.aggregate({
        where: salesWhere,
        _sum: { total: true },
      }),
      this.prisma.product.count({
        where: { organizationId: orgId, active: true },
      }),
      this.prisma.customer.count({
        where: { organizationId: orgId, active: true },
      }),
      this.prisma.$queryRaw<[{ count: bigint }]>`
            SELECT COUNT(*)::bigint as count FROM "Product"
            WHERE "organizationId" = ${orgId} AND active = true AND stock <= "minStock" AND "type" = 'PRODUCT' AND "tracksStock" = true
          `.then((r) => Number(r[0].count)),
      this.prisma.sale.findMany({
        where: salesWhere,
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          saleNumber: true,
          total: true,
          status: true,
          createdAt: true,
          customer: {
            select: {
              id: true,
              name: true,
            },
          },
          items: {
            select: {
              id: true,
              quantity: true,
              total: true,
              product: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.sale.count({ where: currentPeriodSalesWhere }),
      this.prisma.sale.count({ where: previousPeriodSalesWhere }),
      this.prisma.sale.aggregate({
        where: currentPeriodSalesWhere,
        _sum: { total: true },
      }),
      this.prisma.sale.aggregate({
        where: previousPeriodSalesWhere,
        _sum: { total: true },
      }),
      this.prisma.customer.count({
        where: {
          organizationId: orgId,
          active: true,
          createdAt: comparisonPeriod.current,
        },
      }),
      this.prisma.customer.count({
        where: {
          organizationId: orgId,
          active: true,
          createdAt: comparisonPeriod.previous,
        },
      }),
    ]);

    const currentPeriodRevenueValue = Number(
      currentPeriodRevenue._sum.total || 0,
    );
    const previousPeriodRevenueValue = Number(
      previousPeriodRevenue._sum.total || 0,
    );

    const result = {
      totalSales,
      totalRevenue: Number(totalRevenue._sum.total || 0),
      totalProducts,
      totalCustomers,
      lowStockProducts,
      recentSales,
      trends: {
        totalSales: calculatePercentageChange(
          currentPeriodSales,
          previousPeriodSales,
        ),
        totalRevenue: calculatePercentageChange(
          currentPeriodRevenueValue,
          previousPeriodRevenueValue,
        ),
        totalCustomers: calculatePercentageChange(
          currentPeriodCustomers,
          previousPeriodCustomers,
        ),
      },
      previousPeriod: {
        revenue: previousPeriodRevenueValue,
        sales: previousPeriodSales,
      },
      appliedRange: buildAppliedRange(startDate, endDate),
      comparisonRange: buildComparisonRangeMeta(comparisonPeriod),
    };

    this.cache.set(cacheKey, result, 5 * 60 * 1000); // 5 minutes

    return result;
  }

  async getSalesByPaymentMethod(
    organizationId: string | undefined,
    startDate?: string,
    endDate?: string,
  ) {
    validateDateRange(startDate, endDate);

    const dateFilter = buildDateFilter(startDate, endDate);

    const paymentGroups = await this.prisma.payment.groupBy({
      by: ['method'],
      where: {
        sale: {
          status: 'COMPLETED',
          ...(organizationId ? { organizationId } : ({} as any)),
          ...(dateFilter && { createdAt: dateFilter }),
        },
      },
      _sum: { amount: true },
      _count: { method: true },
      orderBy: { method: 'asc' },
    });

    return {
      data: paymentGroups.map((group) => ({
        paymentMethod: group.method,
        total: Number(group._sum.amount ?? 0),
        subtotal: Number(group._sum.amount ?? 0),
        count: group._count.method,
      })),
      appliedRange: buildAppliedRange(startDate, endDate),
    };
  }

  async getSalesByCategory(
    organizationId: string | undefined,
    startDate?: string,
    endDate?: string,
  ) {
    validateDateRange(startDate, endDate);
    const dateFilter = buildDateFilter(startDate, endDate);
    const saleNested: SaleNestedWhere = {
      status: 'COMPLETED',
      ...(organizationId ? { organizationId } : ({} as any)),
      ...(dateFilter && { createdAt: dateFilter }),
    };
    const where: SaleItemWhereInput = { sale: saleNested };

    const productsByCategory = await this.prisma.saleItem.groupBy({
      by: ['productId'],
      where: where as never,
      _sum: { total: true, quantity: true },
    });

    const productIds = productsByCategory.map((p) => p.productId);
    const products = await this.prisma.product.findMany({
      where: {
        id: { in: productIds },
        ...(organizationId ? { organizationId } : {}),
      },
      select: {
        id: true,
        category: {
          select: {
            name: true,
          },
        },
      },
    });

    const categorySales = new Map<
      string,
      { total: number; quantity: number }
    >();

    products.forEach((product) => {
      const saleData = productsByCategory.find(
        (p) => p.productId === product.id,
      );
      if (saleData) {
        const categoryName = product.category.name;
        const existing = categorySales.get(categoryName) ?? {
          total: 0,
          quantity: 0,
        };
        categorySales.set(categoryName, {
          total: existing.total + Number(saleData._sum.total),
          quantity: existing.quantity + (saleData._sum.quantity ?? 0),
        });
      }
    });

    return {
      data: Array.from(categorySales.entries()).map(([category, data]) => ({
        category,
        total: data.total,
        quantity: data.quantity,
      })),
      appliedRange: buildAppliedRange(startDate, endDate),
    };
  }

  /**
   * Daily sales grouped by category (date × category). Powers the dashboard
   * stacked category chart: each row is `{ date, category, total, quantity }`,
   * with `date` being the Bogotá day of the sale and `category` the product
   * category name. Follows the same validation / scoping pattern as
   * `getSalesByCategory` (833) and `getDailySales` (1173).
   */
  async getSalesByCategoryDaily(
    organizationId: string | undefined,
    startDate?: string,
    endDate?: string,
  ) {
    validateDateRange(startDate, endDate);
    const dateFilter = buildDateFilter(startDate, endDate);
    const saleNested: SaleNestedWhere = {
      status: 'COMPLETED',
      ...(organizationId ? { organizationId } : ({} as any)),
      ...(dateFilter && { createdAt: dateFilter }),
    };
    const where: SaleItemWhereInput = { sale: saleNested };

    const saleItems = await this.prisma.saleItem.findMany({
      where: where as never,
      select: {
        total: true,
        quantity: true,
        sale: { select: { createdAt: true } },
        product: {
          select: {
            category: { select: { name: true } },
          },
        },
      },
    });

    const byDate = new Map<
      string,
      Map<string, { total: number; quantity: number }>
    >();

    saleItems.forEach((item) => {
      const date = formatDateInBogota(item.sale?.createdAt ?? new Date());
      const categoryName = item.product?.category?.name ?? 'Sin categoría';
      const dayMap = byDate.get(date) ?? new Map();
      const existing = dayMap.get(categoryName) ?? { total: 0, quantity: 0 };
      dayMap.set(categoryName, {
        total: existing.total + Number(item.total),
        quantity: existing.quantity + (item.quantity ?? 0),
      });
      byDate.set(date, dayMap);
    });

    const data: Array<{
      date: string;
      category: string;
      total: number;
      quantity: number;
    }> = [];

    for (const [date, dayMap] of byDate) {
      for (const [category, summary] of dayMap) {
        data.push({
          date,
          category,
          total: summary.total,
          quantity: summary.quantity,
        });
      }
    }

    return {
      data,
      appliedRange: buildAppliedRange(startDate, endDate),
    };
  }

  async getTopSellingProducts(
    organizationId: string | undefined,
    startDate?: string,
    endDate?: string,
    limit: number = 10,
  ) {
    validateDateRange(startDate, endDate);
    const dateFilter = buildDateFilter(startDate, endDate);
    const saleNested: SaleNestedWhere = {
      status: 'COMPLETED',
      ...(organizationId ? { organizationId } : ({} as any)),
      ...(dateFilter && { createdAt: dateFilter }),
    };
    const where: SaleItemWhereInput = { sale: saleNested };

    const products = await this.prisma.saleItem.groupBy({
      by: ['productId'],
      where: where as never,
      _sum: { quantity: true, total: true },
      orderBy: { _sum: { total: 'desc' } },
      take: limit,
    });

    const productIds = products.map((p) => p.productId);
    const productDetails = await this.prisma.product.findMany({
      where: {
        id: { in: productIds },
        ...(organizationId ? { organizationId } : {}),
      },
      select: {
        id: true,
        name: true,
        stock: true,
      },
    });

    return {
      data: products.map((p) => {
        const product = productDetails.find((pd) => pd.id === p.productId);
        return {
          productId: p.productId,
          productName: product?.name || 'Unknown',
          quantity: p._sum.quantity,
          total: Number(p._sum.total),
          stock: product?.stock || 0,
        };
      }),
      appliedRange: buildAppliedRange(startDate, endDate),
    };
  }

  async getCustomerStatistics(
    organizationId: string | undefined,
    startDate?: string,
    endDate?: string,
  ) {
    validateDateRange(startDate, endDate);
    const dateFilter = buildDateFilter(startDate, endDate);
    const where: CustomerSaleWhereInput = {
      ...(organizationId ? { organizationId } : ({} as any)),
      ...(dateFilter && { createdAt: dateFilter }),
    };

    const [totalCustomers, customersWithSales, topCustomers] =
      await Promise.all([
        this.prisma.customer.count({
          where: {
            ...(organizationId ? { organizationId } : {}),
            active: true,
          },
        }),
        this.prisma.sale.groupBy({
          by: ['customerId'],
          where: where as never,
          _count: { id: true },
          _sum: { total: true },
        }),
        this.prisma.sale.groupBy({
          by: ['customerId'],
          where: where as never,
          _count: { id: true },
          _sum: { total: true },
          orderBy: { _sum: { total: 'desc' } },
          take: 10,
        }),
      ]);

    const customerIds = topCustomers
      .map((c) => c.customerId)
      .filter((id): id is string => id !== null);
    const customerDetails = await this.prisma.customer.findMany({
      where: {
        id: { in: customerIds },
        ...(organizationId ? { organizationId } : {}),
      },
    });

    return {
      totalCustomers,
      activeCustomers: customersWithSales.length,
      topCustomers: topCustomers.map((c) => {
        const customer = customerDetails.find((cd) => cd.id === c.customerId);
        return {
          customerId: c.customerId,
          customerName: customer?.name || 'Guest',
          totalSales: c._count.id,
          totalRevenue: Number(c._sum.total),
        };
      }),
      appliedRange: buildAppliedRange(startDate, endDate),
    };
  }

  async getUserPerformance(
    organizationId: string | undefined,
    startDate?: string,
    endDate?: string,
    compare: boolean = true,
    userIds?: string[],
  ): Promise<UserPerformanceReport> {
    validateDateRange(startDate, endDate);

    const comparisonPeriod = buildComparisonPeriod(startDate, endDate);
    const selectedUserIds = normalizeUserIds(userIds);
    const currentFilter = compare
      ? comparisonPeriod.current
      : buildDateFilter(startDate, endDate);
    const currentWhere: SaleWhereInput = {
      ...(organizationId ? { organizationId } : ({} as any)),
      status: 'COMPLETED',
      ...(currentFilter && { createdAt: currentFilter }),
      ...(selectedUserIds && { userId: { in: selectedUserIds } }),
    };

    const currentSales = await this.prisma.sale.findMany({
      where: currentWhere as never,
      select: {
        userId: true,
        total: true,
        customerId: true,
      },
    });

    const aggregateSales = (
      sales: Array<{
        userId: string | null;
        total: unknown;
        customerId: string | null;
      }>,
    ): Map<string, UserAggregation> => {
      const totalsByUser = new Map<string, UserAggregation>();

      for (const sale of sales) {
        if (!sale.userId) continue; // Skip sales with deleted users

        const current = totalsByUser.get(sale.userId) ?? {
          salesCount: 0,
          revenue: 0,
          customerIds: new Set<string>(),
        };

        current.salesCount += 1;
        current.revenue += Number(sale.total);
        if (sale.customerId) {
          current.customerIds.add(sale.customerId);
        }

        totalsByUser.set(sale.userId, current);
      }

      return totalsByUser;
    };

    const currentAggregates = aggregateSales(currentSales);
    let previousAggregates = new Map<string, UserAggregation>();

    if (compare) {
      const previousSales = await this.prisma.sale.findMany({
        where: {
          ...(organizationId ? { organizationId } : {}),
          status: 'COMPLETED',
          createdAt: comparisonPeriod.previous,
          ...(selectedUserIds && {
            userId: {
              in: selectedUserIds,
            },
          }),
        } as never,
        select: {
          userId: true,
          total: true,
          customerId: true,
        },
      });

      previousAggregates = aggregateSales(previousSales);
    }

    const relevantUserIds =
      selectedUserIds ??
      Array.from(
        new Set([...currentAggregates.keys(), ...previousAggregates.keys()]),
      );

    if (relevantUserIds.length === 0) {
      return {
        data: [],
        appliedRange: buildAppliedRange(startDate, endDate),
        ...(compare && {
          comparisonRange: buildComparisonRangeMeta(comparisonPeriod),
        }),
      };
    }

    const users = await this.prisma.user.findMany({
      where: {
        id: {
          in: relevantUserIds,
        },
        ...(organizationId && {
          OR: [
            { organizationUsers: { some: { organizationId } } },
            { sales: { some: { organizationId } } },
          ],
        }),
      },
      select: {
        id: true,
        name: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    const rows = users.map((user) => {
      const current = currentAggregates.get(user.id) ?? {
        salesCount: 0,
        revenue: 0,
        customerIds: new Set<string>(),
      };
      const previous = previousAggregates.get(user.id);

      return {
        userId: user.id,
        userName: user.name,
        salesCount: current.salesCount,
        revenue: current.revenue,
        avgTicket:
          current.salesCount > 0 ? current.revenue / current.salesCount : 0,
        uniqueCustomers: current.customerIds.size,
        comparison: compare
          ? {
              revenuePct: calculatePercentageChange(
                current.revenue,
                previous?.revenue ?? 0,
              ),
              salesPct: calculatePercentageChange(
                current.salesCount,
                previous?.salesCount ?? 0,
              ),
            }
          : undefined,
      };
    });

    return {
      data: rows.toSorted((a, b) => b.revenue - a.revenue),
      appliedRange: buildAppliedRange(
        compare ? formatDateInBogota(comparisonPeriod.current.gte!) : startDate,
        compare ? formatDateInBogota(comparisonPeriod.current.lte!) : endDate,
      ),
      ...(compare && {
        comparisonRange: buildComparisonRangeMeta(comparisonPeriod),
      }),
    };
  }

  async getDailySales(
    organizationId: string | undefined,
    startDate: string,
    endDate: string,
  ) {
    validateDateRange(startDate, endDate);
    const startDateFilter = parseBogotaStartOfDay(startDate);
    const endDateFilter = parseBogotaEndOfDay(endDate);

    if (!startDateFilter || !endDateFilter) {
      return { data: [], appliedRange: buildAppliedRange(startDate, endDate) };
    }

    const sales = await this.prisma.sale.findMany({
      where: {
        ...(organizationId ? { organizationId } : {}),
        status: 'COMPLETED',
        createdAt: {
          gte: startDateFilter,
          lte: endDateFilter,
        },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        createdAt: true,
        total: true,
        subtotal: true,
        taxAmount: true,
      },
    });

    const salesByDay = new Map<string, DaySummary>();

    sales.forEach((sale) => {
      const date = formatDateInBogota(sale.createdAt);
      const existing: DaySummary = salesByDay.get(date) ?? {
        total: 0,
        subtotal: 0,
        tax: 0,
        count: 0,
      };
      salesByDay.set(date, {
        total: existing.total + Number(sale.total),
        subtotal: existing.subtotal + Number(sale.subtotal),
        tax: existing.tax + Number(sale.taxAmount),
        count: existing.count + 1,
      });
    });

    return {
      data: Array.from(salesByDay.entries()).map(([date, data]) => ({
        date,
        ...data,
      })),
      appliedRange: buildAppliedRange(startDate, endDate),
    };
  }
}
