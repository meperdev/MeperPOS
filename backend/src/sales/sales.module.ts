import { Module } from '@nestjs/common';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';
import { SettingsModule } from '../settings/settings.module';
import { SequenceModule } from '../common/sequences/sequence.module';
import { ReceiptsModule } from '../receipts/receipts.module';
import { LocationsModule } from '../locations/locations.module';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { AdminOrganizationInterceptor } from '../common/interceptors/admin-organization.interceptor';

@Module({
  imports: [SettingsModule, SequenceModule, ReceiptsModule, LocationsModule],
  controllers: [SalesController],
  providers: [
    SalesService,
    OrganizationRequiredGuard,
    AdminOrganizationInterceptor,
  ],
  exports: [SalesService],
})
export class SalesModule {}
