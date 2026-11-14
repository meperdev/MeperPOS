import { Logger } from '@nestjs/common';
import { ThrottlerStorageService } from '@nestjs/throttler';
import {
  createThrottlerStorage,
  resolveRedisUrl,
} from './throttler-storage.factory';

/**
 * The `REDIS_URL` branch that returns shared storage is deliberately not
 * unit-tested here: it opens a real client, and its behaviour is proven
 * end-to-end by the two-instance 429 run recorded in
 * odd/tasks/security-hardening-2026-10.md (T7). What is pinned here is the
 * unset branch, whose silent downgrade is the risk S4.8 asks to remove.
 */
describe('createThrottlerStorage (spec S4.3, S4.8)', () => {
  function silentLogger(): { logger: Logger; warnings: string[] } {
    const warnings: string[] = [];
    const logger = new Logger('test');
    jest.spyOn(logger, 'warn').mockImplementation((message: unknown) => {
      warnings.push(String(message));
      return undefined as never;
    });
    return { logger, warnings };
  }

  it('treats an unset or blank REDIS_URL as absent', () => {
    expect(resolveRedisUrl({} as NodeJS.ProcessEnv)).toBeUndefined();
    expect(
      resolveRedisUrl({ REDIS_URL: '   ' } as NodeJS.ProcessEnv),
    ).toBeUndefined();
    expect(
      resolveRedisUrl({
        REDIS_URL: ' redis://cache:6379 ',
      } as NodeJS.ProcessEnv),
    ).toBe('redis://cache:6379');
  });

  it('keeps the in-memory default and warns exactly once when REDIS_URL is unset', () => {
    const { logger, warnings } = silentLogger();

    expect(
      createThrottlerStorage({} as NodeJS.ProcessEnv, logger),
    ).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(
      'multiplied by the number of running replicas',
    );
  });

  it('the in-memory default the module falls back to still enforces the limit it is given', async () => {
    const storage = new ThrottlerStorageService();

    const first = await storage.increment('k', 60_000, 2, 60_000, 'default');
    const second = await storage.increment('k', 60_000, 2, 60_000, 'default');
    const third = await storage.increment('k', 60_000, 2, 60_000, 'default');

    expect(first.isBlocked).toBe(false);
    expect(second.isBlocked).toBe(false);
    expect(third.isBlocked).toBe(true);
  });
});
