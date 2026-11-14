import { Logger } from '@nestjs/common';
import { ThrottlerStorageService } from '@nestjs/throttler';
import type {
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import Redis from 'ioredis';
import { RedisThrottlerStorage } from './redis-throttler.storage';

/**
 * Chooses the throttler storage for this process (spec S4.3, S4.8).
 *
 * `REDIS_URL` set  -> shared storage, so the per-client limit is global across
 *                     replicas instead of being multiplied by their count.
 * `REDIS_URL` unset -> returns undefined and `@nestjs/throttler` keeps its
 *                     in-memory default; the weaker guarantee is logged once at
 *                     startup so it is never silent.
 *
 * The Redis URL must carry credentials and stay on private networking
 * (spec S4.6): `redis://default:<password>@<private-host>:6379`.
 */
export function resolveRedisUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const url = env.REDIS_URL?.trim();

  return url && url.length > 0 ? url : undefined;
}

/**
 * The global limit and the storage choice in one object, resolved when the
 * module's imports array is evaluated so `ConfigModule.forRoot()` has already
 * loaded a `.env` file (a top-level const would run before it and miss
 * `REDIS_URL`).
 */
export function throttlerModuleOptions(
  env: NodeJS.ProcessEnv = process.env,
  logger?: Logger,
): ThrottlerModuleOptions {
  const storage = createThrottlerStorage(env, logger);
  const options: ThrottlerModuleOptions = {
    throttlers: [{ ttl: 60_000, limit: 100 }],
  };

  if (storage) {
    options.storage = storage;
  }

  return options;
}

export function createThrottlerStorage(
  env: NodeJS.ProcessEnv = process.env,
  logger: Logger = new Logger('ThrottlerStorage'),
): ThrottlerStorage | undefined {
  const url = resolveRedisUrl(env);

  if (!url) {
    logger.warn(
      'REDIS_URL is not set: rate limiting uses per-process in-memory counters, so every limit is multiplied by the number of running replicas. Set REDIS_URL (private, authenticated) to share one bucket per client across replicas.',
    );
    return undefined;
  }

  const client = new Redis(url, {
    // Boot must not depend on Redis being reachable: the connection is
    // attempted in the background and a failing command is answered by the
    // local fallback counters.
    lazyConnect: true,
    connectTimeout: 1_000,
    maxRetriesPerRequest: 1,
    // Commands fail fast instead of queueing while the connection is down, so
    // the fallback answers the request instead of hanging it.
    enableOfflineQueue: false,
    retryStrategy: (attempt) => Math.min(attempt * 200, 2_000),
  });

  client.on('error', (error: Error) => {
    logger.error(
      `Redis rate-limit connection error; falling back to per-process counters: ${error.message}`,
    );
  });

  client.connect().catch((error: Error) => {
    logger.error(
      `Redis rate-limit connection could not be established; the API still boots and throttles from per-process counters: ${error.message}`,
    );
  });

  return new RedisThrottlerStorage(
    client,
    new ThrottlerStorageService(),
    logger,
  );
}
