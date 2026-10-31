import {
  Controller,
  createParamDecorator,
  ExecutionContext,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { OrganizationStatusGuard } from '../common/guards/organization-status.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';
import { CreateEmployeeShiftDto } from './dto/employee-shift.dto';
import { QueryEmployeesHttpDto } from './dto/query-employees.dto';
import { EmployeesService } from './employees.service';
import { EmployeeShiftsService } from './employee-shifts.service';

// Custom parameters bypass the global pipe's implicit conversion. The local
// pipe validates the original JSON with the same whitelist policy instead.
const PayrollBody = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<{ body: unknown }>().body,
);
const payrollBodyPipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  validateCustomDecorators: true,
  transformOptions: { enableImplicitConversion: false },
});

class SetEmployeeActiveDto {
  @Transform(({ obj, key }) => obj[key])
  @IsBoolean()
  active: boolean;
}

@Controller('employees')
@UseGuards(
  JwtAuthGuard,
  OrganizationStatusGuard,
  RolesGuard,
  OrganizationRequiredGuard,
)
@Roles(OrgRole.OWNER, OrgRole.ADMIN)
export class EmployeesController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly shifts: EmployeeShiftsService,
  ) {}

  @Post()
  create(
    @PayrollBody(payrollBodyPipe) dto: CreateEmployeeDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.employees.create(dto, user.organizationId, user);
  }

  @Get()
  findAll(
    @Query() query: QueryEmployeesHttpDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.employees.findAll(query, user.organizationId, user);
  }

  @Post('shifts')
  createShift(
    @PayrollBody(payrollBodyPipe) dto: CreateEmployeeShiftDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.shifts.create(dto, user.organizationId, user);
  }

  @Get('shifts/:shiftId')
  findShift(@Param('shiftId') id: string, @CurrentUser() user: RequestUser) {
    return this.shifts.findOne(id, user.organizationId, user);
  }

  @Get(':id/shifts')
  findShifts(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.shifts.findAll(id, user.organizationId, user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.employees.findOne(id, user.organizationId, user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @PayrollBody(payrollBodyPipe) dto: UpdateEmployeeDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.employees.update(id, dto, user.organizationId, user);
  }

  @Patch(':id/active')
  setActive(
    @Param('id') id: string,
    @PayrollBody(payrollBodyPipe) dto: SetEmployeeActiveDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.employees.setActive(id, dto.active, user.organizationId, user);
  }
}
