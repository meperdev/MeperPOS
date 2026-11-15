import { Module } from '@nestjs/common';
import { AdminBusinessModulesController } from './admin-business-modules.controller';
import { AdminModuleCatalogController } from './admin-module-catalog.controller';
import { BusinessModulesService } from './business-modules.service';
import { BusinessModulesController } from './business-modules.controller';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { AdminOrganizationInterceptor } from '../common/interceptors/admin-organization.interceptor';

@Module({
  controllers: [
    AdminBusinessModulesController,
    AdminModuleCatalogController,
    BusinessModulesController,
  ],
  providers: [
    BusinessModulesService,
    OrganizationRequiredGuard,
    AdminOrganizationInterceptor,
  ],
  exports: [BusinessModulesService],
})
export class BusinessModulesModule {}
