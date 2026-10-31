import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WhatsAppRetentionService } from './whatsapp-retention.service';

/**
 * The daily purge: 03:00 in America/Bogota, the quietest hour of the shop's day
 * (no sales counter open, no report being written) and therefore the hour with
 * the fewest rows to lock. The window itself is per connection, so this job only
 * decides *when* to look, never *what* to keep.
 */
export const RETENTION_CRON = '0 3 * * *';
export const RETENTION_TIMEZONE = 'America/Bogota';

/**
 * Drives `WhatsAppRetentionService.purgeAll` once a day.
 *
 * A scheduler that throws is a scheduler the host disables, so the call is
 * wrapped: a failure is logged as one fixed line (`purge_failed` plus the error's
 * class name, never its message) and swallowed. The purge is idempotent and
 * bounded, so the next run simply continues; there is no retry, no counter and no
 * state to keep here. Successful runs log the counts and nothing that could name
 * a person.
 */
@Injectable()
export class WhatsAppRetentionScheduler {
  private readonly logger = new Logger(WhatsAppRetentionScheduler.name);

  constructor(private readonly retention: WhatsAppRetentionService) {}

  @Cron(RETENTION_CRON, { timeZone: RETENTION_TIMEZONE })
  async handleDailyPurge(): Promise<void> {
    try {
      const outcome = await this.retention.purgeAll();
      this.logger.log({
        event: 'whatsapp_retention',
        outcome: 'completed',
        connectionsProcessed: outcome.connectionsProcessed,
        connectionsFailed: outcome.connectionsFailed,
        messagesDeleted: outcome.messagesDeleted,
        conversationsDeleted: outcome.conversationsDeleted,
        boundReached: outcome.boundReached,
      });
    } catch (error) {
      this.logger.error({
        event: 'whatsapp_retention',
        outcome: 'purge_failed',
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }
  }
}
