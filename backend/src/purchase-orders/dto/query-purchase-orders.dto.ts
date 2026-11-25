import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsOptional,
  IsInt,
  Min,
  IsString,
  IsEnum,
  IsUUID,
  IsDateString,
  MaxLength,
} from 'class-validator';

/**
 * One status, `OPEN` for every order still waiting for goods, or `OVERDUE` for
 * the open orders whose expected delivery day has passed.
 */
const PURCHASE_ORDER_STATUS_FILTERS = [
  'DRAFT',
  'PENDING',
  'PARTIAL_RECEIVED',
  'RECEIVED',
  'CANCELLED',
  'OPEN',
  'OVERDUE',
] as const;

export type PurchaseOrderStatusFilter =
  (typeof PURCHASE_ORDER_STATUS_FILTERS)[number];

export class QueryPurchaseOrdersDto {
  @ApiProperty({ required: false, example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiProperty({
    required: false,
    enum: PURCHASE_ORDER_STATUS_FILTERS,
    description:
      'A single status, OPEN for every order still waiting for goods (PENDING and PARTIAL_RECEIVED), or OVERDUE for the open orders whose expected delivery day has passed.',
  })
  @IsOptional()
  @IsEnum(PURCHASE_ORDER_STATUS_FILTERS)
  status?: PurchaseOrderStatusFilter;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
}
