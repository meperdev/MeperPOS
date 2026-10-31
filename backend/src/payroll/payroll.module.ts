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
import { PayrollObligationsService } from './payroll-obligations.service';
import { PayrollPeriodInstallmentCorrectionService } from './payroll-period-installment-correction.service';
import { PayrollPeriodInstallmentsService } from './payroll-period-installments.service';
import { PayrollPeriodsService } from './payroll-periods.service';
import { PayrollCashReturnService } from './payroll-cash-return.service';
import { PayrollGroupInstallmentCorrectionService } from './payroll-group-installment-correction.service';
import { PayrollReplacementPaymentService } from './payroll-replacement-payment.service';

// The completion expense is now written inside the installment transactions, and
// cash-flow reports exclude linked expense payments while counting payroll
// outflows, so no double count remains. PayrollExpenseCategoryService and the
// completion planner stay off the provider list on purpose: the category logic is
// reached through the transaction-scoped resolver and the planner through the
// expense writer. Real PostgreSQL concurrency and rollback proof is still pending.
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
    // Revises the recorded amount of one pending grouped installment in place and
    // reapplies the plan to the installments registered after it.
    PayrollGroupInstallmentCorrectionService,
    PayrollPeriodInstallmentCorrectionService,
    // Read-only: the obligations route projects persisted facts and the
    // server-computed paid/balance/completion summary. It writes nothing.
    PayrollObligationsService,
    // Append-only: records a real returned installment on its own date and method.
    PayrollCashReturnService,
    // Creates a new pending payment that references the valid installments of a
    // completed payment without editing it or charging their cash again.
    PayrollReplacementPaymentService,
    OrganizationRequiredGuard,
    OrganizationStatusGuard,
  ],
})
export class PayrollModule {}
