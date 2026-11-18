import { Module } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { SequenceModule } from '../common/sequences/sequence.module';
import { SettingsModule } from '../settings/settings.module';
import { PurchaseOrderDocumentsService } from './document/purchase-order-documents.service';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { AdminOrganizationInterceptor } from '../common/interceptors/admin-organization.interceptor';

@Module({
  imports: [SequenceModule, SettingsModule],
  controllers: [PurchaseOrdersController],
  providers: [
    PurchaseOrdersService,
    PurchaseOrderDocumentsService,
    OrganizationRequiredGuard,
    AdminOrganizationInterceptor,
  ],
  exports: [PurchaseOrdersService],
})
export class PurchaseOrdersModule {}
