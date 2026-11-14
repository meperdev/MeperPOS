import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  formatDateInBogota,
  parseBogotaStartOfDay,
} from '../common/utils/bogota-date';
import { isLowStock } from '../products/product-type.logic';

@Injectable()
export class DailyReportService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(organizationId: string | undefined) {
    if (!organizationId?.trim())
      throw new ForbiddenException('Organization scope required');
    const cutoff = new Date();
    const date = formatDateInBogota(cutoff);
    const start = parseBogotaStartOfDay(date)!;
    // MoneyLoan.dueAt is a PostgreSQL date, represented by UTC midnight.
    const dueThrough = new Date(`${date}T00:00:00.000Z`);
    dueThrough.setUTCDate(dueThrough.getUTCDate() + 3);
    const range = { gte: start, lte: cutoff };
    // Date-only expense inputs are persisted by new Date('YYYY-MM-DD') as
    // UTC midnight. A timestamp at that exact instant is indistinguishable.
    const expenseDate = new Date(`${date}T00:00:00.000Z`);
    const nextExpenseDate = new Date(
      expenseDate.getTime() + 24 * 60 * 60 * 1000,
    );

    return this.prisma.$transaction(
      async (tx) => {
        const [sales, expenses, products, orders, loans] = await Promise.all([
          tx.sale.findMany({
            where: { organizationId, status: 'COMPLETED', createdAt: range },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              saleNumber: true,
              createdAt: true,
              total: true,
              customer: {
                select: {
                  organizationId: true,
                  name: true,
                  documentNumber: true,
                },
              },
              items: {
                where: { organizationId, product: { organizationId } },
                select: {
                  quantity: true,
                  unitPrice: true,
                  total: true,
                  product: { select: { name: true, sku: true } },
                },
              },
            },
          }),
          tx.expense.findMany({
            where: {
              organizationId,
              active: true,
              OR: [
                { date: expenseDate },
                { date: { ...range, not: nextExpenseDate } },
              ],
              createdAt: { lte: cutoff },
              label: { organizationId },
            },
            orderBy: [{ date: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              date: true,
              description: true,
              total: true,
              status: true,
              label: { select: { name: true } },
            },
          }),
          tx.product.findMany({
            where: { organizationId, active: true, createdAt: { lte: cutoff } },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              name: true,
              sku: true,
              type: true,
              tracksStock: true,
              stock: true,
              minStock: true,
            },
          }),
          tx.purchaseOrder.findMany({
            where: {
              organizationId,
              status: { in: ['PENDING', 'PARTIAL_RECEIVED'] },
              supplier: { organizationId },
              createdAt: { lte: cutoff },
            },
            orderBy: [{ orderNumber: 'asc' }],
            select: {
              id: true,
              orderNumber: true,
              status: true,
              total: true,
              supplier: { select: { name: true } },
            },
          }),
          tx.moneyLoan.findMany({
            where: {
              organizationId,
              status: 'OPEN',
              dueAt: { lte: dueThrough },
              createdAt: { lte: cutoff },
            },
            orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              type: true,
              amount: true,
              dueAt: true,
              reason: true,
              customer: { select: { organizationId: true, name: true } },
              supplier: { select: { organizationId: true, name: true } },
              events: {
                where: { organizationId, createdAt: { lte: cutoff } },
                select: { type: true, amount: true },
              },
            },
          }),
        ]);
        const sum = (values: Prisma.Decimal[]) =>
          values.reduce((a, b) => a.plus(b), new Prisma.Decimal(0)).toFixed(2);
        return {
          cutoff,
          date,
          timezone: 'America/Bogota' as const,
          salesTotal: sum(sales.map((sale) => sale.total)),
          expenseTotal: sum(expenses.map((expense) => expense.total)),
          sales: sales.map((sale) => ({
            ...sale,
            total: sale.total.toFixed(2),
            customer:
              sale.customer?.organizationId === organizationId
                ? {
                    name: sale.customer.name,
                    documentNumber: sale.customer.documentNumber,
                  }
                : null,
            items: sale.items.map((item) => ({
              ...item,
              unitPrice: item.unitPrice.toFixed(2),
              total: item.total.toFixed(2),
            })),
          })),
          expenses: expenses.map((expense) => ({
            ...expense,
            total: expense.total.toFixed(2),
          })),
          lowStock: products.filter((product) =>
            isLowStock(product, product.stock, product.minStock),
          ),
          purchaseOrders: orders.map((order) => ({
            ...order,
            total: order.total.toFixed(2),
          })),
          loans: loans.map(
            ({ events, customer, supplier, amount, ...loan }) => {
              const collected = events.reduce((total, event) => {
                if (!event.amount) return total;
                if (event.type === 'COLLECTED') return total.plus(event.amount);
                if (event.type === 'REVERSED') return total.minus(event.amount);
                return total;
              }, new Prisma.Decimal(0));
              return {
                ...loan,
                amount: amount.toFixed(2),
                balance: amount.minus(collected).toFixed(2),
                customer:
                  customer?.organizationId === organizationId
                    ? customer.name
                    : null,
                supplier:
                  supplier?.organizationId === organizationId
                    ? supplier.name
                    : null,
              };
            },
          ),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}

export type DailyReport = Awaited<ReturnType<DailyReportService['generate']>>;
