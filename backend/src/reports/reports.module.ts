import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { DailyReportController } from './daily-report.controller';
import { DailyReportService } from './daily-report.service';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { AdminOrganizationInterceptor } from '../common/interceptors/admin-organization.interceptor';
import { ExpensesModule } from '../expenses/expenses.module';

@Module({
  imports: [ExpensesModule],
  controllers: [ReportsController, DailyReportController],
  providers: [
    ReportsService,
    DailyReportService,
    OrganizationRequiredGuard,
    AdminOrganizationInterceptor,
  ],
  exports: [ReportsService],
})
export class ReportsModule {}
