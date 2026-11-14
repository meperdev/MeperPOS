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
import type { Allocation } from './payroll-allocation';
import { planGroupCorrection } from './payroll-group-correction-plan';
import { validatePayrollGroupHistory } from './payroll-group-history';
import type { PayrollObligationCompletionFacts } from './payroll-obligation-completion';
import { planPayrollObligationCompletion } from './payroll-obligation-completion';
import { CorrectPayrollGroupInstallmentDto } from './dto/correct-payroll-group-installment.dto';
import { throwPayrollTransactionError } from './payroll-transaction-error';

type ObligationScope = {
  id: string;
  organizationId: string;
  employeeId: string;
};

// Effective application of one installment: the row that is not superseded and
// the shift it pays. Voided rows stay in history but never appear here.
type EffectiveApplication = {
  allocationId: string;
  membershipId: string;
  shiftId: string;
  amount: string;
};

/**
 * Corrects the cash amount of one still-pending grouped installment in place
 * (S3, S6, L323 "Recalcular desde el abono corregido", L332 registration order).
 *
 * A grouped payment can record the wrong amount. The recorded cash was never
 * delivered, so the amount is revised in place on the same cash row: the date and
 * method stay untouched, the superseded applications are voided instead of
 * edited, the corrected installment and every installment registered after it are
 * reallocated by the pure planner, and a PayrollCashRevision documents the
 * revision. Nothing about the cash identity is invented: no new outflow, no new
 * installment, no deleted evidence.
 *
 * Ordering is the established payroll one — employee, then obligation, then the
 * member shifts sorted by id, then the revised cash row — and every fact used for
 * money is re-read after those locks. Installation order inside the obligation
 * comes from the persisted registration `sequence` (L332/L333): a legacy
 * installment with a null or duplicated sequence fails closed, because an
 * unprovable order could reallocate other people's cash.
 *
 * Real PostgreSQL locking, rollback and concurrency stay unverified: the mocked
 * tests here prove requested effects, requested order and fail-closed rejections
 * only.
 */
@Injectable()
export class PayrollGroupInstallmentCorrectionService {
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
    const dto = plainToInstance(CorrectPayrollGroupInstallmentDto, input);
    if (
      validateSync(dto, { whitelist: true, forbidNonWhitelisted: true })
        .length ||
      !new Prisma.Decimal(dto.amount).gt(0)
    )
      throw new BadRequestException('Datos de corrección inválidos');
    const amount = new Prisma.Decimal(dto.amount);
    const scope: ObligationScope = {
      id: dto.obligationId,
      organizationId,
      employeeId: dto.employeeId,
    };

