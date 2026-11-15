import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuthModule } from '../auth/auth.module';
import { PlanLimitsModule } from '../plan-limits/plan-limits.module';
import { BusinessModulesModule } from '../business-modules/business-modules.module';

@Module({
  imports: [AuthModule, PlanLimitsModule, BusinessModulesModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
