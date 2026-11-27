import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { PlanLimitsModule } from '../plan-limits/plan-limits.module';
import { LocationsModule } from '../locations/locations.module';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { AdminOrganizationInterceptor } from '../common/interceptors/admin-organization.interceptor';

@Module({
  imports: [CloudinaryModule, PlanLimitsModule, LocationsModule],
  controllers: [ProductsController],
  providers: [ProductsService, OrganizationRequiredGuard, AdminOrganizationInterceptor],
  exports: [ProductsService],
})
export class ProductsModule {}
