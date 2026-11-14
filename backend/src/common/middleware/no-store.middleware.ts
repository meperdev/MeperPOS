import type { NextFunction, Request, Response } from 'express';

/**
 * Keeps every API answer out of browser and intermediary caches (spec S3).
 *
 * The rule is blanket instead of an endpoint list on purpose: every route of
 * this API answers with user- or organization-scoped data, and a per-endpoint
 * list would leave any future route cacheable by omission. The health probe is
 * included so a stale instance state can never be replayed from a cache.
 */
export function noStoreMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader('Cache-Control', 'no-store');
  next();
}
