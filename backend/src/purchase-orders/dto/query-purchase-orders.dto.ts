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
} from 'class-validator';

/** One status, or `OPEN` for every order still waiting for goods. */
const PURCHASE_ORDER_STATUS_FILTERS = [
  'DRAFT',
  'PENDING',
  'PARTIAL_RECEIVED',
  'RECEIVED',
  'CANCELLED',
  'OPEN',
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
      'A single status, or OPEN for every order still waiting for goods (PENDING and PARTIAL_RECEIVED).',
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
  q?: string;
}
