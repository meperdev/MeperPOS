import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { CreateEmployeeShiftDto } from './dto/employee-shift.dto';

function authorize(
  organizationId: string | undefined,
  actor: RequestUser | undefined,
): string {
  if (
    !organizationId ||
    !actor?.userId ||
    actor.organizationId !== organizationId ||
    !['OWNER', 'ADMIN'].includes(actor.role)
  ) {
    throw new ForbiddenException('No tiene permiso para gestionar turnos');
  }
  return organizationId;
}

function validate(input: unknown): CreateEmployeeShiftDto {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new BadRequestException('Datos de turno inválidos');
  const dto = plainToInstance(CreateEmployeeShiftDto, input);
  if (validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length)
    throw new BadRequestException('Datos de turno inválidos');
  return dto;
}

@Injectable()
export class EmployeeShiftsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    input: CreateEmployeeShiftDto,
    organizationId: string | undefined,
    actor: RequestUser | undefined,
  ) {
    const org = authorize(organizationId, actor);
    const dto = validate(input);
    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, organizationId: org },
      select: { id: true, active: true },
    });
    if (!employee) throw new NotFoundException('Empleado no encontrado');
    if (!employee.active)
      throw new ConflictException('El empleado está inactivo');
    try {
      return await this.prisma.employeeShift.create({
        data: {
          employeeId: dto.employeeId,
          organizationId: org,
          date: new Date(`${dto.date}T00:00:00.000Z`),
          kind: dto.kind,
          amount: dto.amount,
          ...(dto.observation === undefined
            ? {}
            : { observation: dto.observation }),
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const target = error.meta?.target;
        if (
          Array.isArray(target) &&
          target.length === 3 &&
          ['organizationId', 'employeeId', 'date'].every((field) =>
            target.includes(field),
          )
        )
          throw new ConflictException('Ya existe un turno para esta fecha');
        if (target === 'EmployeeShift_organizationId_employeeId_date_key')
          throw new ConflictException('Ya existe un turno para esta fecha');
      }
      // The database trigger is the concurrency guard against deactivation after the read.
      if (
        error instanceof Prisma.PrismaClientUnknownRequestError &&
        error.message.includes('Inactive employee cannot receive a shift')
      )
        throw new ConflictException('El empleado está inactivo');
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2004' &&
        typeof error.meta?.database_error === 'string' &&
        error.meta.database_error.includes(
          'Inactive employee cannot receive a shift',
        )
      )
        throw new ConflictException('El empleado está inactivo');
      throw error;
    }
  }

  async findAll(
    employeeId: string,
    organizationId: string | undefined,
    actor: RequestUser | undefined,
  ) {
    const org = authorize(organizationId, actor);
    if (typeof employeeId !== 'string' || !employeeId.trim())
      throw new BadRequestException('Empleado inválido');
    return this.prisma.employeeShift.findMany({
      where: { organizationId: org, employeeId },
      orderBy: { date: 'asc' },
    });
  }

  async findOne(
    id: string,
    organizationId: string | undefined,
    actor: RequestUser | undefined,
  ) {
    const org = authorize(organizationId, actor);
    if (typeof id !== 'string' || !id.trim())
      throw new BadRequestException('Turno inválido');
    const shift = await this.prisma.employeeShift.findFirst({
      where: { id, organizationId: org },
    });
    if (!shift) throw new NotFoundException('Turno no encontrado');
    return shift;
  }
}
