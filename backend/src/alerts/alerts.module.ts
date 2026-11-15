import { Module } from '@nestjs/common';
import { PlanLimitsModule } from '../plan-limits/plan-limits.module';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';

/**
 * The server-owned alert feed. Read-only and tenant-scoped: the service derives
 * every category from signals the app already owns, and the controller admits
 * every organization role because visibility is decided per category inside.
 */
@Module({
  imports: [PlanLimitsModule],
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
