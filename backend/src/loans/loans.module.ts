import { Module } from '@nestjs/common';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { AdminOrganizationInterceptor } from '../common/interceptors/admin-organization.interceptor';
import { SequenceModule } from '../common/sequences/sequence.module';
import { LoansController } from './loans.controller';
import { LoansService } from './loans.service';

@Module({
  imports: [SequenceModule],
  controllers: [LoansController],
  providers: [
    LoansService,
    OrganizationRequiredGuard,
    AdminOrganizationInterceptor,
  ],
})
export class LoansModule {}
