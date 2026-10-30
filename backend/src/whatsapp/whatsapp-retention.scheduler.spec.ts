import { Logger } from '@nestjs/common';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import type { WhatsAppRetentionService } from './whatsapp-retention.service';
import {
  RETENTION_CRON,
  RETENTION_TIMEZONE,
  WhatsAppRetentionScheduler,
} from './whatsapp-retention.scheduler';

function setup(
  purgeAll: jest.Mock = jest.fn().mockResolvedValue({
    connectionsProcessed: 1,
    connectionsFailed: 0,
    messagesDeleted: 12,
    conversationsDeleted: 3,
    boundReached: false,
  }),
) {
  return {
    purgeAll,
    scheduler: new WhatsAppRetentionScheduler({
      purgeAll,
    } as unknown as WhatsAppRetentionService),
  };
}

function spyOnLogger() {
  return (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
    (channel) =>
      jest.spyOn(Logger.prototype, channel).mockImplementation(() => undefined),
  );
}

function stringified(spies: jest.SpyInstance[]): string {
  return spies.map((spy) => JSON.stringify(spy.mock.calls)).join(' ');
}

describe('WhatsAppRetentionScheduler', () => {
  describe('the cron contract', () => {
    it('is wired for 03:00 in America/Bogota', () => {
      const options = Reflect.getMetadata(
        SCHEDULE_CRON_OPTIONS,
        WhatsAppRetentionScheduler.prototype.handleDailyPurge,
      ) as { cronTime: string; timeZone: string };

      expect(RETENTION_CRON).toBe('0 3 * * *');
      expect(RETENTION_TIMEZONE).toBe('America/Bogota');
      expect(options).toEqual({
        cronTime: RETENTION_CRON,
        timeZone: RETENTION_TIMEZONE,
      });
    });
  });

  describe('when it fires', () => {
    it('purges every connection once', async () => {
      const { scheduler, purgeAll } = setup();

      await scheduler.handleDailyPurge();

      expect(purgeAll).toHaveBeenCalledTimes(1);
    });

    it('logs the counts it deleted, and nothing else', async () => {
      const spies = spyOnLogger();
      try {
        const { scheduler } = setup();

        await scheduler.handleDailyPurge();

        const logged = stringified(spies);
        expect(logged).toContain('whatsapp_retention');
        expect(logged).toContain('completed');
        expect(logged).toContain('12');
        expect(logged).toContain('3');
      } finally {
        spies.forEach((spy) => spy.mockRestore());
      }
    });

    it('swallows a purge failure and logs a fixed code', async () => {
      const spies = spyOnLogger();
      try {
        const { scheduler } = setup(
          jest.fn().mockRejectedValue(new Error('secret-db-dsn')),
        );

        await expect(scheduler.handleDailyPurge()).resolves.toBeUndefined();

        const logged = stringified(spies);
        expect(logged).toContain('purge_failed');
        expect(logged).not.toContain('secret-db-dsn');
      } finally {
        spies.forEach((spy) => spy.mockRestore());
      }
    });

    it('swallows a non-error rejection too', async () => {
      const spies = spyOnLogger();
      try {
        const { scheduler } = setup(jest.fn().mockRejectedValue('boom'));

        await expect(scheduler.handleDailyPurge()).resolves.toBeUndefined();
        expect(stringified(spies)).toContain('purge_failed');
      } finally {
        spies.forEach((spy) => spy.mockRestore());
      }
    });
  });
});
