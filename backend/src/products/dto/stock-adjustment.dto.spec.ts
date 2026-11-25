import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  MAX_STOCK_ADJUSTMENT,
  StockAdjustmentDto,
} from './stock-adjustment.dto';

/**
 * T22 — the per-site adjustment body boundary.
 *
 * The service refuses a zero move and an empty reason on its own, but the HTTP
 * route must reject a malformed one before the transaction opens: a fractional
 * unit, an unbounded jump or a blank motive never reach the database.
 */
const base = {
  locationId: 'site-bodega',
  quantity: -3,
  reason: 'Conteo físico',
};

const transform = (input: Record<string, unknown>) =>
  plainToInstance(StockAdjustmentDto, input);

describe('StockAdjustmentDto', () => {
  it('accepts a signed in-range adjustment and trims the reason', async () => {
    const dto = transform({ ...base, reason: '  Merma de bodega  ' });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto).toMatchObject({
      locationId: 'site-bodega',
      quantity: -3,
      reason: 'Merma de bodega',
    });
  });

  it('accepts a positive adjustment and both bounds', async () => {
    for (const quantity of [
      1,
      -1,
      MAX_STOCK_ADJUSTMENT,
      -MAX_STOCK_ADJUSTMENT,
    ]) {
      await expect(
        validate(transform({ ...base, quantity })),
      ).resolves.toHaveLength(0);
    }
  });

  it('rejects a zero, fractional, unbounded or missing quantity', async () => {
    for (const quantity of [
      0,
      1.5,
      MAX_STOCK_ADJUSTMENT + 1,
      -MAX_STOCK_ADJUSTMENT - 1,
    ]) {
      const errors = await validate(transform({ ...base, quantity }));
      expect(errors.map(({ property }) => property)).toContain('quantity');
    }

    const missing = await validate(transform({ ...base, quantity: undefined }));
    expect(missing.map(({ property }) => property)).toContain('quantity');
  });

  it('requires a location id and a non-blank reason of at most 200 characters', async () => {
    const blank = await validate(transform({ ...base, reason: '   ' }));
    expect(blank.map(({ property }) => property)).toContain('reason');

    const long = await validate(
      transform({ ...base, reason: 'x'.repeat(201) }),
    );
    expect(long.map(({ property }) => property)).toContain('reason');

    const noSite = await validate(transform({ ...base, locationId: '' }));
    expect(noSite.map(({ property }) => property)).toContain('locationId');

    const missingSite = await validate(
      transform({ ...base, locationId: undefined }),
    );
    expect(missingSite.map(({ property }) => property)).toContain('locationId');
  });
});
