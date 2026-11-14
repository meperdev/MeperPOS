import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import {
  CreateEmployeeDto,
  QueryEmployeesDto,
  UpdateEmployeeDto,
} from './dto/employee.dto';

type EmployeeChanges = Partial<Omit<CreateEmployeeDto, 'startDate'>> & {
  startDate?: Date | null;
  active?: boolean;
};

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
    throw new ForbiddenException('No tiene permiso para gestionar empleados');
  }
  return organizationId;
}

function validated<T extends object>(cls: new () => T, input: unknown): T {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new BadRequestException('Datos de empleado inválidos');
  const dto = plainToInstance(cls, input);
  if (validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length)
    throw new BadRequestException('Datos de empleado inválidos');
  return dto;
}

function profile(dto: Partial<CreateEmployeeDto>): EmployeeChanges {
  const { startDate, ...data } = dto;
  return {
    ...data,
    ...(startDate === undefined
      ? {}
      : {
          startDate:
            startDate === null ? null : new Date(`${startDate}T00:00:00.000Z`),
        }),
  };
}

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    dto: CreateEmployeeDto,
    organizationId: string | undefined,
    actor: RequestUser | undefined,
  ) {
    const org = authorize(organizationId, actor);
    const validatedDto = validated(CreateEmployeeDto, dto);
    return this.prisma.employee.create({
      data: {
        ...profile(validatedDto),
        name: validatedDto.name,
        organizationId: org,
      },
    });
  }

  async findAll(
    query: QueryEmployeesDto,
    organizationId: string | undefined,
    actor: RequestUser | undefined,
  ) {
    const org = authorize(organizationId, actor);
    const { active } = validated(QueryEmployeesDto, query);
    if (active !== undefined && typeof active !== 'boolean')
      throw new BadRequestException('Estado inválido');
    return this.prisma.employee.findMany({
      where: {
        organizationId: org,
        ...(active === undefined ? {} : { active }),
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(
    id: string,
    organizationId: string | undefined,
    actor: RequestUser | undefined,
  ) {
    const org = authorize(organizationId, actor);
    const employee = await this.prisma.employee.findFirst({
      where: { id, organizationId: org },
    });
    if (!employee) throw new NotFoundException('Empleado no encontrado');
    return employee;
  }

  async update(
    id: string,
    dto: Partial<UpdateEmployeeDto>,
    organizationId: string | undefined,
    actor: RequestUser | undefined,
  ) {
    const org = authorize(organizationId, actor);
    return this.change(id, org, profile(validated(UpdateEmployeeDto, dto)));
  }

  async setActive(
    id: string,
    active: boolean,
    organizationId: string | undefined,
    actor: RequestUser | undefined,
  ) {
    const org = authorize(organizationId, actor);
    if (typeof active !== 'boolean')
      throw new BadRequestException('Estado inválido');
    return this.change(id, org, { active });
  }

  private async change(id: string, org: string, data: EmployeeChanges) {
    const result = await this.prisma.employee.updateManyAndReturn({
      where: { id, organizationId: org },
      data,
    });
    if (!result.length) throw new NotFoundException('Empleado no encontrado');
    return result[0];
  }
}
