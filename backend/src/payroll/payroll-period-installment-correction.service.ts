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
import { formatDateInBogota } from '../common/utils/bogota-date';
import { PrismaService } from '../prisma/prisma.service';
import { writePayrollCompletionExpense } from './payroll-completed-expense-writer';
import { resolvePayrollExpenseCategoryWithin } from './payroll-expense-category.service';
import type { PayrollObligationCompletionFacts } from './payroll-obligation-completion';
import { planPayrollObligationCompletion } from './payroll-obligation-completion';
import type { PayrollOutflowFact } from './payroll-obligation-completion';
import {
  payrollMoneyCents,
  payrollMoneyText,
  payrollObligationCashOutflowFacts,
  payrollObligationReferencedCashCents,
} from './payroll-obligations.service';
import { CorrectPayrollPeriodInstallmentDto } from './dto/correct-payroll-period-installment.dto';
import { throwPayrollTransactionError } from './payroll-transaction-error';

/**
 * Corrects the cash amount of a still-pending fixed-period installment in place
 * (S6), preserving append-only revision evidence and the original cash identity.
 *
 * A correction that reaches the exact outstanding total completes the payment and
 * applies the obligation's stored expense choice (S4, S5); a correction above it
 * is rejected. The completion seam is the same one the wired period-installments
 * path uses: the planner classifies completion and expense choice from the facts
 * of the corrected outflow set, the category is resolved in this transaction only
 * when an expense will be written, the writer runs before the obligation status
 * update, and an expense above Decimal(12,2) fails the whole completion with the
 * approved limit error.
 *
 * Real PostgreSQL locking, rollback and concurrency stay unverified: the mocked
 * tests here prove requested effects and ordering only.
 */
@Injectable()
export class PayrollPeriodInstallmentCorrectionService {
  constructor(private readonly prisma: PrismaService) {}

