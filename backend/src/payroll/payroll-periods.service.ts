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
import { CreatePayrollPeriodDto } from './dto/create-payroll-period.dto';

@Injectable()
export class PayrollPeriodsService {
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
      throw new BadRequestException('Datos de período inválidos');
    // PostgreSQL NUMERIC supports at most 131072 digits before the decimal.
    // Reject oversized input before validation or Decimal construction.
    const rawAmount = (input as { periodAmount?: unknown }).periodAmount;
    if (
      typeof rawAmount === 'string' &&
      (rawAmount.length > 131075 || rawAmount.split('.', 1)[0].length > 131072)
    )
      throw new BadRequestException('Datos de período inválidos');
    const dto = plainToInstance(CreatePayrollPeriodDto, input);
    if (
      validateSync(dto, { whitelist: true, forbidNonWhitelisted: true })
        .length ||
      dto.periodStart > dto.periodEnd
    )
      throw new BadRequestException('Datos de período inválidos');
    const amount = new Prisma.Decimal(dto.periodAmount);
    if (!amount.gt(0))
      throw new BadRequestException('Datos de período inválidos');

    return this.prisma.$transaction(async (tx) => {
      // Shares the employee row lock with deactivation until commit or rollback.
      const employees = await tx.$queryRaw<{ id: string; active: boolean }[]>`
        SELECT "id", "active" FROM "Employee"
        WHERE "id" = ${dto.employeeId} AND "organizationId" = ${organizationId}
        FOR UPDATE`;
      if (!employees.length)
        throw new NotFoundException('Empleado no encontrado');
      if (!employees[0].active)
        throw new ConflictException('El empleado está inactivo');
      return tx.payrollObligation.create({
        data: {
          organizationId,
          employeeId: dto.employeeId,
          kind: PayrollObligationKind.FIXED_PERIOD,
          status: PayrollObligationStatus.PENDING,
          periodStart: new Date(`${dto.periodStart}T00:00:00.000Z`),
          periodEnd: new Date(`${dto.periodEnd}T00:00:00.000Z`),
          periodAmount: amount,
        },
      });
    });
  }
}
