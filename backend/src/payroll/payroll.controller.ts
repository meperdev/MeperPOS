import {
  Controller,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Get,
  Post,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { OrganizationStatusGuard } from '../common/guards/organization-status.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { CorrectPayrollPeriodInstallmentDto } from './dto/correct-payroll-period-installment.dto';
import { CreatePayrollGroupDto } from './dto/create-payroll-group.dto';
import { CreatePayrollGroupInstallmentDto } from './dto/create-payroll-group-installment.dto';
import { CreatePayrollPeriodDto } from './dto/create-payroll-period.dto';
import { CreatePayrollPeriodInstallmentDto } from './dto/create-payroll-period-installment.dto';
import { PayrollGroupInstallmentsService } from './payroll-group-installments.service';
import { PayrollGroupsService } from './payroll-groups.service';
import { PayrollObligationsService } from './payroll-obligations.service';
import { PayrollPeriodInstallmentCorrectionService } from './payroll-period-installment-correction.service';
import { PayrollPeriodInstallmentsService } from './payroll-period-installments.service';
import { PayrollPeriodsService } from './payroll-periods.service';

// Custom parameters bypass the global pipe's implicit conversion. The local
// pipe validates the original JSON with the same whitelist policy instead, so a
// numeric amount, an extra field or a body-supplied organizationId cannot reach
// a payroll service.
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

class QueryPayrollObligationsHttpDto {
  // Optional: without it the authenticated tenant's obligations are listed.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(200)
  employeeId?: string;
}

@Controller('payroll')
@UseGuards(
  JwtAuthGuard,
  OrganizationStatusGuard,
  RolesGuard,
  OrganizationRequiredGuard,
)
@Roles(OrgRole.OWNER, OrgRole.ADMIN)
export class PayrollController {
  constructor(
    private readonly periods: PayrollPeriodsService,
    private readonly groups: PayrollGroupsService,
    private readonly periodInstallments: PayrollPeriodInstallmentsService,
    private readonly groupInstallments: PayrollGroupInstallmentsService,
    private readonly corrections: PayrollPeriodInstallmentCorrectionService,
    private readonly obligations: PayrollObligationsService,
  ) {}

  // Tenant and role come from the authenticated request only. The payroll
  // services enforce the same rule; repeating it here also covers the
  // service-less read route and keeps SUPER_ADMIN out of tenant payroll data
  // (RolesGuard bypasses the hierarchy for super admins).
  private tenant(user: RequestUser | undefined): string {
    if (
      !user?.userId ||
      !user.organizationId ||
      !['OWNER', 'ADMIN'].includes(user.role)
    )
      throw new ForbiddenException('No tiene permiso para gestionar nómina');
    return user.organizationId;
  }

  @Post('periods')
  createPeriod(
    @PayrollBody(payrollBodyPipe) dto: CreatePayrollPeriodDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.periods.create(dto, this.tenant(user), user);
  }

  @Post('groups')
  createGroup(
    @PayrollBody(payrollBodyPipe) dto: CreatePayrollGroupDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.groups.create(dto, this.tenant(user), user);
  }

  @Post('period-installments')
  createPeriodInstallment(
    @PayrollBody(payrollBodyPipe) dto: CreatePayrollPeriodInstallmentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.periodInstallments.create(dto, this.tenant(user), user);
  }

  @Post('group-installments')
  createGroupInstallment(
    @PayrollBody(payrollBodyPipe) dto: CreatePayrollGroupInstallmentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.groupInstallments.create(dto, this.tenant(user), user);
  }

  @Post('period-installments/correct')
  correctPeriodInstallment(
    @PayrollBody(payrollBodyPipe) dto: CorrectPayrollPeriodInstallmentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.corrections.correct(dto, this.tenant(user), user);
  }

  // Read-only projection: persisted payroll facts (amounts, dates, version), their
  // cash outflows and a server-computed paid/balance/completion summary. The
  // numbers a user sees as money are never summed by the client, and no writer,
  // planner or expense service is invoked here.
  @Get('obligations')
  findObligations(
    @Query() query: QueryPayrollObligationsHttpDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.obligations.findAll(this.tenant(user), query.employeeId);
  }
}
