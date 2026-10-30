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
import { allocateShiftInstallment } from './payroll-allocation';
import { writePayrollCompletionExpense } from './payroll-completed-expense-writer';
import { resolvePayrollExpenseCategoryWithin } from './payroll-expense-category.service';
import type { PayrollObligationCompletionFacts } from './payroll-obligation-completion';
import { planPayrollObligationCompletion } from './payroll-obligation-completion';
import { CreatePayrollGroupInstallmentDto } from './dto/create-payroll-group-installment.dto';
import { validatePayrollGroupHistory } from './payroll-group-history';

@Injectable()
export class PayrollGroupInstallmentsService {
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
    const amount = (input as { amount?: unknown }).amount;
    if (
      typeof amount === 'string' &&
      (amount.length > 131075 || amount.split('.', 1)[0].length > 131072)
    )
      throw new BadRequestException('Datos de abono inválidos');
    const dto = plainToInstance(CreatePayrollGroupInstallmentDto, input);
    if (
      validateSync(dto, { whitelist: true, forbidNonWhitelisted: true })
        .length ||
      !new Prisma.Decimal(dto.amount).gt(0)
    )
      throw new BadRequestException('Datos de abono inválidos');

    return this.prisma.$transaction(async (tx) => {
      // Every current and future payroll writer must use employee -> sorted
      // obligations -> sorted shifts; inactive employees may receive payments.
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
      const before = await tx.payrollShiftMembership.findMany({
        where: {
          organizationId,
          employeeId: dto.employeeId,
          obligationId: dto.obligationId,
        },
        select: { id: true, shiftId: true },
      });
      const shiftIds = [...new Set(before.map((m) => m.shiftId))].sort((a, b) =>
        a.localeCompare(b),
      );
      if (!shiftIds.length || shiftIds.length !== before.length)
        throw new ConflictException('Grupo inconsistente');
      const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT "id" FROM "EmployeeShift"
        WHERE "organizationId" = ${organizationId} AND "employeeId" = ${dto.employeeId}
          AND "id" IN (${Prisma.join(shiftIds)}) ORDER BY "id" FOR UPDATE`);
      if (
        locked.length !== shiftIds.length ||
        locked.some((s, i) => s.id !== shiftIds[i])
      )
        throw new ConflictException('Turnos modificados');
      const group = await tx.payrollObligation.findFirst({
        where: {
          id: dto.obligationId,
          organizationId,
          employeeId: dto.employeeId,
        },
        include: {
          shiftMemberships: { include: { shift: true } },
          installments: {
            include: {
              outflow: {
                include: { _count: { select: { installments: true } } },
              },
              allocations: { include: { voids: true } },
            },
          },
        },
      });
      if (
        !group ||
        group.kind !== PayrollObligationKind.SHIFT_GROUP ||
        group.status !== PayrollObligationStatus.PENDING
      )
        throw new ConflictException('Pago no disponible');
      const allMemberships = await tx.payrollShiftMembership.findMany({
        where: {
          organizationId,
          employeeId: dto.employeeId,
          shiftId: { in: shiftIds },
        },
        select: {
          id: true,
          shiftId: true,
          obligationId: true,
          releasedAt: true,
          allocations: {
            take: 1,
            select: { id: true, voids: { take: 1, select: { id: true } } },
          },
        },
      });
      const allocations = validatePayrollGroupHistory({
        before,
        obligationId: dto.obligationId,
        memberships: group.shiftMemberships,
        allMemberships,
        installments: group.installments,
      });
      let result: ReturnType<typeof allocateShiftInstallment>;
      try {
        result = allocateShiftInstallment(
          {
            status: 'pending',
            shifts: group.shiftMemberships.map((m) => ({
              id: m.shiftId,
              date: m.shift.date.toISOString().slice(0, 10),
              amount: m.shift.amount.toFixed(2),
            })),
            allocations,
          },
          dto.amount,
        );
      } catch {
        throw new ConflictException('Saldo o historial de grupo inconsistente');
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
      const membershipByShift = new Map(
        group.shiftMemberships.map((m) => [m.shiftId, m.id]),
      );
      const created = await tx.payrollAllocation.createMany({
        data: result.newAllocations.map((a) => ({
          organizationId,
          employeeId: dto.employeeId,
          obligationId: dto.obligationId,
          installmentId: installment.id,
          membershipId: membershipByShift.get(a.shiftId)!,
          amount: new Prisma.Decimal(a.amount),
        })),
      });
      if (created.count !== result.newAllocations.length)
        throw new ConflictException('Aplicaciones incompletas');
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
            // The group total is the sum of the grouped shifts, reported by the
            // allocation of the locked snapshot.
            total: result.total,
            outflows: [
              ...group.installments.map(({ outflow: previous }) => ({
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
            expenseChoice: group.expenseEnabled ?? null,
            // S5: the default expense date is the day the payment completed.
            completionDate: dto.date,
            selectedExpenseDate: group.selectedExpenseDate
              ? group.selectedExpenseDate.toISOString().slice(0, 10)
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
          version: group.version,
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
  }

  /**
   * Writes the optional completion expense of a just-completed grouped payment.
   *
   * Same seam as the period path: `tx` is the transaction this service already
   * opened and locked, nothing here opens, retries or commits a transaction, so
   * the expense shares the completion fate and a failure rolls the whole
   * completion back. The planner runs first only to decide whether an expense
   * will be written: a disabled, unspecified or still-pending payment neither
   * resolves nor creates a category, and an over-limit payment fails with the
   * approved limit error before any category or expense work.
   *
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
      throw new ConflictException('Saldo o historial de grupo inconsistente');
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
