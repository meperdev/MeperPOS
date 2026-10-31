import { Logger } from '@nestjs/common';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import type { WhatsAppConnectionsService } from './whatsapp-connections.service';
import type { WhatsAppDeliveryService } from './whatsapp-delivery.service';
import {
  DAILY_REPORT_CRON,
  DAILY_REPORT_TIMEZONE,
  WhatsAppDeliveryScheduler,
} from './whatsapp-delivery.scheduler';

const CENTRAL_CONNECTION_ID = 'central-connection';

function setup(
  options: {
    scheduled?: jest.Mock;
    findScheduled?: jest.Mock;
    connection?: jest.Mock;
  } = {},
) {
  const connections = {
    getOrCreateIntelligence:
      options.connection ??
      jest.fn().mockResolvedValue({ id: CENTRAL_CONNECTION_ID }),
  };
  const delivery = {
    scheduled:
      options.scheduled ??
      jest
        .fn()
        .mockResolvedValue({ status: 'sent', providerMessageId: 'wamid-1' }),
    findScheduled: options.findScheduled ?? jest.fn().mockResolvedValue(null),
  };

  return {
    connections,
    delivery,
    scheduler: new WhatsAppDeliveryScheduler(
      connections as unknown as WhatsAppConnectionsService,
      delivery as unknown as WhatsAppDeliveryService,
    ),
  };
}

function spyOnLogger() {
  return (['log', 'warn', 'error'] as const).map((channel) =>
    jest.spyOn(Logger.prototype, channel).mockImplementation(() => undefined),
  );
}

/** Everything the scheduler must never put in a log line. */
function stringified(spies: jest.SpyInstance[]): string {
  return spies.map((spy) => JSON.stringify(spy.mock.calls)).join(' ');
}