    const transaction = this.prisma.$transaction(async (tx) => {
      // S5: a correction introduces no new cash date, so the day this correction is
      // made is the completion day of a payment it may complete. It is read once, in
      // the Bogotá calendar, so every effect of one correction agrees.
      const correctionDay = formatDateInBogota(new Date());
      await this.lockEmployee(tx, organizationId, dto.employeeId);
      await this.lockObligation(tx, scope);
      const { memberShifts, before } = await this.lockMemberShifts(
        tx,
        scope,
        dto.employeeId,
      );

      // Locate the cash row of the installment before locking it: installments
      // reference their outflow, so this read is only a lookup, never a fact used
      // for money.
      const located = await this.readObligation(tx, scope);
      const locatedTarget = located?.installments.find(
        (item) => item.id === dto.installmentId,
      );
      if (!locatedTarget) throw new NotFoundException('Abono no encontrado');
      await this.lockCashRow(
        tx,
        scope,
        dto.employeeId,
        locatedTarget.outflowId,
      );

      // Post-lock re-read: every fact below is read while this transaction holds
      // the employee, obligation, shift and cash locks.
      const group = await this.readObligation(tx, scope);
      const current = group?.installments.find(
        (item) => item.id === dto.installmentId,
      );
      if (!current || current.outflowId !== locatedTarget.outflowId)
        throw new ConflictException('Abono modificado');
      if (
        !group ||
        group.id !== scope.id ||
        group.organizationId !== organizationId ||
        group.employeeId !== dto.employeeId ||
        group.kind !== PayrollObligationKind.SHIFT_GROUP ||
        group.status !== PayrollObligationStatus.PENDING
      )
        throw new ConflictException('Pago no disponible');

      const allMemberships = await tx.payrollShiftMembership.findMany({
        where: {
          organizationId,
          employeeId: dto.employeeId,
          shiftId: { in: memberShifts },
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
      // Rejects shared or inconsistent cash, applications of foreign or released
      // memberships, repeated voids and any per-installment cash that does not
      // equal its effective applications. `before` is the pre-lock membership
      // snapshot, so a membership that changed while this transaction waited is
      // reported instead of being silently merged.
      validatePayrollGroupHistory({
        before,
        obligationId: scope.id,
        memberships: group.shiftMemberships,
        allMemberships,
        installments: group.installments,
      });

      const installments = this.registrationOrderedInstallments(group, scope);
      const shiftByMembership = new Map(
        group.shiftMemberships.map((membership) => [
          membership.id,
          membership.shiftId,
        ]),
      );
      const membershipByShift = new Map(
        group.shiftMemberships.map((membership) => [
          membership.shiftId,
          membership.id,
        ]),
      );
      const effective = new Map<string, EffectiveApplication[]>();
      for (const installment of installments)
        effective.set(
          installment.id,
          this.effectiveApplications(installment, shiftByMembership),
        );

      if (current.outflow.amount.eq(amount))
        throw new ConflictException('El importe no cambió');
      const nextSequence = await this.nextRevisionSequence(
        tx,
        scope,
        dto.employeeId,
        { id: current.id, outflowId: current.outflowId },
        current.outflow,
      );

      let plan: ReturnType<typeof planGroupCorrection>;
      try {
        plan = planGroupCorrection({
          status: 'pending',
          shifts: group.shiftMemberships.map((membership) => ({
            id: membership.shiftId,
            date: membership.shift.date.toISOString().slice(0, 10),
            amount: membership.shift.amount.toFixed(2),
          })),
          installments: installments.map((installment) => ({
            id: installment.id,
            sequence: installment.sequence,
            date: installment.outflow.date.toISOString().slice(0, 10),
            createdAt: installment.createdAt,
            amount: installment.outflow.amount.toFixed(2),
            allocations: effective.get(installment.id)!.map((application) => ({
              shiftId: application.shiftId,
              amount: application.amount,
            })),
          })),
          correctedInstallmentId: dto.installmentId,
          correctedAmount: dto.amount,
        });
      } catch {
        throw new ConflictException('Saldo o historial de grupo inconsistente');
      }

      // S4/S5: when the corrected amount completes the payment, the stored expense
      // choice is applied inside this transaction before any money write, so an
      // over-limit or inconsistent completion fails with nothing to roll back.
      if (plan.status === 'completed')
        await this.writeCompletionExpense(
          tx,
          { ...scope, actor },
          {
            total: plan.total,
            // Facts describe the post-correction cash: the corrected outflow keeps
            // its identity, date and method, and reports its new amount.
            outflows: installments.map((installment) => ({
              id: installment.outflowId,
              amount:
                installment.id === current.id
                  ? amount.toFixed(2)
                  : installment.outflow.amount.toFixed(2),
              date: installment.outflow.date.toISOString().slice(0, 10),
              method: installment.outflow.method,
            })),
            // A null choice is unspecified, never "no expense".
            expenseChoice: group.expenseEnabled ?? null,
            // A correction introduces no new cash date, so the outflow date cannot
            // be the completion day; the Bogotá correction day is used instead
            // unless the payment stored an explicit selection.
            completionDate: correctionDay,
            selectedExpenseDate: group.selectedExpenseDate
              ? group.selectedExpenseDate.toISOString().slice(0, 10)
              : null,
          },
        );

      // Only the installments whose applications actually change are rewritten:
      // an application that still pays the same shift the same amount was never
      // superseded, so it must not gain void evidence.
      const superseded: { allocationId: string }[] = [];
      const replacements: {
        installmentId: string;
        membershipId: string;
        amount: Prisma.Decimal;
      }[] = [];
      for (const replacement of plan.replacements) {
        const previous = effective.get(replacement.installmentId)!;
        if (sameApplications(previous, replacement.allocations)) continue;
        for (const application of previous)
          superseded.push({ allocationId: application.allocationId });
        for (const allocation of replacement.allocations)
          replacements.push({
            installmentId: replacement.installmentId,
            membershipId: membershipByShift.get(allocation.shiftId)!,
            amount: new Prisma.Decimal(allocation.amount),
          });
      }
      if (!superseded.length)
        throw new ConflictException('Saldo o historial de grupo inconsistente');
      const voided = await tx.payrollAllocationVoid.createMany({
        data: superseded.map(({ allocationId }) => ({
          allocationId,
          obligationId: scope.id,
          organizationId,
          employeeId: dto.employeeId,
        })),
      });
      if (voided.count !== superseded.length)
        throw new ConflictException('Aplicaciones incompletas');
      const created = await tx.payrollAllocation.createMany({
        data: replacements.map((replacement) => ({
          organizationId,
          employeeId: dto.employeeId,
          obligationId: scope.id,
          installmentId: replacement.installmentId,
          membershipId: replacement.membershipId,
          amount: replacement.amount,
        })),
      });
      if (created.count !== replacements.length)
        throw new ConflictException('Aplicaciones incompletas');

      // S6: the corrected cash amount replaces the recorded one on the same row,
      // guarded by a compare-and-swap on the facts the locks established.
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
      await tx.payrollCashRevision.create({
        data: {
          organizationId,
          employeeId: dto.employeeId,
          obligationId: scope.id,
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

      const status =
        plan.status === 'completed'
          ? PayrollObligationStatus.COMPLETED
          : PayrollObligationStatus.PENDING;
      // The status transition is the last effect, so the applications, the cash
      // amount and the expense it belongs to are already written when it happens.
      const updated = await tx.payrollObligation.updateMany({
        where: {
          ...scope,
          kind: PayrollObligationKind.SHIFT_GROUP,
          status: PayrollObligationStatus.PENDING,
          version: group.version,
        },
        data: { status, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException('Pago modificado');
      return {
        installmentId: current.id,
        paid: plan.paid,
        balance: plan.balance,
        status,
      };
    });
    return transaction.catch(throwPayrollTransactionError);
  }

  // Employee first: deactivation and every payroll writer take this same row
  // before anything else, so cooperating writers serialise here.
  private async lockEmployee(
    tx: Prisma.TransactionClient,
    organizationId: string,
    employeeId: string,
  ): Promise<void> {
    const employees = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Employee" WHERE "id" = ${employeeId}
      AND "organizationId" = ${organizationId} FOR UPDATE`;
    if (!employees.length)
      throw new NotFoundException('Empleado no encontrado');
  }

  // Second: the obligation row owns the payment status and version.
  private async lockObligation(
    tx: Prisma.TransactionClient,
    scope: ObligationScope,
  ): Promise<void> {
    const obligations = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "PayrollObligation" WHERE "id" = ${scope.id}
      AND "organizationId" = ${scope.organizationId}
      AND "employeeId" = ${scope.employeeId} FOR UPDATE`;
    if (!obligations.length) throw new NotFoundException('Pago no encontrado');
  }

  // Third: member shifts, always in sorted id order so two corrections of the same
  // employee cannot deadlock on the same set taken in different orders.
  private async lockMemberShifts(
    tx: Prisma.TransactionClient,
    scope: ObligationScope,
    employeeId: string,
  ): Promise<{
    memberShifts: string[];
    before: { id: string; shiftId: string }[];
  }> {
    const before = await this.preLockMemberships(tx, scope, employeeId);
    const shiftIds = [...new Set(before.map((m) => m.shiftId))].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    if (!shiftIds.length || shiftIds.length !== before.length)
      throw new ConflictException('Grupo inconsistente');
    const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id" FROM "EmployeeShift"
      WHERE "organizationId" = ${scope.organizationId}
        AND "employeeId" = ${employeeId}
        AND "id" IN (${Prisma.join(shiftIds)}) ORDER BY "id" FOR UPDATE`);
    const lockedIds = new Set(locked.map((shift) => shift.id));
    if (
      locked.length !== shiftIds.length ||
      lockedIds.size !== shiftIds.length ||
      shiftIds.some((id) => !lockedIds.has(id))
    )
      throw new ConflictException('Turnos modificados');
    return { memberShifts: shiftIds, before };
  }

  // Fourth: the revised cash row. Taken after the payroll locks so the order stays
  // employee -> obligation -> shifts -> cash, the same order the other payroll
  // correction writer uses.
  private async lockCashRow(
    tx: Prisma.TransactionClient,
    scope: ObligationScope,
    employeeId: string,
    outflowId: string,
  ): Promise<void> {
    const cash = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "PayrollCashOutflow" WHERE "id" = ${outflowId}
      AND "organizationId" = ${scope.organizationId}
      AND "employeeId" = ${employeeId} FOR UPDATE`;
    if (!cash.length) throw new ConflictException('Movimiento no disponible');
  }

  private async preLockMemberships(
    tx: Prisma.TransactionClient,
    scope: ObligationScope,
    employeeId: string,
  ): Promise<{ id: string; shiftId: string }[]> {
    return tx.payrollShiftMembership.findMany({
      where: {
        organizationId: scope.organizationId,
        employeeId,
        obligationId: scope.id,
      },
      select: { id: true, shiftId: true },
    });
  }

  // The whole payment: memberships with their shift facts, and installments with
  // their cash row, effective applications and void evidence.
  private readObligation(tx: Prisma.TransactionClient, scope: ObligationScope) {
    return tx.payrollObligation.findFirst({
      where: scope,
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
  }

  // Registration order is persisted, never inferred (L332/L333). A legacy
  // installment without a sequence, or a duplicated one, makes the order
  // unprovable and the correction fails closed before planning.
  private registrationOrderedInstallments<
    T extends {
      id: string;
      sequence: number | null;
      organizationId: string;
      employeeId: string;
      obligationId: string;
    },
  >(group: { installments: T[] }, scope: ObligationScope): T[] {
    const seen = new Set<number>();
    for (const installment of group.installments) {
      if (
        installment.organizationId !== scope.organizationId ||
        installment.employeeId !== scope.employeeId ||
        installment.obligationId !== scope.id ||
        installment.sequence === null ||
        !Number.isSafeInteger(installment.sequence) ||
        installment.sequence < 1 ||
        seen.has(installment.sequence)
      )
        throw new ConflictException(
          'Orden de registro de abonos no verificable',
        );
      seen.add(installment.sequence);
    }
    return [...group.installments].sort(
      (a, b) => (a.sequence as number) - (b.sequence as number),
    );
  }

  // Effective applications only: a voided row is superseded evidence, so it never
  // pays a shift nor gets voided again.
  private effectiveApplications(
    installment: {
      allocations: {
        id: string;
        membershipId: string;
        amount: Prisma.Decimal;
        voids: unknown[];
      }[];
    },
    shiftByMembership: Map<string, string>,
  ): EffectiveApplication[] {
    return installment.allocations
      .filter((allocation) => allocation.voids.length === 0)
      .map((allocation) => ({
        allocationId: allocation.id,
        membershipId: allocation.membershipId,
        shiftId: shiftByMembership.get(allocation.membershipId)!,
        amount: allocation.amount.toFixed(2),
      }));
  }

  // Next revision order of the corrected cash row. The stored chain must be
  // continuous and end at the current amount, otherwise the evidence cannot say
  // what the previous correction recorded and the correction fails closed.
  private async nextRevisionSequence(
    tx: Prisma.TransactionClient,
    scope: ObligationScope,
    employeeId: string,
    installment: { id: string; outflowId: string },
    outflow: { amount: Prisma.Decimal; date: Date; method: string },
  ): Promise<number> {
    const revisions = await tx.payrollCashRevision.findMany({
      where: {
        organizationId: scope.organizationId,
        employeeId,
        obligationId: scope.id,
        installmentId: installment.id,
        outflowId: installment.outflowId,
      },
      orderBy: { sequence: 'asc' },
    });
    const money = (value: Prisma.Decimal) =>
      value.isFinite() && value.gt(0) && value.decimalPlaces() <= 2;
    let previous: Prisma.Decimal | undefined;
    let expected = 1;
    for (const revision of revisions) {
      if (
        !money(revision.oldAmount) ||
        !money(revision.newAmount) ||
        revision.sequence !== expected ||
        (previous && !previous.eq(revision.oldAmount)) ||
        revision.originalDate.getTime() !== outflow.date.getTime() ||
        revision.originalMethod !== outflow.method
      )
        throw new ConflictException('Historial de correcciones inconsistente');
      previous = revision.newAmount;
      expected += 1;
    }
    if (previous && !previous.eq(outflow.amount))
      throw new ConflictException('Historial de correcciones inconsistente');
    if (expected > 2147483647)
      throw new ConflictException('Secuencia de correcciones agotada');
    return expected;
  }

  /**
   * Writes the optional completion expense of a payment this correction completes.
   *
   * Same seam as the wired installment writers: the planner decides first, the
   * category is resolved in this transaction only when an expense will be written,
   * and the writer writes the expense, its payment mirrors, its audit row and the
   * obligation/expense link. A disabled or unspecified choice neither resolves nor
   * creates a category, and an over-limit completion fails with the approved limit
   * error before any category, money or expense work.
   *
   * The category resolution locks `Organization` after the payroll locks, so the
   * lock order stays employee → obligation → shifts → cash → organization →
   * taxonomy/expense, the same order the period correction uses. Mocks prove this
   * ordering only; real PostgreSQL locking and rollback stay unverified.
   */
  private async writeCompletionExpense(
    tx: Prisma.TransactionClient,
    scope: ObligationScope & { actor: RequestUser },
    facts: PayrollObligationCompletionFacts,
  ): Promise<void> {
    let writesExpense: boolean;
    try {
      writesExpense =
        planPayrollObligationCompletion(facts).expense.kind === 'create';
    } catch {
      // Facts come from locked database rows, so this only happens when the stored
      // history is inconsistent; fail closed instead of writing money.
      throw new ConflictException('Saldo o historial de grupo inconsistente');
    }
    const category = writesExpense
      ? await resolvePayrollExpenseCategoryWithin(
          tx,
          scope.organizationId,
          scope.actor,
        )
      : undefined;
    await writePayrollCompletionExpense(tx, {
      organizationId: scope.organizationId,
      actor: scope.actor,
      employeeId: scope.employeeId,
      obligationId: scope.id,
      category,
      facts,
    });
  }
}

// Two application sets are the same when they pay the same shifts the same
// amounts; order is not part of the meaning of an effective allocation.
function sameApplications(
  previous: EffectiveApplication[],
  planned: Allocation[],
): boolean {
  if (previous.length !== planned.length) return false;
  const byShift = new Map(
    previous.map((application) => [application.shiftId, application.amount]),
  );
  if (byShift.size !== planned.length) return false;
  return planned.every(
    (allocation) => byShift.get(allocation.shiftId) === allocation.amount,
  );
}
