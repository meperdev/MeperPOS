import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PayrollObligationStatus, Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePayrollCashReturnDto } from './dto/create-payroll-cash-return.dto';
import { throwPayrollTransactionError } from './payroll-transaction-error';

/**
 * Records that an employee actually gave back cash the business had already paid
 * (S7/S8): one complete installment per return, on the day the money came back and
 * by the real method it came back (L325, L329, L330).
 *
 * This is append-only evidence, not a correction. A mistaken entry is revised in
 * place through the CashRevision protocol instead. So this transaction writes
 * exactly one `PayrollCashReturn` row and leaves the payment, its cash outflow, its
 * allocations, its linked expense and its status untouched (L326): the return is
 * added to cash flow in its own right, never by rewriting the original outflow.
 *
 * The returned amount is never an input. One return covers a whole installment, so
 * the amount is read from the locked outflow; a client cannot state a partial or
 * inflated figure. Because the same real outflow can back copied installments of
 * different payments (L327 "referenciarlos sin cobrar de nuevo"), the guard is the
 * cumulative total of returns stored against that outflow, not the installment's
 * single storage key: the money can only come back once.
 *
 * Unwired on purpose: no route, no report and no schema change belong to this unit.
 * Cash reports still need to net returns against payroll outflows (L324), and real
 * PostgreSQL locking, rollback and race behavior are proven by mocks only here.
 */
@Injectable()
export class PayrollCashReturnService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    input: unknown,
    organizationId: string | undefined,
    actor: RequestUser | undefined,
  ) {
    // S5/S7: only the owner or an admin of this tenant may move payroll money, and
    // the actor must be a member of the same tenant that owns the records.
    if (
      !organizationId ||
      !actor?.userId ||
      actor.organizationId !== organizationId ||
      !['OWNER', 'ADMIN'].includes(actor.role)
    )
      throw new ForbiddenException('No tiene permiso para gestionar nómina');
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new BadRequestException('Datos de devolución inválidos');
    const dto = plainToInstance(CreatePayrollCashReturnDto, input);
    // `amount`, `date` and `method` are not whitelisted: the amount is owned by the
    // server and the outflow is immutable, so a caller that sends them is refused
    // instead of being silently reinterpreted.
    if (
      validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length
    )
      throw new BadRequestException('Datos de devolución inválidos');

    const transaction = this.prisma.$transaction(async (tx) => {
      // Payroll lock order: employee -> obligation -> cash outflow. Inactive
      // employees keep their history, so a returned payment is still reachable.
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

      // Only used to find the cash row that has to be locked; nothing read here is
      // trusted after the locks are taken.
      const located = await tx.payrollInstallment.findFirst({
        where: {
          id: dto.installmentId,
          organizationId,
          employeeId: dto.employeeId,
          obligationId: dto.obligationId,
        },
        select: { id: true, outflowId: true },
      });
      if (!located) throw new NotFoundException('Abono no encontrado');

      // The outflow row is the shared resource: copied installments of other
      // payments may reference this same real cash, so returns of that cash are
      // serialized here before the cumulative check below reads them.
      const lockedCash = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "PayrollCashOutflow" WHERE "id" = ${located.outflowId}
        AND "organizationId" = ${organizationId} AND "employeeId" = ${dto.employeeId} FOR UPDATE`;
      if (!lockedCash.length)
        throw new ConflictException('Movimiento no disponible');

      // Re-read under the locks: the installment, the cash it points at and the
      // payment that owns it must still be the same, consistently scoped facts.
      const current = await tx.payrollInstallment.findFirst({
        where: {
          id: dto.installmentId,
          organizationId,
          employeeId: dto.employeeId,
          obligationId: dto.obligationId,
        },
        include: {
          outflow: true,
          obligation: {
            select: {
              id: true,
              organizationId: true,
              employeeId: true,
              status: true,
            },
          },
        },
      });
      if (!current || current.outflowId !== located.outflowId)
        throw new ConflictException('Abono modificado');
      if (
        current.organizationId !== organizationId ||
        current.employeeId !== dto.employeeId ||
        current.obligationId !== dto.obligationId ||
        current.obligation.id !== dto.obligationId ||
        current.obligation.organizationId !== organizationId ||
        current.obligation.employeeId !== dto.employeeId ||
        current.outflow.id !== current.outflowId ||
        current.outflow.organizationId !== organizationId ||
        current.outflow.employeeId !== dto.employeeId
      )
        throw new ConflictException('Historial del abono inconsistente');
      // Only a completed payment returns money: its installments are the cash the
      // employee actually holds. A pending payment keeps the ordinary correction
      // path, which never was a reimbursement. The approved unit of a return is the
      // installment (L329), so no payment kind is restricted here.
      if (current.obligation.status !== PayrollObligationStatus.COMPLETED)
        throw new ConflictException('Pago no disponible');
      const outflowAmount = current.outflow.amount;
      if (
        !outflowAmount ||
        !outflowAmount.isFinite() ||
        !outflowAmount.gt(0) ||
        outflowAmount.decimalPlaces() > 2
      )
        throw new ConflictException('Movimiento inconsistente');

      const previousReturns = await tx.payrollCashReturn.findMany({
        where: {
          organizationId,
          employeeId: dto.employeeId,
          outflowId: current.outflowId,
        },
      });
      const returnedAmounts: string[] = [];
      for (const previous of previousReturns) {
        if (
          !previous.amount ||
          !previous.amount.isFinite() ||
          !previous.amount.gt(0) ||
          previous.amount.decimalPlaces() > 2
        )
          throw new ConflictException(
            'Historial de devoluciones inconsistente',
          );
        returnedAmounts.push(previous.amount.toFixed(2));
      }
      // Bound the arithmetic to the stored digit count so the cumulative check is
      // exact instead of silently rounded by the default Decimal precision.
      const Decimal = Prisma.Decimal.clone({
        precision:
          Math.max(
            20,
            outflowAmount.toFixed(2).length,
            ...returnedAmounts.map((value) => value.length),
          ) +
          String(returnedAmounts.length + 1).length +
          2,
      });
      const alreadyReturned = returnedAmounts.reduce(
        (sum, value) => sum.plus(value),
        new Decimal(0),
      );
      // L329: this return is the whole outflow, so any earlier return of the same
      // cash - including one recorded through a copied installment - already
      // consumed it. This also refuses a replayed request instead of reporting a
      // second return as success.
      if (alreadyReturned.plus(outflowAmount.toFixed(2)).gt(outflowAmount))
        throw new ConflictException('El abono ya fue devuelto');

      const cashReturn = await tx.payrollCashReturn.create({
        data: {
          organizationId,
          employeeId: dto.employeeId,
          obligationId: dto.obligationId,
          installmentId: current.id,
          outflowId: current.outflowId,
          actorId: actor.userId,
          // The server owns the amount: the full value of the locked outflow, kept
          // as its own snapshot so later evidence cannot rewrite it.
          amount: outflowAmount,
          originalAmount: outflowAmount,
          originalDate: current.outflow.date,
          originalMethod: current.outflow.method,
          // L325/L330: the actual day the money came back and the real method the
          // actor received it by, never the original payment facts.
          returnMethod: dto.returnMethod,
          returnDate: new Date(`${dto.returnDate}T00:00:00.000Z`),
        },
      });
      // No other write: the payment, its outflow, its allocations, its expense and
      // its status stay exactly as they were (L326).
      return { cashReturn };
    });
    return transaction.catch(throwPayrollTransactionError);
  }
}
