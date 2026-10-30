import { Module } from '@nestjs/common';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { OrganizationStatusGuard } from '../common/guards/organization-status.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { EmployeeShiftsService } from './employee-shifts.service';
import { PayrollController } from './payroll.controller';
import { PayrollGroupInstallmentsService } from './payroll-group-installments.service';
import { PayrollGroupsService } from './payroll-groups.service';
import { PayrollPeriodInstallmentCorrectionService } from './payroll-period-installment-correction.service';
import { PayrollPeriodInstallmentsService } from './payroll-period-installments.service';
import { PayrollPeriodsService } from './payroll-periods.service';

// Payroll expense foundation stays unwired on purpose: PayrollExpenseCategoryService,
// planPayrollObligationCompletion and writePayrollCompletionExpense have no route
// and no provider until cash-report deduplication lands. Wiring them here (or
// exposing them from PayrollController) would let a completion record cash that
// reports still count twice.
@Module({
  imports: [PrismaModule],
  controllers: [EmployeesController, PayrollController],
  providers: [
    EmployeesService,
    EmployeeShiftsService,
    PayrollPeriodsService,
    PayrollGroupsService,
    PayrollPeriodInstallmentsService,
    PayrollGroupInstallmentsService,
    PayrollPeriodInstallmentCorrectionService,
    OrganizationRequiredGuard,
    OrganizationStatusGuard,
  ],
})
export class PayrollModule {}
