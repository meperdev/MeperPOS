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
import { CorrectPayrollShiftDateDto } from './dto/correct-payroll-shift-date.dto';

// Internal foundation only: historical snapshots and database concurrency proof are pending.
@Injectable()
export class PayrollShiftDateCorrectionService {
  constructor(private readonly prisma: PrismaService) {}

  async correct(
    shiftId: string,
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
      throw new ForbiddenException('No tiene permiso para gestionar turnos');
    if (
      typeof shiftId !== 'string' ||
      !shiftId.trim() ||
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input)
    )
      throw new BadRequestException('Datos de turno inválidos');
    const dto = plainToInstance(CorrectPayrollShiftDateDto, input);
    if (
      validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length
    )
      throw new BadRequestException('Datos de turno inválidos');
    let auditFailed = false;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const initial = await tx.employeeShift.findFirst({
          where: { id: shiftId, organizationId },
          select: { employeeId: true },
        });
        if (!initial) throw new NotFoundException('Turno no encontrado');
        const employeeId = initial.employeeId;
        const employees = await tx.$queryRaw<{ id: string; active: boolean }[]>`
          SELECT "id", "active" FROM "Employee"
          WHERE "id" = ${employeeId} AND "organizationId" = ${organizationId} FOR UPDATE`;
        if (!employees.length)
          throw new NotFoundException('Empleado no encontrado');
        // The existing trigger rejects date updates for inactive employees; not a product policy.
        if (!employees[0].active)
          throw new ConflictException('El empleado está inactivo');
        const where = { shiftId, organizationId, employeeId };
        const select = {
          id: true,
          obligationId: true,
          releasedAt: true,
          obligation: { select: { status: true } },
        } as const;
        const before = await tx.payrollShiftMembership.findMany({
          where,
          select,
        });
        const obligationIds = [
          ...new Set(before.map((m) => m.obligationId)),
        ].sort();
        if (obligationIds.length) {
          await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "PayrollObligation"
            WHERE "organizationId" = ${organizationId} AND "employeeId" = ${employeeId}
              AND "id" IN (${Prisma.join(obligationIds)}) ORDER BY "id" FOR UPDATE`);
        }
        await tx.$queryRaw`SELECT "id" FROM "EmployeeShift"
          WHERE "id" = ${shiftId} AND "organizationId" = ${organizationId} AND "employeeId" = ${employeeId} FOR UPDATE`;
        const shift = await tx.employeeShift.findFirst({
          where: { id: shiftId, organizationId, employeeId },
          select: { id: true, amount: true, date: true },
        });
        if (!shift) throw new NotFoundException('Turno no encontrado');
        const after = await tx.payrollShiftMembership.findMany({
          where,
          select,
        });
        // Never mutate apparent completed/released history until snapshots are designed.
        if (
          after.some(
            (m) =>
              m.releasedAt !== null ||
              m.obligation.status !== PayrollObligationStatus.PENDING,
          ) ||
          after.some(
            (m) =>
              !before.some(
                (prior) =>
                  prior.id === m.id && prior.obligationId === m.obligationId,
              ),
          ) ||
          before.some(
            (m) =>
              !after.some(
                (next) =>
                  next.id === m.id && next.obligationId === m.obligationId,
              ),
          )
        )
          throw new ConflictException(
            'No se puede corregir el historial de este turno',
          );
        if (
          !shift.amount.isFinite() ||
          !shift.amount.gt(0) ||
          shift.amount.decimalPlaces() > 2 ||
          shift.amount.gt('9999999999.99')
        )
          throw new ConflictException('El turno tiene un valor inválido');
        const oldDate = shift.date.toISOString().slice(0, 10);
        if (oldDate === dto.date) return { count: 1 };
        const result = await tx.employeeShift.updateMany({
          where: { id: shiftId, organizationId, employeeId },
          data: { date: new Date(`${dto.date}T00:00:00.000Z`) },
        });
        if (result.count !== 1)
          throw new ConflictException('El turno cambió durante la corrección');
        try {
          await tx.auditLog.create({
            data: {
              userId: actor.userId,
              organizationId,
              action: 'PAYROLL_SHIFT_DATE_CORRECTION',
              resource: 'EmployeeShift',
              resourceId: shiftId,
              metadata: { oldDate, newDate: dto.date },
            },
          });
        } catch (error) {
          auditFailed = true;
          throw error;
        }
        return result;
      });
    } catch (error) {
      if (auditFailed) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        const target = error.meta?.target;
        if (
          error.code === 'P2034' ||
          (error.code === 'P2002' &&
            (target === 'EmployeeShift_organizationId_employeeId_date_key' ||
              (Array.isArray(target) &&
                target.length === 3 &&
                ['organizationId', 'employeeId', 'date'].every((field) =>
                  target.includes(field),
                ))))
        )
          throw new ConflictException(
            'Conflicto al corregir la fecha del turno',
          );
      }
      throw error;
    }
  }
}
