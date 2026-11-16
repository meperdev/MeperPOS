import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WhatsAppConnectionsService } from './whatsapp-connections.service';
import {
  DAILY_REPORT_HOUR,
  DAILY_REPORT_TIMEZONE,
  bogotaHourOf,
  bogotaReportDay,
  WhatsAppDeliveryService,
  type WhatsAppDeliveryOutcome,
} from './whatsapp-delivery.service';

/**
 * The closing report the administrator asked for: every day at 20:00 in
 * America/Bogota (S1, S4). The cut-off is the same instant, because the report is
 * built when it is sent and not from an earlier snapshot. The hour and the zone
 * live in `WhatsAppDeliveryService` — which computes the next run for the screen —
 * and are re-exported here, where the cron is wired.
 */
export const DAILY_REPORT_CRON = '0 20 * * *';
export { DAILY_REPORT_HOUR, DAILY_REPORT_TIMEZONE, bogotaHourOf };

/**
 * Drives the once-a-day report for the central INTELLIGENCE connection.
 *
 * Two entry points, one delivery:
 *
 *  - the cron fires at 20:00 America/Bogota and sends today's scheduled report;
 *  - the bootstrap catch-up covers a process that was down at 20:00. It only acts
 *    when it is already past 20:00 *and* no SCHEDULED row exists for today, so a
 *    restart at 21:00 sends the missed report once, a restart at 10:00 sends
 *    nothing, and a restart after a send sends nothing again. The row is the
 *    record of truth for both, which is why the catch-up asks before sending even
 *    though `scheduled()` would refuse a second claim anyway.
 *
 * Neither entry point may throw. A failed delivery is already recorded on its own
 * row with a fixed reason code by `WhatsAppDeliveryService`; a skipped day (no
 * recipient, or the failure-streak pause) answers `paused` / `no_identity` and
 * leaves no row at all, so the catch-up is free to try again after a restart once
 * the recipient exists. Anything else that breaks (the provider being down, the
 * database being unreachable, a missing connection) is reported here as one fixed
 * log line and swallowed. A scheduler that throws is a scheduler the host
 * disables.
 */
@Injectable()
export class WhatsAppDeliveryScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(WhatsAppDeliveryScheduler.name);

  constructor(
    private readonly connections: WhatsAppConnectionsService,
    private readonly delivery: WhatsAppDeliveryService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.catchUp();
  }

  @Cron(DAILY_REPORT_CRON, { timeZone: DAILY_REPORT_TIMEZONE })
  async handleDailyReport(): Promise<void> {
    await this.send('cron');
  }

  /**
   * Send today's report when it is due and was never attempted. Takes `now` so a
   * spec can place the process at any wall-clock instant without touching the
   * clock of the test runner.
   */
  async catchUp(now: Date = new Date()): Promise<void> {
    try {
      if (bogotaHourOf(now) < DAILY_REPORT_HOUR) {
        this.logger.log({
          event: 'whatsapp_delivery',
          outcome: 'catch_up_not_due',
        });
        return;
      }

      const connection = await this.connections.getOrCreateIntelligence();
      const day = bogotaReportDay(now);
      if (await this.delivery.findScheduled(connection.id, day)) {
        this.logger.log({
          event: 'whatsapp_delivery',
          outcome: 'catch_up_already_attempted',
        });
        return;
      }

      const outcome = await this.delivery.scheduled(connection.id, day);
      this.logOutcome('catch_up', outcome);
    } catch (error) {
      this.logger.error({
        event: 'whatsapp_delivery',
        outcome: 'catch_up_failed',
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  private async send(trigger: 'cron'): Promise<void> {
    try {
      const connection = await this.connections.getOrCreateIntelligence();
      const outcome = await this.delivery.scheduled(
        connection.id,
        bogotaReportDay(new Date()),
      );
      this.logOutcome(trigger, outcome);
    } catch (error) {
      this.logger.error({
        event: 'whatsapp_delivery',
        outcome: `${trigger}_failed`,
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  /**
   * One line per outcome, and every outcome names itself. `paused` is the
   * failure-streak skip: no row was written and nothing was attempted, so it is a
   * decision to report, not a failure to retry — the next successful send (the
   * manual report, or a later day once a number is linked) resumes it.
   */
  private logOutcome(
    trigger: 'cron' | 'catch_up',
    outcome: WhatsAppDeliveryOutcome,
  ): void {
    this.logger.log({
      event: 'whatsapp_delivery',
      outcome: `${trigger}_${outcome.status}`,
      ...(outcome.status === 'paused'
        ? { reason: 'consecutive_failures' }
        : {}),
    });
  }
}
