import { Module } from '@nestjs/common';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { AdminOrganizationInterceptor } from '../common/interceptors/admin-organization.interceptor';
import { ReportsModule } from '../reports/reports.module';
import { BusinessModulesModule } from '../business-modules/business-modules.module';

@Module({
  imports: [ReportsModule, BusinessModulesModule],
  controllers: [ExportsController],
  providers: [ExportsService, OrganizationRequiredGuard, AdminOrganizationInterceptor],
  exports: [ExportsService],
})
export class ExportsModule {}
