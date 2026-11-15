import { Module } from '@nestjs/common';
import { PlanLimitsModule } from '../plan-limits/plan-limits.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { StockAlertsScheduler } from './stock-alerts.scheduler';
import { StockAlertsService } from './stock-alerts.service';

/**
 * The alert feed and the low-stock notification pipeline.
 *
 * The feed is read-only and tenant-scoped. The notification side owns the
 * `ProductStockAlert` episodes and the WhatsApp text delivery; it imports the
 * WhatsApp module for the central session and the text port instead of opening a
 * second provider client.
 */
@Module({
  imports: [PlanLimitsModule, WhatsAppModule],
  controllers: [AlertsController],
  providers: [AlertsService, StockAlertsService, StockAlertsScheduler],
  exports: [AlertsService, StockAlertsService],
})
export class AlertsModule {}