  async correct(
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
      throw new BadRequestException('Datos de corrección inválidos');
    const raw = (input as { amount?: unknown }).amount;
    if (
      typeof raw === 'string' &&
      (raw.length > 131075 || raw.split('.', 1)[0].length > 131072)
    )
      throw new BadRequestException('Datos de corrección inválidos');
    const dto = plainToInstance(CorrectPayrollPeriodInstallmentDto, input);
    if (
      validateSync(dto, { whitelist: true, forbidNonWhitelisted: true })
        .length ||
      !new Prisma.Decimal(dto.amount).gt(0)
    )
      throw new BadRequestException('Datos de corrección inválidos');
    const amount = new Prisma.Decimal(dto.amount);

    const transaction = this.prisma.$transaction(async (tx) => {
      // S5/S6: a correction introduces no new cash date, so the day this correction
      // is made is the completion day of the payment it may complete. It is read
      // once, in the Bogotá calendar, so every effect of one correction agrees.
      const correctionDay = formatDateInBogota(new Date());
      const employees = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Employee" WHERE "id" = ${dto.employeeId}
        AND "organizationId" = ${organizationId} FOR UPDATE`;
      if (!employees.length)
        throw new NotFoundException('Empleado no encontrado');
      const obligations = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "PayrollObligation" WHERE "id" = ${dto.obligationId}
        AND "organizationId" = ${organizationId} AND "employeeId" = ${dto.employeeId} FOR UPDATE`;
      if (!obligations.length)
        throw new NotFoundException('Pago no encontrado');
      const where = {
        id: dto.obligationId,
        organizationId,
        employeeId: dto.employeeId,
      };
      const include = {
        installments: {
          include: {
            _count: { select: { allocations: true } },
            outflow: {
              include: { _count: { select: { installments: true } } },
            },
          },
        },
        // Cash of the completed payment this one counts as already paid, so a
        // replacement's remaining installment can complete it (L327, L338).
        installmentReferences: {
          select: {
            amount: true,
            sourceInstallment: {
              select: {
                outflow: {
                  select: { id: true, amount: true, date: true, method: true },
                },
              },
            },
          },
        },
      } as const;
      const before = await tx.payrollObligation.findFirst({ where, include });
      const target = before?.installments.find(
        (item) => item.id === dto.installmentId,
      );
      if (!target) throw new NotFoundException('Abono no encontrado');
      const lockedCash = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "PayrollCashOutflow" WHERE "id" = ${target.outflowId}
        AND "organizationId" = ${organizationId} AND "employeeId" = ${dto.employeeId} FOR UPDATE`;
      if (!lockedCash.length)
        throw new ConflictException('Movimiento no disponible');
      // Re-read after all locks: the pre-lock lookup is only used to locate the cash row.
      const period = await tx.payrollObligation.findFirst({ where, include });
      if (
        !period ||
        period.kind !== PayrollObligationKind.FIXED_PERIOD ||
        period.status !== PayrollObligationStatus.PENDING ||
        !period.periodAmount
      )
        throw new ConflictException('Pago no disponible');
      const current = period.installments.find(
        (item) => item.id === dto.installmentId,
      );
      if (!current || current.outflowId !== target.outflowId)
        throw new ConflictException('Abono modificado');
      const validMoney = (value: Prisma.Decimal) =>
        value.isFinite() && value.gt(0) && value.decimalPlaces() <= 2;
      if (!validMoney(period.periodAmount))
        throw new ConflictException('Saldo inconsistente');
      const ids = new Set<string>();
      const amounts: string[] = [];
      let nextSequence = 1;
      for (const item of period.installments) {
        if (
          item.organizationId !== organizationId ||
          item.employeeId !== dto.employeeId ||
          item.obligationId !== dto.obligationId ||
          item.outflow.id !== item.outflowId ||
          item.outflow.organizationId !== organizationId ||
          item.outflow.employeeId !== dto.employeeId ||
          item._count.allocations !== 0 ||
          item.outflow._count.installments !== 1 ||
          ids.has(item.outflowId) ||
          !validMoney(item.outflow.amount)
        )
          throw new ConflictException('Historial de abonos inconsistente');
        ids.add(item.outflowId);
        const revisions = await tx.payrollCashRevision.findMany({
          where: {
            organizationId,
            employeeId: dto.employeeId,
            obligationId: dto.obligationId,
            installmentId: item.id,
            outflowId: item.outflowId,
          },
          orderBy: { sequence: 'asc' },
        });
        let previous: Prisma.Decimal | undefined;
        let expectedSequence = 1;
        for (const revision of revisions) {
          if (
            !validMoney(revision.oldAmount) ||
            !validMoney(revision.newAmount) ||
            revision.sequence !== expectedSequence ||
            (previous && !previous.eq(revision.oldAmount)) ||
            revision.originalDate.getTime() !== item.outflow.date.getTime() ||
            revision.originalMethod !== item.outflow.method
          )
            throw new ConflictException(
              'Historial de correcciones inconsistente',
            );
          previous = revision.newAmount;
          expectedSequence += 1;
        }
        if (previous && !previous.eq(item.outflow.amount))
          throw new ConflictException(
            'Historial de correcciones inconsistente',
          );
        if (item.id === current.id) {
          if (expectedSequence > 2147483647)
            throw new ConflictException('Secuencia de correcciones agotada');
          nextSequence = expectedSequence;
        }
        amounts.push(item.outflow.amount.toFixed(2));
      }
      const total = period.periodAmount.toFixed(2);
      const Decimal = Prisma.Decimal.clone({
        precision:
          Math.max(
            20,
            total.length,
            dto.amount.length,
            ...amounts.map((v) => v.length),
          ) +
          String(amounts.length + 1).length +
          2,
      });
      const ownPaid = amounts.reduce(
        (sum, value) => sum.plus(value),
        new Decimal(0),
      );
      // Referenced installments of a completed payment are already paid cash, so a
      // replacement's remaining installment can complete it (L327/L338). They are
      // counted here with the same fail-closed rules as the read routes: a
      // snapshot that disagrees with the live source cash, or a repeated outflow,
      // is refused instead of being summed, and no new outflow is created for them.
      let referencedCents: bigint;
      let cashFacts: PayrollOutflowFact[];
      const referenceFacts = {
        installments: period.installments,
        references: period.installmentReferences,
      };
      try {
        referencedCents = payrollObligationReferencedCashCents(referenceFacts);
        cashFacts = payrollObligationCashOutflowFacts(referenceFacts);
      } catch {
        throw new ConflictException('Historial de referencias inconsistente');
      }
      let paidCents: bigint;
      let totalCents: bigint;
      let nextPaidCents: bigint;
      try {
        paidCents = payrollMoneyCents(ownPaid) + referencedCents;
        totalCents = payrollMoneyCents(total);
        nextPaidCents =
          paidCents -
          payrollMoneyCents(current.outflow.amount) +
          payrollMoneyCents(amount);
      } catch {
        throw new ConflictException('Saldo de pago inconsistente');
      }
      const nextPaid = new Prisma.Decimal(payrollMoneyText(nextPaidCents));
      // Stored history must be a consistent partial payment: it is locked as
      // PENDING, so a paid amount already at the total is a corrupt history.
      if (paidCents >= totalCents)
        throw new ConflictException('Saldo de pago inconsistente');
      // Only an amount that would EXCEED the total is rejected; reaching it
      // exactly is an approved completion (S4).
      if (nextPaidCents > totalCents)
        throw new ConflictException('Corrección excede el saldo disponible');
      if (current.outflow.amount.eq(amount))
        throw new ConflictException('El importe no cambió');
      const completes = nextPaidCents === totalCents;
      // S4/S5: when the corrected amount completes the payment, the stored expense
      // choice is applied inside this transaction, before this transaction writes
      // the obligation status. The planner owns completion, choice and the approved
      // over-limit rule, so an over-limit completion fails here with no cash,
      // revision, status or expense write requested at all.
      if (completes)
        await this.writeCompletionExpense(
          tx,
          {
            organizationId,
            actor,
            employeeId: dto.employeeId,
            obligationId: dto.obligationId,
          },
          {
            total,
            // Facts describe the post-correction state: the corrected outflow is
            // reported with its new amount and keeps its own date and method, and
            // referenced cash keeps the original date and method of the source
            // outflow it already belongs to.
            outflows: cashFacts.map((fact) =>
              fact.id === current.outflowId
                ? { ...fact, amount: amount.toFixed(2) }
                : fact,
            ),
            // A null choice is unspecified, never "no expense".
            expenseChoice: period.expenseEnabled ?? null,
            // A correction introduces no new cash date: the corrected outflow is
            // updated in place and keeps its date (S3/S6), so its stored date
            // cannot be the completion day. The completion day is the Bogotá day
            // the correction is made, expressed the way the expense writer parses
            // dates, so the expense inherits it when no date was selected. An
            // explicit stored selection still wins.
            completionDate: correctionDay,
            selectedExpenseDate: period.selectedExpenseDate
              ? period.selectedExpenseDate.toISOString().slice(0, 10)
              : null,
            // No separate correction facts are needed: the outflow amount is
            // revised in place, so the amounts above are the effective cash.
          },
        );
      const cash = await tx.payrollCashOutflow.updateMany({
        where: {
          id: current.outflowId,
          organizationId,
          employeeId: dto.employeeId,
          amount: current.outflow.amount,
          date: current.outflow.date,
          method: current.outflow.method,
        },
        data: { amount },
      });
      if (cash.count !== 1)
        throw new ConflictException('Movimiento modificado');
      const revision = await tx.payrollCashRevision.create({
        data: {
          organizationId,
          employeeId: dto.employeeId,
          obligationId: dto.obligationId,
          installmentId: current.id,
          outflowId: current.outflowId,
          actorId: actor.userId,
          sequence: nextSequence,
          oldAmount: current.outflow.amount,
          newAmount: amount,
          originalDate: current.outflow.date,
          originalMethod: current.outflow.method,
        },
      });
      const status = completes
        ? PayrollObligationStatus.COMPLETED
        : period.status;
      // The status transition is the last effect, so the expense it belongs to is
      // already written when it happens.
      const updated = await tx.payrollObligation.updateMany({
        where: {
          ...where,
          kind: PayrollObligationKind.FIXED_PERIOD,
          status: PayrollObligationStatus.PENDING,
          version: period.version,
        },
        data: { status, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException('Pago modificado');
      return {
        revision,
        paid: nextPaid.toFixed(2),
        balance: payrollMoneyText(totalCents - nextPaidCents),
        status,
      };
    });
    return transaction.catch(throwPayrollTransactionError);
  }

  /**
   * Writes the optional completion expense of a payment this correction completes.
   *
   * This mirrors the wired `PayrollPeriodInstallmentsService` seam: the same
   * transaction client is reused, the planner decides first, the category is
   * resolved in this transaction only when an expense will be written, and the
   * writer writes the expense, its payment mirrors, its audit row and the
   * obligation/expense link. A disabled or unspecified choice neither resolves nor
   * creates a category, and an over-limit completion fails with the approved limit
   * error before any category or expense work.
   *
   * The category resolution locks `Organization` after the payroll locks, so the
   * lock order stays employee → obligation → cash → organization → taxonomy/expense.
   * Mocks prove this ordering only; real PostgreSQL locking and rollback stay
   * unverified.
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
