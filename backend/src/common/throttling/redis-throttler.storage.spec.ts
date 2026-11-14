import { Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import {
  INCREMENT_SCRIPT,
  REDIS_THROTTLE_KEY_PREFIX,
  RedisThrottlerStorage,
} from './redis-throttler.storage';
import type { ThrottleRedisClient } from './redis-throttler.storage';

/** Records what the adapter asked Redis for, and answers a scripted reply. */
class FakeRedisClient implements ThrottleRedisClient {
  public readonly calls: Array<{
    script: string;
    numberOfKeys: number;
    args: Array<string | number>;
  }> = [];

  constructor(private readonly reply: unknown) {}

  eval(
    script: string,
    numberOfKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown> {
    this.calls.push({ script, numberOfKeys, args });

    return this.reply instanceof Error
      ? Promise.reject(this.reply)
      : Promise.resolve(this.reply);
  }
}

class RecordingFallback implements ThrottlerStorage {
  public calls = 0;

  increment(): Promise<{
    totalHits: number;
    timeToExpire: number;
    isBlocked: boolean;
    timeToBlockExpire: number;
  }> {
    this.calls += 1;
    return Promise.resolve({
      totalHits: 99,
      timeToExpire: 7,
      isBlocked: true,
      timeToBlockExpire: 7,
    });
  }
}

function build(reply: unknown): {
  storage: RedisThrottlerStorage;
  client: FakeRedisClient;
  fallback: RecordingFallback;
  errors: string[];
} {
  const client = new FakeRedisClient(reply);
  const fallback = new RecordingFallback();
  const errors: string[] = [];
  const logger = new Logger('test');

  jest.spyOn(logger, 'error').mockImplementation((message: unknown) => {
    errors.push(String(message));
    return undefined as never;
  });

  return {
    storage: new RedisThrottlerStorage(client, fallback, logger),
    client,
    fallback,
    errors,
  };
}

describe('RedisThrottlerStorage (spec S4.3, S4.5, S4.6, S4.8)', () => {
  it('namespaces the key with the prefix, the throttler name and the guard key', async () => {
    const { storage, client } = build([1, 60_000, 0, 0]);

    await storage.increment('abc123', 60_000, 5, 60_000, 'default');

    expect(client.calls[0].args[0]).toBe(
      `${REDIS_THROTTLE_KEY_PREFIX}:default:abc123`,
    );
    expect(client.calls[0].numberOfKeys).toBe(1);
    // ttl, limit and blockDuration travel as ARGV so the script is atomic.
    expect(client.calls[0].args.slice(1)).toEqual([60_000, 5, 60_000]);
    expect(client.calls[0].script).toBe(INCREMENT_SCRIPT);
  });

  it('converts the millisecond reply into the seconds the guard reports', async () => {
    const { storage } = build([3, 42_100, 0, 0]);

    await expect(
      storage.increment('abc123', 60_000, 5, 60_000, 'default'),
    ).resolves.toEqual({
      totalHits: 3,
      timeToExpire: 43,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });

  it('reports the block and its remaining window when the limit is exceeded', async () => {
    const { storage } = build([6, 60_000, 1, 60_000]);

    await expect(
      storage.increment('abc123', 60_000, 5, 60_000, 'default'),
    ).resolves.toEqual({
      totalHits: 6,
      timeToExpire: 60,
      isBlocked: true,
      timeToBlockExpire: 60,
    });
  });

  it('falls back to the per-process counters when Redis fails, and says so loudly (S4.8)', async () => {
    const { storage, fallback, errors } = build(
      new Error('connect ECONNREFUSED'),
    );

    await expect(
      storage.increment('abc123', 60_000, 5, 60_000, 'default'),
    ).resolves.toEqual({
      totalHits: 99,
      timeToExpire: 7,
      isBlocked: true,
      timeToBlockExpire: 7,
    });
    expect(fallback.calls).toBe(1);
    expect(errors[0]).toContain('per-process fallback counters');
    expect(errors[0]).toContain('ECONNREFUSED');
  });

  it('treats a malformed reply as a failure instead of trusting it', async () => {
    const { storage, fallback, errors } = build('OK');

    await expect(
      storage.increment('abc123', 60_000, 5, 60_000, 'default'),
    ).resolves.toMatchObject({ totalHits: 99 });
    expect(fallback.calls).toBe(1);
    expect(errors[0]).toContain('unexpected Redis reply');
  });
});