describe('WhatsAppDeliveryScheduler', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('the cron contract', () => {
    it('is wired for 20:00 in America/Bogota', () => {
      const options = Reflect.getMetadata(
        SCHEDULE_CRON_OPTIONS,
        WhatsAppDeliveryScheduler.prototype.handleDailyReport,
      ) as { cronTime: string; timeZone: string };

      expect(DAILY_REPORT_CRON).toBe('0 20 * * *');
      expect(DAILY_REPORT_TIMEZONE).toBe('America/Bogota');
      expect(options).toEqual({
        cronTime: DAILY_REPORT_CRON,
        timeZone: DAILY_REPORT_TIMEZONE,
      });
    });

    it('sends the scheduled delivery for the central connection when it fires', async () => {
      // 20:30 in Bogota on 2026-03-03.
      jest.useFakeTimers().setSystemTime(new Date('2026-03-04T01:30:00.000Z'));
      const { scheduler, delivery, connections } = setup();

      await scheduler.handleDailyReport();

      expect(connections.getOrCreateIntelligence).toHaveBeenCalled();
      expect(delivery.scheduled).toHaveBeenCalledWith(
        CENTRAL_CONNECTION_ID,
        new Date('2026-03-03T00:00:00.000Z'),
      );
    });

    it('does not throw when the delivery fails', async () => {
      const spies = spyOnLogger();
      try {
        const { scheduler } = setup({
          scheduled: jest.fn().mockRejectedValue(new Error('secret-db-dsn')),
        });

        await expect(scheduler.handleDailyReport()).resolves.toBeUndefined();

        const logged = stringified(spies);
        expect(logged).toContain('cron_failed');
        expect(logged).not.toContain('secret-db-dsn');
      } finally {
        spies.forEach((spy) => spy.mockRestore());
      }
    });

    it('does not throw when the provider cannot even be resolved', async () => {
      const spies = spyOnLogger();
      try {
        const { scheduler } = setup({
          connection: jest.fn().mockRejectedValue(new Error('no config')),
        });

        await expect(scheduler.handleDailyReport()).resolves.toBeUndefined();
        expect(stringified(spies)).toContain('cron_failed');
      } finally {
        spies.forEach((spy) => spy.mockRestore());
      }
    });
  });

  describe('bootstrap catch-up', () => {
    it('does nothing before 20:00 in Bogota', async () => {
      const { scheduler, delivery, connections } = setup();

      // 19:59 on 2026-03-04 in Bogota.
      await scheduler.catchUp(new Date('2026-03-05T00:59:00.000Z'));

      expect(connections.getOrCreateIntelligence).not.toHaveBeenCalled();
      expect(delivery.findScheduled).not.toHaveBeenCalled();
      expect(delivery.scheduled).not.toHaveBeenCalled();
    });

    it('does nothing at 00:30 the next Bogota day, before that day is due', async () => {
      const { scheduler, delivery } = setup();

      // 00:30 on 2026-03-04 in Bogota: past midnight, not past 20:00.
      await scheduler.catchUp(new Date('2026-03-04T05:30:00.000Z'));

      expect(delivery.scheduled).not.toHaveBeenCalled();
    });

    it('sends today scheduled delivery once it is past 20:00 and nothing was attempted', async () => {
      const { scheduler, delivery, connections } = setup();

      // 21:00 on 2026-03-03 in Bogota.
      await scheduler.catchUp(new Date('2026-03-04T02:00:00.000Z'));

      expect(connections.getOrCreateIntelligence).toHaveBeenCalled();
      expect(delivery.findScheduled).toHaveBeenCalledWith(
        CENTRAL_CONNECTION_ID,
        new Date('2026-03-03T00:00:00.000Z'),
      );
      expect(delivery.scheduled).toHaveBeenCalledWith(
        CENTRAL_CONNECTION_ID,
        new Date('2026-03-03T00:00:00.000Z'),
      );
    });

    it('still uses the same day at 23:59 Bogota', async () => {
      const { scheduler, delivery } = setup();

      await scheduler.catchUp(new Date('2026-03-04T04:59:00.000Z'));

      expect(delivery.scheduled).toHaveBeenCalledWith(
        CENTRAL_CONNECTION_ID,
        new Date('2026-03-03T00:00:00.000Z'),
      );
    });

    it('never sends when today already has a scheduled row', async () => {
      const spies = spyOnLogger();
      try {
        const { scheduler, delivery } = setup({
          findScheduled: jest
            .fn()
            .mockResolvedValue({ id: 'delivery-1', status: 'FAILED' }),
        });

        await scheduler.catchUp(new Date('2026-03-04T02:00:00.000Z'));

        // A failed attempt still counts as attempted: the catch-up must not hammer
        // a blocked provider after a restart.
        expect(delivery.scheduled).not.toHaveBeenCalled();
        expect(stringified(spies)).toContain('catch_up_already_attempted');
      } finally {
        spies.forEach((spy) => spy.mockRestore());
      }
    });

    it('does not throw when the delivery fails', async () => {
      const spies = spyOnLogger();
      try {
        const { scheduler } = setup({
          scheduled: jest.fn().mockRejectedValue(new Error('secret-db-dsn')),
        });

        await expect(
          scheduler.catchUp(new Date('2026-03-04T02:00:00.000Z')),
        ).resolves.toBeUndefined();

        expect(stringified(spies)).toContain('catch_up_failed');
        expect(stringified(spies)).not.toContain('secret-db-dsn');
      } finally {
        spies.forEach((spy) => spy.mockRestore());
      }
    });

    it('does not throw when the claim lookup itself fails', async () => {
      const spies = spyOnLogger();
      try {
        const { scheduler } = setup({
          findScheduled: jest.fn().mockRejectedValue(new Error('db down')),
        });

        await expect(
          scheduler.catchUp(new Date('2026-03-04T02:00:00.000Z')),
        ).resolves.toBeUndefined();
        expect(stringified(spies)).toContain('catch_up_failed');
      } finally {
        spies.forEach((spy) => spy.mockRestore());
      }
    });

    it('runs on application bootstrap', async () => {
      const { scheduler } = setup();
      const catchUp = jest
        .spyOn(scheduler, 'catchUp')
        .mockResolvedValue(undefined);

      await scheduler.onApplicationBootstrap();

      expect(catchUp).toHaveBeenCalledTimes(1);
    });
  });
});
