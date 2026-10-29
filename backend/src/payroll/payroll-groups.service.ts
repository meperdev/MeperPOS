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
import { CreatePayrollGroupDto } from './dto/create-payroll-group.dto';

@Injectable()
export class PayrollGroupsService {
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
      throw new BadRequestException('Datos de grupo inválidos');
    const dto = plainToInstance(CreatePayrollGroupDto, input);
    if (
      validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length
    )
      throw new BadRequestException('Datos de grupo inválidos');

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Deactivation updates this same row; the lock lasts until commit/rollback.
        const employees = await tx.$queryRaw<{ id: string; active: boolean }[]>`
          SELECT "id", "active" FROM "Employee"
          WHERE "id" = ${dto.employeeId} AND "organizationId" = ${organizationId}
          FOR UPDATE`;
        if (!employees.length)
          throw new NotFoundException('Empleado no encontrado');
        if (!employees[0].active)
          throw new ConflictException('El empleado está inactivo');
        // Lock in a stable order before rereading amounts and memberships.
        const lockShifts = Prisma.sql`
          SELECT "id" FROM "EmployeeShift"
          WHERE "organizationId" = ${organizationId}
            AND "employeeId" = ${dto.employeeId}
            AND "id" IN (${Prisma.join([...dto.shiftIds].sort())})
          ORDER BY "id" FOR UPDATE`;
        await tx.$queryRaw(lockShifts);
        const shifts = await tx.employeeShift.findMany({
          where: {
            id: { in: dto.shiftIds },
            organizationId,
            employeeId: dto.employeeId,
          },
          select: { id: true, amount: true },
        });
        if (shifts.length !== dto.shiftIds.length)
          throw new NotFoundException('Turno no encontrado');
        if (
          shifts.some(
            ({ amount }) =>
              !amount.isFinite() ||
              !amount.gt(0) ||
              amount.decimalPlaces() > 2 ||
              amount.gt('9999999999.99'),
          )
        )
          throw new ConflictException('El turno tiene un valor inválido');
        const linked = await tx.payrollShiftMembership.findFirst({
          where: { shiftId: { in: dto.shiftIds }, releasedAt: null },
          select: { id: true },
        });
        if (linked)
          throw new ConflictException('El turno ya pertenece a un grupo');
        return tx.payrollObligation.create({
          data: {
            organizationId,
            employeeId: dto.employeeId,
            kind: PayrollObligationKind.SHIFT_GROUP,
            status: PayrollObligationStatus.PENDING,
            shiftMemberships: {
              create: dto.shiftIds.map((shiftId) => ({
                shift: {
                  connect: {
                    id_organizationId_employeeId: {
                      id: shiftId,
                      organizationId,
                      employeeId: dto.employeeId,
                    },
                  },
                },
              })),
            },
          },
          include: { shiftMemberships: true },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        const target = error.meta?.target;
        if (
          error.code === 'P2034' ||
          (error.code === 'P2002' &&
            (target === 'PayrollShiftMembership_active_shift_key' ||
              (Array.isArray(target) &&
                target.length === 1 &&
                target[0] === 'shiftId')))
        )
          throw new ConflictException(
            'Conflicto concurrente al crear el grupo',
          );
      }
      throw error;
    }
  }
}
