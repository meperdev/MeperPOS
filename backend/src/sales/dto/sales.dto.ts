import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsEnum,
  IsString,
  IsNotEmpty,
  IsArray,
  MaxLength,
  MinLength,
  ValidateNested,
  ValidateIf,
  Min,
  Max,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export const SALE_ITEM_QUANTITY_MAX = 2147483647;

export class SaleItemDto {
  @ApiProperty({ example: 'uuid-product-id' })
  @IsString()
  @MaxLength(64)
  @IsNotEmpty()
  productId: string;

  @ApiProperty({
    type: 'integer',
    example: 2,
    minimum: 1,
    maximum: SALE_ITEM_QUANTITY_MAX,
  })
  @IsInt()
  @Min(1)
  @Max(SALE_ITEM_QUANTITY_MAX)
  @Type(() => Number)
  quantity: number;

  @ApiProperty({ example: 150.0, required: false })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  unitPrice?: number;

  @ApiProperty({ example: 0, required: false })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  discountAmount?: number;
}

export class PaymentDto {
  @ApiProperty({ enum: ['CASH', 'CARD', 'TRANSFER'], example: 'CASH' })
  @IsEnum(['CASH', 'CARD', 'TRANSFER'])
  method: 'CASH' | 'CARD' | 'TRANSFER';

  @ApiProperty({ example: 100.0 })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  amount: number;
}

export class CreateSaleDto {
  @ApiPropertyOptional({
    description:
      'Explicit origin site; before cutover only the sole principal site can use global stock.',
  })
  @Transform(({ obj, key }) => obj[key], { toClassOnly: true })
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @MaxLength(64)
  @IsNotEmpty()
  locationId?: string;

  @ApiProperty({ example: 'uuid-customer-id', required: false })
  @IsString()
  @MaxLength(64)
  @IsNotEmpty()
  @IsOptional()
  customerId?: string;

  @ApiProperty({ type: [SaleItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaleItemDto)
  items: SaleItemDto[];

  @ApiProperty({ example: 0, required: false })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  discountAmount?: number;

  @ApiProperty({ type: [PaymentDto], required: false })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentDto)
  payments?: PaymentDto[];

  /**
   * Optional idempotency key (SEC-014), mirroring the loans module. Two requests
   * with the same key and the same payload register one sale; a retry replays
   * the first answer instead of charging the customer twice.
   */
  @ApiPropertyOptional({ minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @IsOptional()
  requestKey?: string;
}

export class UpdateSaleDto {
  @ApiProperty({
    enum: ['COMPLETED', 'CANCELLED'],
    example: 'CANCELLED',
    required: false,
  })
  @IsEnum(['COMPLETED', 'CANCELLED'])
  @IsOptional()
  status?: 'COMPLETED' | 'CANCELLED';

  @ApiProperty({ example: 'Cliente arrepentido', required: false })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  cancelReason?: string;
}

export class FindSalesQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsNumber()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ example: 10, default: 10 })
  @IsNumber()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(40)
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(40)
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(64)
  @IsOptional()
  status?: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(200)
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ example: 'uuid-customer-id' })
  @IsString()
  @MaxLength(64)
  @IsOptional()
  customerId?: string;
}
