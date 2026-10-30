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
import { CorrectPayrollPeriodInstallmentDto } from './dto/correct-payroll-period-installment.dto';

// Unwired: completion/expense policy and real database verification are pending.
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

    return this.prisma.$transaction(async (tx) => {
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
      const paid = amounts.reduce(
        (sum, value) => sum.plus(value),
        new Decimal(0),
      );
      const nextPaid = paid
        .minus(current.outflow.amount.toFixed(2))
        .plus(dto.amount);
      if (paid.gte(total) || nextPaid.gte(total))
        throw new ConflictException('Corrección alcanza o excede el saldo');
      if (current.outflow.amount.eq(amount))
        throw new ConflictException('El importe no cambió');
      const updated = await tx.payrollObligation.updateMany({
        where: {
          ...where,
          kind: PayrollObligationKind.FIXED_PERIOD,
          status: PayrollObligationStatus.PENDING,
          version: period.version,
        },
        data: { version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException('Pago modificado');
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
      return {
        revision,
        paid: nextPaid.toFixed(2),
        balance: new Decimal(total).minus(nextPaid).toFixed(2),
        status: period.status,
      };
    });
  }
}
