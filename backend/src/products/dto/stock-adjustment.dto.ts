import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  NotEquals,
} from 'class-validator';

/**
 * The largest move one adjustment may make, in absolute units.
 *
 * A manual count corrects a difference, it does not rewrite a warehouse: the
 * bound keeps a slip of the keyboard from becoming a six-figure balance, and it
 * is far above any real per-site correction.
 */
export const MAX_STOCK_ADJUSTMENT = 1_000_000;

/**
 * One per-site stock adjustment (T22).
 *
 * The site is named explicitly — never defaulted — because the whole point of
 * this route is choosing *which* balance moves. `quantity` is signed: positive
 * enters the site, negative leaves it, and zero is not an adjustment. `reason`
 * is required and trimmed here, so the movement history never records a blank
 * motive; the membership and tenant rules belong to the service, which resolves
 * the site inside the stock transaction.
 */
export class StockAdjustmentDto {
  @ApiProperty({
    description: 'Site whose balance moves',
    example: 'uuid-site',
  })
  @Transform(({ obj, key }) => obj[key], { toClassOnly: true })
  @IsString()
  @MaxLength(64)
  @IsNotEmpty()
  locationId: string;

  @ApiProperty({
    description: 'Signed units: positive enters the site, negative leaves it',
    example: -3,
  })
  @IsInt()
  @NotEquals(0)
  @Min(-MAX_STOCK_ADJUSTMENT)
  @Max(MAX_STOCK_ADJUSTMENT)
  quantity: number;

  @ApiProperty({ example: 'Conteo físico' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(200)
  @IsNotEmpty()
  reason: string;
}
