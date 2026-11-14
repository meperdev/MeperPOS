import { Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';

/**
 * `@nestjs/throttler` does not re-export `ThrottlerStorageRecord`, so the record
 * shape is derived from the storage contract itself rather than from a deep
 * import that could break on a patch release.
 */
type ThrottlerRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/**
 * Minimal Redis surface this adapter needs, so the specs can inject a fake
 * client and assert the key shape and the reply conversion without a server.
 */
export interface ThrottleRedisClient {
  eval(
    script: string,
    numberOfKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>;
}

/**
 * Every rate-limit key is namespaced so it cannot collide with application
 * keys, and it carries the throttler name plus the guard's per-route key
 * (sha256 of class-handler-throttlerName-tracker, spec S4.6).
 */
export const REDIS_THROTTLE_KEY_PREFIX = 'meperpos:throttle';

/**
 * Atomic counter + block marker, evaluated inside Redis so two replicas can
 * never race on the same bucket (spec S4.5).
 *
 * KEYS[1] counter, `<counter>:block` block marker
 * ARGV[1] ttl (ms), ARGV[2] limit, ARGV[3] blockDuration (ms)
 *
 * Semantics: a fixed window that starts with the first hit, and a block that
 * begins when the window's hits exceed the limit. Both keys expire together,
 * so the window restarts clean after the block — the same observable behaviour
 * the in-memory storage has, without its per-hit decaying counter.
 */
export const INCREMENT_SCRIPT = `
local counterKey = KEYS[1]
local blockKey = counterKey .. ':block'
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockDuration = tonumber(ARGV[3])

if redis.call('EXISTS', blockKey) == 1 then
  return { tonumber(redis.call('GET', counterKey) or '0'), redis.call('PTTL', counterKey), 1, redis.call('PTTL', blockKey) }
end

local hits = redis.call('INCR', counterKey)
if hits == 1 then
  redis.call('PEXPIRE', counterKey, ttl)
end

if hits > limit then
  redis.call('SET', blockKey, '1', 'PX', blockDuration)
  redis.call('PEXPIRE', counterKey, blockDuration)
  return { hits, blockDuration, 1, blockDuration }
end

return { hits, redis.call('PTTL', counterKey), 0, 0 }
`;

/** `@nestjs/throttler` reports these in seconds; Redis answers in milliseconds. */
function toSeconds(milliseconds: number): number {
  return Math.max(0, Math.ceil(milliseconds / 1000));
}

/**
 * Shared throttler storage (spec S4.3, S4.5, S4.6, S4.8).
 *
 * If Redis is configured but unreachable, a request must not crash and must not
 * stop being throttled: the failure is logged prominently and the call is
 * answered by the per-process fallback, so the limit degrades to per-replica
 * instead of disappearing.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(
    private readonly client: ThrottleRedisClient,
    private readonly fallback: ThrottlerStorage,
    private readonly logger: Logger,
    private readonly prefix: string = REDIS_THROTTLE_KEY_PREFIX,
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerRecord> {
    const redisKey = `${this.prefix}:${throttlerName}:${key}`;

    try {
      const reply = await this.client.eval(
        INCREMENT_SCRIPT,
        1,
        redisKey,
        ttl,
        limit,
        blockDuration,
      );

      if (!Array.isArray(reply) || reply.length < 4) {
        throw new Error(`unexpected Redis reply: ${JSON.stringify(reply)}`);
      }

      const [totalHits, timeToExpire, isBlocked, timeToBlockExpire] = reply.map(
        (value) => Number(value),
      );

      return {
        totalHits,
        timeToExpire: toSeconds(timeToExpire),
        isBlocked: isBlocked === 1,
        timeToBlockExpire: toSeconds(timeToBlockExpire),
      };
    } catch (error) {
      this.logger.error(
        `Redis rate-limit storage failed for ${redisKey}; answering from the per-process fallback counters instead: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return this.fallback.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    }
  }
}
