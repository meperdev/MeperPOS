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
import { CreatePayrollPeriodInstallmentDto } from './dto/create-payroll-period-installment.dto';

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

    return this.prisma.$transaction(async (tx) => {
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
  }
}
