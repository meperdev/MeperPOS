import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { PlanLimitsModule } from '../plan-limits/plan-limits.module';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { AdminOrganizationInterceptor } from '../common/interceptors/admin-organization.interceptor';
import { BusinessModulesModule } from '../business-modules/business-modules.module';
import { CustomerVehiclesController } from './customer-vehicles.controller';
import { CustomerVehiclesService } from './customer-vehicles.service';
import { CustomerPlateInterceptor } from './customer-plate.interceptor';

@Module({
  imports: [PlanLimitsModule, BusinessModulesModule],
  controllers: [CustomersController, CustomerVehiclesController],
  providers: [
    CustomersService,
    CustomerVehiclesService,
    CustomerPlateInterceptor,
    OrganizationRequiredGuard,
    AdminOrganizationInterceptor,
  ],
  exports: [CustomersService],
})
export class CustomersModule {}
