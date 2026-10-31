import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PayrollObligationKind,
  PayrollObligationStatus,
  Prisma,
} from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { allocatePeriodInstallment } from './payroll-allocation';
import { writePayrollCompletionExpense } from './payroll-completed-expense-writer';
import { resolvePayrollExpenseCategoryWithin } from './payroll-expense-category.service';
import type { PayrollObligationCompletionFacts } from './payroll-obligation-completion';
import { planPayrollObligationCompletion } from './payroll-obligation-completion';
import { CreatePayrollPeriodInstallmentDto } from './dto/create-payroll-period-installment.dto';
import { throwPayrollTransactionError } from './payroll-transaction-error';

@Injectable()
export class PayrollPeriodInstallmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    input: unknown,
    organizationId: string | undefined,
    actor: RequestUser | undefined,
  ) {
    if (
      !organizationId ||
      !actor?.userId ||
      actor.organizationId !== organizationId ||
      !['OWNER', 'ADMIN'].includes(actor.role)
    )
      throw new ForbiddenException('No tiene permiso para gestionar nómina');
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new BadRequestException('Datos de abono inválidos');
    const rawAmount = (input as { amount?: unknown }).amount;
    if (
      typeof rawAmount === 'string' &&
      (rawAmount.length > 131075 || rawAmount.split('.', 1)[0].length > 131072)
    )
      throw new BadRequestException('Datos de abono inválidos');
    const dto = plainToInstance(CreatePayrollPeriodInstallmentDto, input);
    if (
      validateSync(dto, { whitelist: true, forbidNonWhitelisted: true })
        .length ||
      !new Prisma.Decimal(dto.amount).gt(0)
    )
      throw new BadRequestException('Datos de abono inválidos');

    const transaction = this.prisma.$transaction(async (tx) => {
      // All payroll mutations must acquire the employee before the obligation.
      // Inactive employees may still receive payments for existing obligations.
      const employees = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Employee" WHERE "id" = ${dto.employeeId}
        AND "organizationId" = ${organizationId} FOR UPDATE`;
      if (!employees.length)
        throw new NotFoundException('Empleado no encontrado');
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "PayrollObligation" WHERE "id" = ${dto.obligationId}
        AND "organizationId" = ${organizationId} AND "employeeId" = ${dto.employeeId} FOR UPDATE`;
      if (!locked.length) throw new NotFoundException('Pago no encontrado');
      const period = await tx.payrollObligation.findFirst({
        where: {
          id: dto.obligationId,
          organizationId,
          employeeId: dto.employeeId,
        },
        include: {
          installments: {
            include: {
              outflow: {
                include: { _count: { select: { installments: true } } },
              },
            },
          },
        },
      });
      if (
        !period ||
        period.kind !== PayrollObligationKind.FIXED_PERIOD ||
        period.status !== PayrollObligationStatus.PENDING ||
        !period.periodAmount
      )
        throw new ConflictException('Pago no disponible');

      // This foundation creates one fresh outflow per installment. Correction and
      // copied installment semantics must replace this calculation before wiring.
      const total = period.periodAmount.toFixed(2);
      const Decimal = Prisma.Decimal.clone({
        precision: Math.max(20, total.length + 3),
      });
      let paid = new Decimal(0);
      for (const installment of period.installments) {
        if (installment.outflow._count.installments !== 1)
          throw new ConflictException(
            'Abono compartido requiere protocolo de corrección',
          );
        paid = paid.plus(installment.outflow.amount.toFixed(2));
        if (paid.gte(total))
          throw new ConflictException('Saldo de pago inconsistente');
      }
      let result: ReturnType<typeof allocatePeriodInstallment>;
      try {
        result = allocatePeriodInstallment(
          { status: 'pending', total, paid: paid.toFixed(2) },
          dto.amount,
        );
      } catch {
        throw new ConflictException('Abono excede el saldo disponible');
      }
      const outflow = await tx.payrollCashOutflow.create({
        data: {
          organizationId,
          employeeId: dto.employeeId,
          actorId: actor.userId,
          amount: new Prisma.Decimal(dto.amount),
          date: new Date(`${dto.date}T00:00:00.000Z`),
          method: dto.method,
        },
      });
      const installment = await tx.payrollInstallment.create({
        data: {
          organizationId,
          employeeId: dto.employeeId,
          obligationId: dto.obligationId,
          outflowId: outflow.id,
        },
      });
      const status =
        result.status === 'completed'
          ? PayrollObligationStatus.COMPLETED
          : PayrollObligationStatus.PENDING;
      // S5/S8: when this installment completes the payment, its optional expense
      // is written in this same transaction, so a failure leaves no cash, no
      // status and no expense. The expense is written before the status it
      // belongs to, while this transaction still holds the obligation lock.
      if (result.status === 'completed')
        await this.writeCompletionExpense(
          tx,
          {
            organizationId,
            actor,
            employeeId: dto.employeeId,
            obligationId: dto.obligationId,
          },
          {
            total: result.total,
            outflows: [
              ...period.installments.map(({ outflow: previous }) => ({
                id: previous.id,
                amount: previous.amount.toFixed(2),
                date: previous.date.toISOString().slice(0, 10),
                method: previous.method,
              })),
              // The outflow inserted above is part of the completed cash; an
              // expense that omitted it could not equal the obligation total.
              {
                id: outflow.id,
                amount: new Prisma.Decimal(dto.amount).toFixed(2),
                date: dto.date,
                method: dto.method,
              },
            ],
            // A null choice is unspecified, never "no expense".
            expenseChoice: period.expenseEnabled ?? null,
            // S5: the default expense date is the day the payment completed.
            completionDate: dto.date,
            selectedExpenseDate: period.selectedExpenseDate
              ? period.selectedExpenseDate.toISOString().slice(0, 10)
              : null,
            // No separate correction facts are passed: a correction updates the
            // outflow amount in place and keeps its own revision history, so the
            // stored amounts above are already the effective cash.
          },
        );
      const updated = await tx.payrollObligation.updateMany({
        where: {
          id: dto.obligationId,
          organizationId,
          employeeId: dto.employeeId,
          status: PayrollObligationStatus.PENDING,
        },
        data: { status, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException('Pago modificado');
      return {
        installment,
        outflow,
        paid: result.paid,
        balance: result.balance,
        status,
      };
    });
    return transaction.catch(throwPayrollTransactionError);
  }

  /**
   * Writes the optional completion expense of a just-completed payment.
   *
   * `tx` is the transaction this service already opened and locks; nothing here
   * opens, retries or commits a transaction, so the expense shares the completion
   * fate and a failure rolls the whole completion back. The planner is consulted
   * first, only to learn whether an expense will be written at all: a disabled,
   * unspecified or still-pending payment neither resolves nor creates a category,
   * and an over-limit payment fails with the approved limit error before any
   * category or expense work.
   *
   * The category is resolved inside this transaction (it locks `Organization`
   * after the payroll locks). Mocks prove this ordering only; real PostgreSQL
   * locking and rollback stay unverified.
   */
  private async writeCompletionExpense(
    tx: Prisma.TransactionClient,
    scope: {
      organizationId: string;
      actor: RequestUser;
      employeeId: string;
      obligationId: string;
    },
    facts: PayrollObligationCompletionFacts,
  ): Promise<void> {
    let writesExpense: boolean;
    try {
      writesExpense =
        planPayrollObligationCompletion(facts).expense.kind === 'create';
    } catch {
      // Facts come from locked database rows, so this only happens when the
      // stored history is inconsistent; fail closed instead of writing money.
      throw new ConflictException('Saldo de pago inconsistente');
    }
    const category = writesExpense
      ? await resolvePayrollExpenseCategoryWithin(
          tx,
          scope.organizationId,
          scope.actor,
        )
      : undefined;
    await writePayrollCompletionExpense(tx, { ...scope, category, facts });
  }
}
