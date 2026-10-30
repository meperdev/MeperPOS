import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExpensePaymentStatus, Prisma } from '@prisma/client';
import {
  formatDateInBogota,
  parseBogotaMonthRange,
} from '../common/utils/bogota-date';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { CreateExpensePaymentDto } from './dto/create-expense-payment.dto';
import { QueryExpensesDto } from './dto/query-expenses.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';

export function deriveExpensePaymentStatus(
  total: Prisma.Decimal,
  paymentsSum: Prisma.Decimal,
): ExpensePaymentStatus {
  return paymentsSum.gte(total) ? 'PAID' : 'PARTIAL';
}

@Injectable()
export class ExpensesService {
  constructor(
    private prisma: PrismaService,
    private cloudinaryService: CloudinaryService,
  ) {}

  private requireOrganizationId(organizationId: string | undefined): string {
    if (!organizationId) {
      throw new BadRequestException(
        'Organization ID is required for this operation',
      );
    }
    return organizationId;
  }

  private async assertLabelInOrganization(
    labelId: string,
    organizationId: string,
  ): Promise<void> {
    const label = await this.prisma.expenseLabel.findFirst({
      where: { id: labelId, organizationId, active: true },
      include: { group: { select: { organizationId: true, active: true } } },
    });
    if (
      !label ||
      !label.active ||
      !label.group.active ||
      label.group.organizationId !== organizationId
    ) {
      throw new NotFoundException('Expense label not found');
    }
  }

