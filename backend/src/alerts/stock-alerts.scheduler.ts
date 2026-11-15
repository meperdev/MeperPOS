import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StockAlertsService } from './stock-alerts.service';

/** Every five minutes: fast enough for a shift, cheap enough for a catalog scan. */
export const STOCK_ALERTS_CRON = '*/5 * * * *';

/**
 * Drives the low-stock scan.
 *
 * The bootstrap run covers a process that was down while a product crossed its
 * minimum; the cron covers everything after. Both call the same idempotent scan,
 * so a restart never duplicates an episode or a message. `STOCK_ALERTS_ENABLED=false`
 * turns both off — used by end-to-end suites that must not touch the provider.
 */
@Injectable()
export class StockAlertsScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(StockAlertsScheduler.name);

  constructor(private readonly stockAlerts: StockAlertsService) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!enabled()) return;
    // Never gate readiness on this scan. It walks every tenant and calls the
    // provider, so awaiting it here would block the HTTP listener on a slow or
    // misconfigured WhatsApp session. `run` owns its own failures.
    void this.run('bootstrap');
  }

  @Cron(STOCK_ALERTS_CRON)
  async handleScan(): Promise<void> {
    if (!enabled()) return;
    await this.run('cron');
  }

  /**
   * Never throws: a scheduler that throws is a scheduler the host disables. A
   * per-organization failure is already logged and skipped inside the service.
   */
  async run(trigger: 'bootstrap' | 'cron'): Promise<void> {
    try {
      const summary = await this.stockAlerts.scanAll();
      this.logger.log({
        event: 'stock_alert_scan',
        trigger,
        opened: summary.opened,
        resolved: summary.resolved,
        notified: summary.notified,
        failed: summary.failed,
      });
    } catch (error) {
      this.logger.error({
        event: 'stock_alert_scan',
        trigger,
        outcome: 'failed',
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }
  }
}

const enabled = (): boolean => process.env.STOCK_ALERTS_ENABLED !== 'false';