  private async assertSupplierInOrganization(
    supplierId: string,
    organizationId: string,
  ): Promise<void> {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, organizationId },
    });
    if (!supplier) {
      throw new NotFoundException('Proveedor no encontrado');
    }
  }

  private async assertPurchaseOrderInOrganization(
    purchaseOrderId: string,
    organizationId: string,
  ): Promise<void> {
    const purchaseOrder = await this.prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, organizationId },
    });
    if (!purchaseOrder) {
      throw new NotFoundException('Orden de compra no encontrada');
    }
  }

  private sumPayments(payments: { amount: Prisma.Decimal }[]): Prisma.Decimal {
    return payments.reduce(
      (sum, payment) => sum.add(payment.amount),
      new Prisma.Decimal(0),
    );
  }

  /**
   * Payroll-owned guard for the existing expense mutations (`update`,
   * `addPayment`, `remove`).
   *
   * It must run as the first statement inside the business transaction, before
   * any read whose result decides a write: it locks the tenant's `Expense` row
   * with `SELECT ... FOR UPDATE`, then asks whether payroll linked that expense
   * to an obligation. A linked expense is payroll history, so the expense API
   * refuses the change with 409 instead of rewriting a completed payroll payment.
   * The payroll tables are only read here; no payroll or cash row is locked.
   *
   * Known limits, intentionally not implemented in this unit: this guard is not
   * payroll-owned annulment (payroll still cannot annul a linked expense through
   * this path) and it is not a complete cross-writer lock protocol. A payroll
   * writer that inserts `PayrollObligationExpense` rows waits on this row lock
   * through the link foreign key, but it must still take the same
   * `Expense ... FOR UPDATE` lock before its own verification, or it could verify
   * the expense from facts this mutation has already changed. That writer is
   * still unwired.
   */
  private async lockExpenseForGuardedMutation(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ): Promise<void> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Expense"
      WHERE "id" = ${id} AND "organizationId" = ${organizationId}
      FOR UPDATE`;

    if (locked.length === 0) {
      throw new NotFoundException('Salida no encontrada');
    }

    const payrollLink = await tx.payrollObligationExpense.findFirst({
      where: { expenseId: id, organizationId },
      select: { obligationId: true },
    });

    if (payrollLink) {
      throw new ConflictException(
        'La salida está vinculada a una obligación de nómina y no puede modificarse',
      );
    }
  }

  async create(
    dto: CreateExpenseDto,
    userId: string,
    organizationId: string | undefined,
  ) {
    const orgId = this.requireOrganizationId(organizationId);

    await this.assertLabelInOrganization(dto.labelId, orgId);
    if (dto.supplierId) {
      await this.assertSupplierInOrganization(dto.supplierId, orgId);
    }
    if (dto.purchaseOrderId) {
      await this.assertPurchaseOrderInOrganization(dto.purchaseOrderId, orgId);
    }

    if (dto.payments.length === 0) {
      throw new BadRequestException(
        'Cada salida debe registrarse con al menos un pago',
      );
    }

    const total = new Prisma.Decimal(dto.total);
    const paymentsSum = this.sumPayments(
      dto.payments.map((payment) => ({
        amount: new Prisma.Decimal(payment.amount),
      })),
    );

    if (paymentsSum.gt(total)) {
      throw new BadRequestException(
        'La suma de los pagos no puede superar el total de la salida',
      );
    }

    const status = deriveExpensePaymentStatus(total, paymentsSum);

    return this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          organizationId: orgId,
          labelId: dto.labelId,
          supplierId: dto.supplierId ?? null,
          purchaseOrderId: dto.purchaseOrderId ?? null,
          description: dto.description ?? null,
          date: new Date(dto.date),
          total,
          status,
          createdById: userId,
          payments: {
            create: dto.payments.map((payment) => ({
              organizationId: orgId,
              amount: new Prisma.Decimal(payment.amount),
              method: payment.method,
              date: new Date(payment.date),
            })),
          },
        },
        include: {
          payments: true,
          label: { include: { group: true } },
          supplier: true,
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'EXPENSE_CREATED',
          resource: 'Expense',
          resourceId: expense.id,
          organizationId: orgId,
          metadata: {
            summary: `Salida creada por ${total.toString()}`,
            total: total.toString(),
            status,
            payments: dto.payments.map((payment) => ({
              amount: new Prisma.Decimal(payment.amount).toString(),
              method: payment.method,
              date: payment.date,
            })),
            timestamp: new Date().toISOString(),
          },
        },
      });

      return expense;
    });
  }

  async findAll(query: QueryExpensesDto, organizationId: string | undefined) {
    const orgId = this.requireOrganizationId(organizationId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const where: Prisma.ExpenseWhereInput = {
      organizationId: orgId,
      active: true,
    };

    if (query.month) {
      const { start, end } = parseBogotaMonthRange(query.month);
      where.date = { gte: start, lte: end };
    }
    if (query.labelId) {
      where.labelId = query.labelId;
    }
    if (query.supplierId) {
      where.supplierId = query.supplierId;
    }
    if (query.status) {
      where.status = query.status;
    }

    const search = query.search?.trim();
    if (search) {
      where.description = { contains: search, mode: 'insensitive' };
    }

    const [data, total] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        skip,
        take: limit,
        orderBy: { date: 'desc' },
        include: {
          label: { include: { group: true } },
          supplier: true,
          payments: true,
        },
      }),
      this.prisma.expense.count({ where }),
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

  async getMonthlySummary(month: string, organizationId: string | undefined) {
    const orgId = this.requireOrganizationId(organizationId);
    const { start, end } = parseBogotaMonthRange(month);

    const grouped = await this.prisma.expense.groupBy({
      by: ['labelId'],
      where: {
        organizationId: orgId,
        active: true,
        date: { gte: start, lte: end },
      },
      _sum: { total: true },
    });

    const categories = await this.prisma.expenseLabel.findMany({
      where: { id: { in: grouped.map((row) => row.labelId) } },
      select: {
        id: true,
        name: true,
        groupId: true,
        group: { select: { id: true, name: true } },
      },
    });

    const labelsById = new Map(categories.map((label) => [label.id, label]));

    const groups = new Map<
      string,
      {
        groupId: string;
        name: string;
        total: Prisma.Decimal;
        labels: Array<{ labelId: string; name: string; total: Prisma.Decimal }>;
      }
    >();
    for (const row of grouped) {
      const label = labelsById.get(row.labelId);
      if (!label) continue;
      const amount = row._sum.total ?? new Prisma.Decimal(0);
      const current = groups.get(label.group.id) ?? {
        groupId: label.group.id,
        name: label.group.name,
        total: new Prisma.Decimal(0),
        labels: [],
      };
      current.total = current.total.add(amount);
      current.labels.push({
        labelId: label.id,
        name: label.name,
        total: amount,
      });
      groups.set(label.group.id, current);
    }
    const rows = [...groups.values()]
      .map((group) => ({
        ...group,
        labels: group.labels.sort(
          (a, b) =>
            b.total.comparedTo(a.total) ||
            a.name.localeCompare(b.name) ||
            a.labelId.localeCompare(b.labelId),
        ),
      }))
      .sort(
        (a, b) =>
          b.total.comparedTo(a.total) ||
          a.name.localeCompare(b.name) ||
          a.groupId.localeCompare(b.groupId),
      );

    const total = rows.reduce(
      (sum, row) => sum.add(row.total),
      new Prisma.Decimal(0),
    );

    return { month, total, groups: rows };
  }

  async findForReports(organizationId: string, start: Date, end: Date) {
    return this.prisma.expense.findMany({
      where: {
        organizationId: this.requireOrganizationId(organizationId),
        active: true,
        date: { gte: start, lte: end },
      },
      select: {
        total: true,
        purchaseOrderId: true,
        label: { select: { name: true, group: { select: { name: true } } } },
      },
    });
  }

  async findOne(id: string, organizationId: string | undefined) {
    const orgId = this.requireOrganizationId(organizationId);

    const expense = await this.prisma.expense.findFirst({
      where: { id, organizationId: orgId },
      include: {
        label: { include: { group: true } },
        supplier: true,
        purchaseOrder: true,
        payments: { orderBy: { date: 'asc' } },
      },
    });

    if (!expense) {
      throw new NotFoundException('Salida no encontrada');
    }

    return expense;
  }

  async update(
    id: string,
    dto: UpdateExpenseDto,
    userId: string,
    organizationId: string | undefined,
  ) {
    const orgId = this.requireOrganizationId(organizationId);

    const existing = await this.prisma.expense.findFirst({
      where: { id, organizationId: orgId },
      include: { payments: true },
    });

    if (!existing) {
      throw new NotFoundException('Salida no encontrada');
    }

    if (dto.labelId) {
      await this.assertLabelInOrganization(dto.labelId, orgId);
    }
    if (dto.supplierId) {
      await this.assertSupplierInOrganization(dto.supplierId, orgId);
    }
    if (dto.purchaseOrderId) {
      await this.assertPurchaseOrderInOrganization(dto.purchaseOrderId, orgId);
    }

    const newTotal =
      dto.total !== undefined ? new Prisma.Decimal(dto.total) : existing.total;
    const paymentsSum = this.sumPayments(existing.payments);

    if (newTotal.lt(paymentsSum)) {
      throw new BadRequestException(
        'El nuevo total no puede ser menor que la suma de los pagos registrados',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await this.lockExpenseForGuardedMutation(tx, id, orgId);

      // The pre-transaction read only fast-fails. The amount, payment limits and
      // derived status come from the post-lock reread of the locked row; the
      // label/supplier/purchase-order membership checks remain the
      // pre-transaction tenant asserts they already were.
      const locked = await tx.expense.findFirst({
        where: { id, organizationId: orgId },
        include: { payments: true },
      });

      if (!locked) {
        throw new NotFoundException('Salida no encontrada');
      }

      const lockedTotal =
        dto.total !== undefined ? new Prisma.Decimal(dto.total) : locked.total;
      const lockedPaymentsSum = this.sumPayments(locked.payments);

      if (lockedTotal.lt(lockedPaymentsSum)) {
        throw new BadRequestException(
          'El nuevo total no puede ser menor que la suma de los pagos registrados',
        );
      }

      const lockedStatus = deriveExpensePaymentStatus(
        lockedTotal,
        lockedPaymentsSum,
      );

      const updated = await tx.expense.update({
        where: { id },
        data: {
          ...(dto.labelId !== undefined && { labelId: dto.labelId }),
          ...(dto.supplierId !== undefined && { supplierId: dto.supplierId }),
          ...(dto.purchaseOrderId !== undefined && {
            purchaseOrderId: dto.purchaseOrderId,
          }),
          ...(dto.description !== undefined && {
            description: dto.description,
          }),
          ...(dto.date !== undefined && { date: new Date(dto.date) }),
          ...(dto.total !== undefined && { total: lockedTotal }),
          status: lockedStatus,
        },
        include: {
          label: { include: { group: true } },
          supplier: true,
          payments: true,
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'EXPENSE_UPDATED',
          resource: 'Expense',
          resourceId: id,
          organizationId: orgId,
          metadata: {
            summary: 'Salida actualizada',
            before: {
              total: locked.total.toString(),
              status: locked.status,
              description: locked.description,
              date: locked.date.toISOString(),
            },
            after: {
              total: updated.total.toString(),
              status: updated.status,
              description: updated.description,
              date: updated.date.toISOString(),
            },
            timestamp: new Date().toISOString(),
          },
        },
      });

      return updated;
    });
  }

  async addPayment(
    id: string,
    dto: CreateExpensePaymentDto,
    userId: string,
    organizationId: string | undefined,
  ) {
    const orgId = this.requireOrganizationId(organizationId);

    const existing = await this.prisma.expense.findFirst({
      where: { id, organizationId: orgId },
      include: { payments: true },
    });

    if (!existing) {
      throw new NotFoundException('Salida no encontrada');
    }

    if (!existing.active) {
      throw new BadRequestException(
        'No se pueden registrar pagos en una salida eliminada',
      );
    }

    const amount = new Prisma.Decimal(dto.amount);
    const paymentsSum = this.sumPayments(existing.payments).add(amount);

    if (paymentsSum.gt(existing.total)) {
      throw new BadRequestException(
        'La suma de los pagos no puede superar el total de la salida',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await this.lockExpenseForGuardedMutation(tx, id, orgId);

      // The pre-transaction read only fast-fails. The active flag, the payments
      // sum and the resulting status come from the post-lock reread.
      const locked = await tx.expense.findFirst({
        where: { id, organizationId: orgId },
        include: { payments: true },
      });

      if (!locked) {
        throw new NotFoundException('Salida no encontrada');
      }

      if (!locked.active) {
        throw new BadRequestException(
          'No se pueden registrar pagos en una salida eliminada',
        );
      }

      const lockedPaymentsSum = this.sumPayments(locked.payments).add(amount);

      if (lockedPaymentsSum.gt(locked.total)) {
        throw new BadRequestException(
          'La suma de los pagos no puede superar el total de la salida',
        );
      }

      const lockedStatus = deriveExpensePaymentStatus(
        locked.total,
        lockedPaymentsSum,
      );

      await tx.expensePayment.create({
        data: {
          expenseId: id,
          organizationId: orgId,
          amount,
          method: dto.method,
          date: new Date(dto.date),
        },
      });

      const updated = await tx.expense.update({
        where: { id },
        data: { status: lockedStatus },
        include: {
          label: { include: { group: true } },
          supplier: true,
          payments: true,
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'EXPENSE_PAYMENT_ADDED',
          resource: 'Expense',
          resourceId: id,
          organizationId: orgId,
          metadata: {
            summary: `Pago de ${amount.toString()} registrado`,
            amount: amount.toString(),
            method: dto.method,
            date: dto.date,
            beforeStatus: locked.status,
            afterStatus: lockedStatus,
            timestamp: new Date().toISOString(),
          },
        },
      });

      return updated;
    });
  }

  async duplicate(
    id: string,
    userId: string,
    organizationId: string | undefined,
  ) {
    const orgId = this.requireOrganizationId(organizationId);

    const existing = await this.prisma.expense.findFirst({
      where: { id, organizationId: orgId },
      include: { payments: true },
    });

    if (!existing) {
      throw new NotFoundException('Salida no encontrada');
    }

    if (!existing.active) {
      throw new BadRequestException(
        'No se puede duplicar una salida eliminada',
      );
    }

    if (existing.payments.length === 0) {
      throw new BadRequestException(
        'Cada salida debe registrarse con al menos un pago',
      );
    }

    const paymentsSum = this.sumPayments(existing.payments);

    if (paymentsSum.gt(existing.total)) {
      throw new BadRequestException(
        'La suma de los pagos no puede superar el total de la salida',
      );
    }

    const status = deriveExpensePaymentStatus(existing.total, paymentsSum);
    const today = new Date(formatDateInBogota(new Date()));

    return this.prisma.$transaction(async (tx) => {
      const duplicated = await tx.expense.create({
        data: {
          organizationId: orgId,
          labelId: existing.labelId,
          supplierId: existing.supplierId,
          purchaseOrderId: existing.purchaseOrderId,
          description: existing.description,
          date: today,
          total: existing.total,
          status,
          createdById: userId,
          payments: {
            create: existing.payments.map((payment) => ({
              organizationId: orgId,
              amount: payment.amount,
              method: payment.method,
              date: payment.date,
            })),
          },
        },
        include: {
          payments: true,
          label: { include: { group: true } },
          supplier: true,
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'EXPENSE_DUPLICATED',
          resource: 'Expense',
          resourceId: duplicated.id,
          organizationId: orgId,
          metadata: {
            summary: 'Salida duplicada',
            originalId: id,
            total: existing.total.toString(),
            status,
            timestamp: new Date().toISOString(),
          },
        },
      });

      return duplicated;
    });
  }

  async getHistory(id: string, organizationId: string | undefined) {
    const orgId = this.requireOrganizationId(organizationId);

    const expense = await this.prisma.expense.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    });

    if (!expense) {
      throw new NotFoundException('Salida no encontrada');
    }

    return this.prisma.auditLog.findMany({
      where: { resource: 'Expense', resourceId: id, organizationId: orgId },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { name: true, email: true } } },
    });
  }

  async uploadReceipt(
    id: string,
    file: Express.Multer.File,
    userId: string,
    organizationId: string | undefined,
  ) {
    const orgId = this.requireOrganizationId(organizationId);

    const existing = await this.prisma.expense.findFirst({
      where: { id, organizationId: orgId },
    });

    if (!existing) {
      throw new NotFoundException('Salida no encontrada');
    }

    const receiptUrl = await this.cloudinaryService.uploadImage(
      file,
      'expense-receipts',
    );

    if (existing.receiptUrl) {
      try {
        await this.cloudinaryService.deleteImage(existing.receiptUrl);
      } catch (error) {
        console.error('Error deleting old receipt:', error);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.expense.update({
        where: { id },
        data: { receiptUrl },
        include: {
          label: { include: { group: true } },
          supplier: true,
          payments: true,
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'EXPENSE_RECEIPT_UPLOADED',
          resource: 'Expense',
          resourceId: id,
          organizationId: orgId,
          metadata: {
            summary: 'Comprobante adjuntado',
            receiptUrl,
            timestamp: new Date().toISOString(),
          },
        },
      });

      return updated;
    });
  }

  async remove(id: string, userId: string, organizationId: string | undefined) {
    const orgId = this.requireOrganizationId(organizationId);

    const existing = await this.prisma.expense.findFirst({
      where: { id, organizationId: orgId },
    });

    if (!existing) {
      throw new NotFoundException('Salida no encontrada');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.lockExpenseForGuardedMutation(tx, id, orgId);

      // The audited total comes from the post-lock reread, not from the
      // pre-transaction snapshot.
      const locked = await tx.expense.findFirst({
        where: { id, organizationId: orgId },
      });

      if (!locked) {
        throw new NotFoundException('Salida no encontrada');
      }

      const updated = await tx.expense.update({
        where: { id },
        data: { active: false },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'EXPENSE_DELETED',
          resource: 'Expense',
          resourceId: id,
          organizationId: orgId,
          metadata: {
            summary: 'Salida eliminada (borrado lógico)',
            total: locked.total.toString(),
            timestamp: new Date().toISOString(),
          },
        },
      });

      return updated;
    });
  }
}
